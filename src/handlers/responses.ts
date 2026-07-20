import type { IncomingMessage, ServerResponse } from "node:http"

import type { ProxyConfig } from "../config.js"
import type { AgentWarmPool } from "../cursor/agent-pool.js"
import type { RequestSemaphore } from "../concurrency.js"
import { CursorSessionStore, buildResumePrompt, canResumeSession } from "../cursor/session-store.js"
import { CursorAgentRunner } from "../cursor/runner.js"
import { resolveRequestMode, resolveAgentWorkspace, resolveWorkspace } from "../cursor/workspace.js"
import {
  resolveHermesExecution,
  resolvePlan2ApiClient,
  finalizeHermesDelegationOutput,
  finalizeOpenRouterOutput,
} from "../openai/hermes-mode.js"
import { runWithAutoContinue, isTruncatedOutput } from "../openai/auto-continue.js"
import { compressMessages } from "../openai/context-budget.js"
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
import {
  createResponsesResponse,
  mapResponsesRequestToChat,
  shouldEmitReasoning,
} from "../openai/responses-map.js"
import type { ResponsesRequest } from "../openai/responses-types.js"
import { createRequestId } from "../openai/response.js"
import { buildUsage } from "../openai/tokens.js"
import { applyToolFixes, fixToolCalls } from "../openai/tool-fixer.js"
import type { OpenAiChatRequest } from "../openai/types.js"
import { logRequest, logResponse } from "../request-log.js"
import { readJsonBody, writeSse, endSse } from "./http.js"
import { authorize, sendError } from "./shared.js"
import { resolveEffectiveContext, resolveWorkspaceHeader } from "./request-context.js"
import type { ProfileRotator } from "../cursor/profile-rotator.js"
import { sendJson } from "./http.js"

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
 * Handle POST /v1/responses (OpenAI Responses API compatible).
 */
export const handleResponses = async (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerContext,
): Promise<void> => {
  const startedAt = Date.now()

  if (!authorize(req, ctx.config)) {
    sendError(res, 401, "Invalid bridge API key", "authentication_error")
    return
  }

  let body: ResponsesRequest
  try {
    body = (await readJsonBody(req)) as ResponsesRequest
  } catch (error) {
    sendError(
      res,
      400,
      error instanceof Error ? error.message : "Invalid JSON body",
    )
    return
  }

  const mapped = mapResponsesRequestToChat(body)
  if (mapped.messages.length === 0) {
    sendError(res, 400, "input must contain at least one message")
    return
  }

  const chatBody: OpenAiChatRequest = {
    model: mapped.model,
    messages: mapped.messages,
    stream: mapped.stream,
    user: mapped.user,
    tools: mapped.tools,
    mode: mapped.mode,
    reasoning_effort: mapped.reasoningEffort,
  }

  const requestId = createRequestId()
  const responseId = `resp_${requestId}`
  const model = resolveModel(chatBody.model, ctx.config)

  let requestedMode: ProxyConfig["agentMode"]
  try {
    requestedMode = resolveRequestMode(
      ctx.config,
      req.headers["x-cursor-mode"],
      chatBody.mode,
    )
  } catch (error) {
    sendError(
      res,
      400,
      error instanceof Error ? error.message : "Invalid mode",
    )
    return
  }

  const execution = resolveHermesExecution(
    ctx.config,
    requestedMode,
    chatBody,
    resolvePlan2ApiClient(req.headers),
  )

  const responseFormat = parseResponseFormat(chatBody)
  const jsonInstruction = responseFormat
    ? buildJsonModeInstruction(responseFormat)
    : undefined

  const toolsText = execution.injectToolsAsPrompt
    ? toolsToOpenRouterSystemText(chatBody.tools, chatBody.functions, ctx.config.compactTools)
    : undefined
  const systemParts: Array<{ role: "system"; content: string }> = []
  if (execution.systemPrompt) {
    systemParts.push({ role: "system", content: execution.systemPrompt })
  }
  if (execution.planSystemPrompt) {
    systemParts.push({ role: "system", content: execution.planSystemPrompt })
  }
  if (jsonInstruction) {
    systemParts.push({ role: "system", content: jsonInstruction })
  }
  if (toolsText) {
    systemParts.push({ role: "system", content: toolsText })
  }

  const fixedMessages = applyToolFixes(chatBody.messages)
  const compressedMessages = compressMessages(fixedMessages, ctx.config.maxHistoryTokens)
  const messages = [...systemParts, ...compressedMessages]
  let promptCleanup: (() => Promise<void>) | undefined
  let fullPrompt = ""
  let prompt = ""

  try {
    const built = await buildPromptFromMessages(messages)
    fullPrompt = built.prompt
    promptCleanup = built.cleanup

    const sessionKey = ctx.sessionStore.resolveKey(req, chatBody, model)
    const resumeEligible =
      ctx.config.sessionResume &&
      fullPrompt.length >= ctx.config.sessionResumeMinChars &&
      canResumeSession(chatBody.messages)
    const resumeSessionId = resumeEligible
      ? ctx.sessionStore.get(sessionKey)
      : undefined
    const resumePrompt = resumeSessionId
      ? buildResumePrompt(chatBody.messages)
      : null
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
    const headerWorkspace = resolveWorkspaceHeader(profile, req.headers["x-cursor-workspace"])
    const workspace =
      execution.useHomeWorkspace || execution.cliMode === "agent"
        ? resolveAgentWorkspace(headerWorkspace)
        : resolveWorkspace(
            effectiveConfig,
            headerWorkspace,
            execution.cliMode === "ask" ? effectiveConfig.chatOnlyWorkspace : false,
          )
    const runner = new CursorAgentRunner(effectiveConfig)
    const emitReasoning = shouldEmitReasoning(
      model,
      chatBody.reasoning_effort ?? mapped.reasoningEffort,
    )

    const invocation = {
      model,
      prompt,
      stream: chatBody.stream === true,
      mode: execution.cliMode,
      workspaceDir: workspace.workspaceDir,
      suppressNativeToolCalls: execution.hermesDelegation,
      resumeSessionId,
      emitReasoning,
    }

    logRequest(ctx.config.verboseLogging, "POST", "/v1/responses", {
      id: requestId,
      model,
      stream: invocation.stream,
      emit_reasoning: emitReasoning,
      prompt_chars: prompt.length,
    })

    await ctx.agentPool?.ensureWarm()
    await ctx.semaphore.acquire()

    try {
      if (invocation.stream) {
        await handleResponsesStreaming(
          res,
          runner,
          invocation,
          requestId,
          responseId,
          model,
          prompt,
          ctx,
          startedAt,
          execution.hermesDelegation,
          execution.openRouterCompat,
          chatBody,
          sessionKey,
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
        ? finalizeHermesDelegationOutput(
            execution.hermesDelegation,
            result.text,
            rawToolCalls,
          )
        : finalizeOpenRouterOutput(
            execution.openRouterCompat,
            result.text,
            chatBody,
            rawToolCalls,
          )
      const jsonText = finalizeJsonModeOutput(finalized.text, responseFormat)
      const usage = buildUsage(result.usage, prompt, jsonText)

      sendJson(
        res,
        200,
        createResponsesResponse(
          responseId,
          result.model || model,
          jsonText,
          usage,
          result.reasoningText,
          finalized.toolCalls,
        ),
      )

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

const handleResponsesStreaming = async (
  res: ServerResponse,
  runner: CursorAgentRunner,
  invocation: Parameters<CursorAgentRunner["runSyncJson"]>[0],
  requestId: string,
  responseId: string,
  model: string,
  prompt: string,
  ctx: HandlerContext,
  startedAt: number,
  hermesDelegation = false,
  openRouterCompat = false,
  requestBody?: OpenAiChatRequest,
  sessionKey?: string,
): Promise<void> => {
  writeSse(res, {
    "X-Request-Id": requestId,
  })

  let closed = false
  let fullText = ""
  let reasoningText = ""
  let resolvedModel = model
  let cliUsage: Parameters<typeof buildUsage>[0]
  let cursorSessionId: string | undefined
  const itemId = `msg_${responseId}`

  const closeStream = (): void => {
    if (closed) return
    closed = true
    writeSse(res, {}, "data: [DONE]\n\n")
    endSse(res)
  }

  writeSse(
    res,
    {},
    `event: response.created\ndata: ${JSON.stringify({
      type: "response.created",
      response: {
        id: responseId,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        model,
        status: "in_progress",
      },
    })}\n\n`,
  )

  await new Promise<void>((resolve) => {
    const finish = (): void => {
      if (closed) return
      resolve()
    }

    const emitTextDelta = (text: string) => {
      if (!text) return
      fullText += text
      writeSse(
        res,
        {},
        `event: response.output_text.delta\ndata: ${JSON.stringify({
          type: "response.output_text.delta",
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          delta: text,
        })}\n\n`,
      )
    }

    runner.on("reasoning", ({ text }) => {
      if (!text) return
      reasoningText += text
      writeSse(
        res,
        {},
        `event: response.reasoning_text.delta\ndata: ${JSON.stringify({
          type: "response.reasoning_text.delta",
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          delta: text,
        })}\n\n`,
      )
    })

    runner.on("delta", ({ text }) => {
      if (openRouterCompat && looksLikeToolCallJson(text)) return
      emitTextDelta(text)
    })

    runner.on("result", ({ text, model: detectedModel, usage, sessionId, reasoningText: resultReasoning }) => {
      if (sessionId) cursorSessionId = sessionId
      if (text && !fullText.includes(text)) fullText = text
      resolvedModel = detectedModel || model
      cliUsage = usage
      if (resultReasoning) reasoningText = resultReasoning
    })

    runner.on("error", (error) => {
      writeSse(
        res,
        {},
        `data: ${JSON.stringify({ error: { message: error.message, type: "server_error", code: null } })}\n\n`,
      )
      closeStream()
      finish()
    })

    runner
      .runStream(invocation)
      .then(() => {
        if (closed) {
          finish()
          return
        }

        const rawToolCalls = fixToolCalls(parseToolCallsFromText(fullText))
        const finalized = hermesDelegation
          ? finalizeHermesDelegationOutput(hermesDelegation, fullText, rawToolCalls)
          : finalizeOpenRouterOutput(
              openRouterCompat,
              fullText,
              requestBody ?? { messages: [] },
              rawToolCalls,
            )
        const jsonText = finalizeJsonModeOutput(finalized.text || fullText, parseResponseFormat(requestBody ?? { messages: [] }))
        const usage = buildUsage(cliUsage, prompt, jsonText || fullText)

        if (ctx.config.sessionResume && cursorSessionId && sessionKey) {
          ctx.sessionStore.set(sessionKey, cursorSessionId)
        }

        const response = createResponsesResponse(
          responseId,
          resolvedModel,
          jsonText || fullText,
          usage,
          reasoningText,
          finalized.toolCalls,
        )

        writeSse(
          res,
          {},
          `event: response.completed\ndata: ${JSON.stringify({
            type: "response.completed",
            response,
          })}\n\n`,
        )
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
          `data: ${JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error), type: "server_error", code: null } })}\n\n`,
        )
        closeStream()
        finish()
      })
  })
}

const looksLikeToolCallJson = (text: string): boolean =>
  /"tool_calls"\s*:/.test(text) || /^\s*\{/.test(text)
