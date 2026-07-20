import type { IncomingMessage, ServerResponse } from "node:http"

import type { ProxyConfig } from "../config.js"
import type { RequestSemaphore } from "../concurrency.js"
import type { AgentWarmPool } from "../cursor/agent-pool.js"
import { CursorSessionStore, buildResumePrompt, canResumeSession } from "../cursor/session-store.js"
import { CursorAgentRunner } from "../cursor/runner.js"
import { resolveRequestMode, resolveAgentWorkspace, resolveWorkspace } from "../cursor/workspace.js"
import {
  anthropicToOpenAi,
  openAiToAnthropic,
} from "../anthropic/convert.js"
import {
  closeOpenContentBlock,
  createAnthropicStreamState,
  createMessageEndEvents,
  createMessageStartEvent,
  createTextDeltaEvent,
  createThinkingDeltaEvent,
  createToolUseBlockEvents,
  openContentBlock,
} from "../anthropic/stream.js"
import type { AnthropicMessagesRequest } from "../anthropic/types.js"
import { runWithAutoContinue } from "../openai/auto-continue.js"
import { compressMessages } from "../openai/context-budget.js"
import {
  resolveHermesExecution,
  resolvePlan2ApiClient,
  finalizeHermesDelegationOutput,
  finalizeOpenRouterOutput,
} from "../openai/hermes-mode.js"
import {
  buildJsonModeInstruction,
  finalizeJsonModeOutput,
  parseResponseFormat,
} from "../openai/json-mode.js"
import { toolsToOpenRouterSystemText } from "../openai/openrouter-compat.js"
import {
  buildPromptFromMessages,
  normalizeModelId,
  parseToolCallsFromText,
} from "../openai/prompt.js"
import { createRequestId } from "../openai/response.js"
import { shouldEmitReasoning } from "../openai/responses-map.js"
import { buildUsage, estimateTokens } from "../openai/tokens.js"
import { applyToolFixes, fixToolCalls } from "../openai/tool-fixer.js"
import type { OpenAiChatRequest } from "../openai/types.js"
import { logRequest, logResponse } from "../request-log.js"
import { readJsonBody, writeSse, endSse } from "./http.js"
import { authorize, sendError } from "./shared.js"
import { sendJson } from "./http.js"
import { resolveEffectiveContext, resolveWorkspaceHeader } from "./request-context.js"
import type { ProfileRotator } from "../cursor/profile-rotator.js"

type HandlerContext = {
  config: ProxyConfig
  cliVersion?: string
  semaphore: RequestSemaphore
  sessionStore: CursorSessionStore
  agentPool?: AgentWarmPool
  profileRotator?: ProfileRotator
}

const resolveModel = (
  requested: string | undefined,
  config: ProxyConfig,
): string => normalizeModelId(requested) ?? config.defaultModel

/**
 * Handle POST /v1/messages (Anthropic Messages API compatible).
 */
export const handleMessages = async (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerContext,
): Promise<void> => {
  const startedAt = Date.now()

  if (!authorize(req, ctx.config)) {
    sendError(res, 401, "Invalid bridge API key", "authentication_error")
    return
  }

  let anthropicBody: AnthropicMessagesRequest
  try {
    anthropicBody = (await readJsonBody(req)) as AnthropicMessagesRequest
  } catch (error) {
    sendError(
      res,
      400,
      error instanceof Error ? error.message : "Invalid JSON body",
    )
    return
  }

  if (!Array.isArray(anthropicBody.messages) || anthropicBody.messages.length === 0) {
    sendError(res, 400, "messages must be a non-empty array")
    return
  }

  const body = anthropicToOpenAi(anthropicBody)
  const requestId = createRequestId()
  const model = resolveModel(body.model, ctx.config)

  let requestedMode: ProxyConfig["agentMode"]
  try {
    requestedMode = resolveRequestMode(ctx.config, req.headers["x-cursor-mode"], body.mode)
  } catch (error) {
    sendError(res, 400, error instanceof Error ? error.message : "Invalid mode")
    return
  }

  const execution = resolveHermesExecution(
    ctx.config,
    requestedMode,
    body,
    resolvePlan2ApiClient(req.headers),
  )

  const responseFormat = parseResponseFormat(body)
  const jsonInstruction = responseFormat
    ? buildJsonModeInstruction(responseFormat)
    : undefined

  const toolsText = execution.injectToolsAsPrompt
    ? toolsToOpenRouterSystemText(body.tools, body.functions, ctx.config.compactTools)
    : undefined
  const systemParts: Array<{ role: "system"; content: string }> = []
  if (execution.systemPrompt) systemParts.push({ role: "system", content: execution.systemPrompt })
  if (execution.planSystemPrompt) {
    systemParts.push({ role: "system", content: execution.planSystemPrompt })
  }
  if (jsonInstruction) systemParts.push({ role: "system", content: jsonInstruction })
  if (toolsText) systemParts.push({ role: "system", content: toolsText })

  const fixedMessages = applyToolFixes(body.messages)
  const compressedMessages = compressMessages(fixedMessages, ctx.config.maxHistoryTokens)
  const messages = [...systemParts, ...compressedMessages]

  let promptCleanup: (() => Promise<void>) | undefined
  let fullPrompt = ""
  let prompt = ""

  try {
    const built = await buildPromptFromMessages(messages)
    fullPrompt = built.prompt
    promptCleanup = built.cleanup

    const sessionKey = ctx.sessionStore.resolveKey(req, body, model)
    const resumeEligible =
      ctx.config.sessionResume &&
      fullPrompt.length >= ctx.config.sessionResumeMinChars &&
      canResumeSession(body.messages)
    const resumeSessionId = resumeEligible ? ctx.sessionStore.get(sessionKey) : undefined
    const resumePrompt = resumeSessionId ? buildResumePrompt(body.messages) : null
    prompt =
      resumeSessionId && resumePrompt
        ? toolsText
          ? `${toolsText}\n\n${resumePrompt}`
          : resumePrompt
        : fullPrompt

    const { config: effectiveConfig, profile } = resolveEffectiveContext(
      ctx.config,
      ctx.profileRotator,
    )
    const workspaceHeader = resolveWorkspaceHeader(profile, req.headers["x-cursor-workspace"])
    const headerWorkspace = workspaceHeader
    const workspace =
      execution.useHomeWorkspace || execution.cliMode === "agent"
        ? resolveAgentWorkspace(headerWorkspace)
        : resolveWorkspace(
            effectiveConfig,
            headerWorkspace,
            execution.cliMode === "ask" ? effectiveConfig.chatOnlyWorkspace : false,
          )
    const runner = new CursorAgentRunner(effectiveConfig)
    const emitReasoning = shouldEmitReasoning(model)

    const invocation = {
      model,
      prompt,
      stream: body.stream === true,
      mode: execution.cliMode,
      workspaceDir: workspace.workspaceDir,
      suppressNativeToolCalls: execution.hermesDelegation,
      resumeSessionId,
      emitReasoning,
    }

    logRequest(ctx.config.verboseLogging, "POST", "/v1/messages", {
      id: requestId,
      model,
      stream: invocation.stream,
      anthropic: true,
    })

    await ctx.agentPool?.ensureWarm()
    await ctx.semaphore.acquire()

    try {
      if (invocation.stream) {
        await handleAnthropicStreaming(
          res,
          runner,
          invocation,
          requestId,
          model,
          prompt,
          ctx,
          startedAt,
          execution,
          body,
          sessionKey,
          responseFormat,
        )
        return
      }

      const result = await runWithAutoContinue(runner, invocation, ctx.config)
      if (ctx.config.sessionResume && result.sessionId) {
        ctx.sessionStore.set(sessionKey, result.sessionId)
      }

      const rawToolCalls = fixToolCalls(
        result.toolCalls ?? parseToolCallsFromText(result.text),
      )
      const finalized = execution.hermesDelegation
        ? finalizeHermesDelegationOutput(execution.hermesDelegation, result.text, rawToolCalls)
        : finalizeOpenRouterOutput(execution.openRouterCompat, result.text, body, rawToolCalls)

      const jsonText = finalizeJsonModeOutput(finalized.text, responseFormat)
      const usage = buildUsage(result.usage, prompt, jsonText)
      const response = openAiToAnthropic(
        requestId,
        result.model || model,
        jsonText,
        finalized.toolCalls,
        usage,
      )

      sendJson(res, 200, response)
      logResponse(ctx.config.verboseLogging, requestId, 200, Date.now() - startedAt, {
        model: result.model || model,
        usage,
      })
    } catch (error) {
      sendError(
        res,
        500,
        error instanceof Error ? error.message : "Cursor CLI request failed",
        "server_error",
      )
      logResponse(ctx.config.verboseLogging, requestId, 500, Date.now() - startedAt)
    } finally {
      ctx.semaphore.release()
      ctx.agentPool?.scheduleRewarm()
    }
  } catch (error) {
    sendError(
      res,
      400,
      error instanceof Error ? error.message : "Failed to build prompt",
    )
  } finally {
    await promptCleanup?.()
  }
}

const handleAnthropicStreaming = async (
  res: ServerResponse,
  runner: CursorAgentRunner,
  invocation: Parameters<CursorAgentRunner["runSyncJson"]>[0],
  requestId: string,
  model: string,
  prompt: string,
  ctx: HandlerContext,
  startedAt: number,
  execution: ReturnType<typeof resolveHermesExecution>,
  requestBody: OpenAiChatRequest,
  sessionKey?: string,
  responseFormat?: ReturnType<typeof parseResponseFormat>,
): Promise<void> => {
  writeSse(res, {
    "X-Request-Id": requestId,
    "Content-Type": "text/event-stream",
  })

  const messageId = `msg_${requestId}`
  const streamState = createAnthropicStreamState(messageId, model)
  const inputTokens = estimateTokens(prompt)

  let closed = false
  let fullText = ""
  let resolvedModel = model
  let cliUsage: Parameters<typeof buildUsage>[0]
  let cursorSessionId: string | undefined
  let textBlockIndex: number | undefined
  let thinkingBlockIndex: number | undefined

  const closeStream = (): void => {
    if (closed) return
    closed = true
    endSse(res)
  }

  const ensureThinkingBlock = (): number => {
    if (thinkingBlockIndex !== undefined) return thinkingBlockIndex
    const opened = openContentBlock(streamState, "thinking")
    writeSse(res, {}, opened.event)
    thinkingBlockIndex = opened.blockIndex
    return opened.blockIndex
  }

  const ensureTextBlock = (): number => {
    if (textBlockIndex !== undefined) return textBlockIndex
    if (thinkingBlockIndex !== undefined) {
      const stopThinking = closeOpenContentBlock(streamState)
      if (stopThinking) writeSse(res, {}, stopThinking)
      thinkingBlockIndex = undefined
    }
    const opened = openContentBlock(streamState, "text")
    writeSse(res, {}, opened.event)
    textBlockIndex = opened.blockIndex
    return opened.blockIndex
  }

  await new Promise<void>((resolve) => {
    const finish = (): void => {
      if (closed) return
      resolve()
    }

    runner.on("reasoning", ({ text }) => {
      if (!text || closed) return
      const index = ensureThinkingBlock()
      writeSse(res, {}, createThinkingDeltaEvent(index, text))
    })

    runner.on("delta", ({ text }) => {
      if (!text || closed) return
      fullText += text
      const index = ensureTextBlock()
      writeSse(res, {}, createTextDeltaEvent(index, text))
    })

    runner.on("result", ({ text, model: detectedModel, usage, sessionId }) => {
      if (sessionId) cursorSessionId = sessionId
      if (text && !fullText.includes(text)) fullText = text
      resolvedModel = detectedModel || model
      cliUsage = usage
    })

    runner.on("error", (error) => {
      writeSse(
        res,
        {},
        `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message: error.message } })}\n\n`,
      )
      closeStream()
      finish()
    })

    writeSse(res, {}, createMessageStartEvent(messageId, model, inputTokens))

    runner
      .runStream(invocation)
      .then(() => {
        if (closed) {
          finish()
          return
        }

        const rawToolCalls = fixToolCalls(parseToolCallsFromText(fullText))
        const finalized = execution.hermesDelegation
          ? finalizeHermesDelegationOutput(execution.hermesDelegation, fullText, rawToolCalls)
          : finalizeOpenRouterOutput(
              execution.openRouterCompat,
              fullText,
              requestBody,
              rawToolCalls,
            )
        const jsonText = finalizeJsonModeOutput(finalized.text || fullText, responseFormat)
        const usage = buildUsage(cliUsage, prompt, jsonText || fullText)

        if (ctx.config.sessionResume && cursorSessionId && sessionKey) {
          ctx.sessionStore.set(sessionKey, cursorSessionId)
        }

        if (thinkingBlockIndex !== undefined && textBlockIndex === undefined) {
          const stopThinking = closeOpenContentBlock(streamState)
          if (stopThinking) writeSse(res, {}, stopThinking)
          thinkingBlockIndex = undefined
        }

        if (textBlockIndex !== undefined) {
          const stopText = closeOpenContentBlock(streamState)
          if (stopText) writeSse(res, {}, stopText)
          textBlockIndex = undefined
        } else if (!finalized.toolCalls?.length && jsonText) {
          const opened = openContentBlock(streamState, "text")
          writeSse(res, {}, opened.event)
          writeSse(res, {}, createTextDeltaEvent(opened.blockIndex, jsonText))
          writeSse(
            res,
            {},
            formatAnthropicBlockStop(opened.blockIndex),
          )
        }

        if (finalized.toolCalls?.length) {
          for (const event of createToolUseBlockEvents(streamState, finalized.toolCalls)) {
            writeSse(res, {}, event)
          }
        }

        for (const event of createMessageEndEvents(finalized.toolCalls, usage)) {
          writeSse(res, {}, event)
        }

        closeStream()
        logResponse(ctx.config.verboseLogging, requestId, 200, Date.now() - startedAt, {
          model: resolvedModel,
          usage,
        })
        finish()
      })
      .catch((error) => {
        if (closed) {
          finish()
          return
        }
        writeSse(
          res,
          {},
          `event: error\ndata: ${JSON.stringify({
            type: "error",
            error: {
              type: "api_error",
              message: error instanceof Error ? error.message : String(error),
            },
          })}\n\n`,
        )
        closeStream()
        finish()
      })
  })
}

const formatAnthropicBlockStop = (index: number): string =>
  `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index })}\n\n`
