import type { IncomingMessage, ServerResponse } from "node:http"

import type { ProxyConfig } from "../config.js"
import type { RequestSemaphore } from "../concurrency.js"
import type { AgentWarmPool } from "../cursor/agent-pool.js"
import { CursorSessionStore, buildResumePrompt, canResumeSession } from "../cursor/session-store.js"
import { listCursorModels } from "../cursor/cli.js"
import { resolvePublicModels } from "../cursor/models.js"
import { RECOMMENDED_MODELS, sortModelsWithRecommendedFirst } from "../models.js"
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
  createChatResponse,
  createFinishChunk,
  createReasoningChunk,
  createRequestId,
  createTextChunk,
  createToolCallChunk,
} from "../openai/response.js"
import { shouldEmitReasoning } from "../openai/responses-map.js"
import { buildUsage } from "../openai/tokens.js"
import { applyToolFixes, fixToolCalls } from "../openai/tool-fixer.js"
import type { OpenAiChatRequest, OpenAiToolCall } from "../openai/types.js"
import { logRequest, logResponse } from "../request-log.js"
import { readJsonBody, writeSse, endSse } from "./http.js"
import { authorize, authorizeHealth, sendError } from "./shared.js"
import { sendJson } from "./http.js"
import { resolveEffectiveContext, resolveWorkspaceHeader } from "./request-context.js"
import type { ProfileRotator } from "../cursor/profile-rotator.js"
import { resolveDashboardApiKey } from "../cursor/bridge-auth.js"
import { resolveSessionDbPath } from "../cursor/session-persistence.js"
import { resolveProxyConfig } from "../http-client.js"

type HandlerContext = {
  config: ProxyConfig
  cliVersion?: string
  semaphore: RequestSemaphore
  sessionStore: CursorSessionStore
  agentPool?: AgentWarmPool
  profileRotator?: ProfileRotator
}

/**
 * Handle GET /health.
 */
export const handleHealth = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerContext,
): void => {
  if (!authorizeHealth(req, ctx.config)) {
    sendError(res, 401, "Invalid bridge API key", "authentication_error")
    return
  }

  sendJson(res, 200, {
    status: "ok",
    provider: "Cursor-Plan2API",
    auth: resolveDashboardApiKey(ctx.config)
      ? "cli-subscription+dashboard-api-key"
      : "cursor-cli-subscription",
    auth_bridge: {
      cli_subscription: true,
      dashboard_api_key: Boolean(resolveDashboardApiKey(ctx.config)),
    },
    cli_version: ctx.cliVersion ?? "unknown",
    default_model: ctx.config.defaultModel,
    extra_models: ctx.config.extraModels.length,
    model_catalog: ctx.config.includeModelCatalog,
    mode: ctx.config.agentMode,
    plan_fast_path: ctx.config.planFastPath,
    hermes_agent_mode: ctx.config.clientCompat === "delegate",
    client_compat: ctx.config.clientCompat,
    session_resume: ctx.config.sessionResume,
    session_persistence: resolveSessionDbPath(ctx.config.sessionDbPath),
    compression_level: ctx.config.compressionLevel,
    outbound_proxy: Boolean(
      resolveProxyConfig(ctx.config).httpProxy || resolveProxyConfig(ctx.config).httpsProxy,
    ),
    cached_sessions: ctx.sessionStore.size(),
    recommended_models: RECOMMENDED_MODELS.map((model) => model.id),
    embedding_provider: ctx.config.embeddingProvider,
    agent_pool: ctx.agentPool?.getStats() ?? { enabled: false },
    profile_rotation: ctx.config.profileRotation,
    profiles: ctx.profileRotator?.listNames() ?? [],
    compact_tools: ctx.config.compactTools,
    endpoints: [
      "GET /health",
      "GET /v1/models",
      "GET /v1/usage",
      "POST /v1/chat/completions",
      "POST /v1/messages",
      "POST /v1/responses",
      "POST /v1/embeddings",
      "POST /v1/images/generations",
      "GET /admin",
      "GET /admin/stats",
      "GET /admin/logs",
      "GET /playground",
      "GET /openapi.json",
      "GET /docs/openapi.yaml",
    ],
    timestamp: new Date().toISOString(),
  })
}

/**
 * Handle GET /v1/models.
 */
export const handleModels = async (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerContext,
): Promise<void> => {
  if (!authorize(req, ctx.config)) {
    sendError(res, 401, "Invalid bridge API key", "authentication_error")
    return
  }

  try {
    const cliModels = await listCursorModels(ctx.config)
    const models = sortModelsWithRecommendedFirst(
      resolvePublicModels(cliModels, {
        includeCatalog: ctx.config.includeModelCatalog,
        extraModels: ctx.config.extraModels,
      }),
    )
    sendJson(res, 200, {
      object: "list",
      recommended: RECOMMENDED_MODELS,
      data: [
        ...models.map((model) => ({
          id: model.id,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "cursor",
        })),
        {
          id: "text-embedding-plan2api-semantic",
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "Cursor-Plan2API",
        },
        {
          id: "text-embedding-plan2api-local",
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "Cursor-Plan2API",
        },
      ],
    })
  } catch (error) {
    sendError(
      res,
      500,
      error instanceof Error ? error.message : "Failed to list models",
      "server_error",
    )
  }
}

/**
 * Handle POST /v1/chat/completions.
 */
export const handleChatCompletions = async (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerContext,
): Promise<void> => {
  const startedAt = Date.now()

  if (!authorize(req, ctx.config)) {
    sendError(res, 401, "Invalid bridge API key", "authentication_error")
    return
  }

  let body: OpenAiChatRequest
  try {
    body = (await readJsonBody(req)) as OpenAiChatRequest
  } catch (error) {
    sendError(
      res,
      400,
      error instanceof Error ? error.message : "Invalid JSON body",
    )
    return
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    sendError(res, 400, "messages must be a non-empty array")
    return
  }

  const requestId = createRequestId()
  const model = resolveModel(body.model, ctx.config)

  let requestedMode: ProxyConfig["agentMode"]
  try {
    requestedMode = resolveRequestMode(
      ctx.config,
      req.headers["x-cursor-mode"],
      body.mode,
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

  const fixedMessages = applyToolFixes(body.messages)
  const compressedMessages = compressMessages(
    fixedMessages,
    ctx.config.maxHistoryTokens,
    ctx.config.compressionLevel,
  )
  const messages = [...systemParts, ...compressedMessages]
  let promptCleanup: (() => Promise<void>) | undefined
  let fullPrompt = ""
  let prompt = ""

  try {
    const built = await buildPromptFromMessages(
      messages,
      resolveProxyConfig(ctx.config),
    )
    fullPrompt = built.prompt
    promptCleanup = built.cleanup

    const sessionKey = ctx.sessionStore.resolveKey(req, body, model)
    const resumeEligible =
      ctx.config.sessionResume &&
      fullPrompt.length >= ctx.config.sessionResumeMinChars &&
      canResumeSession(body.messages)
    const resumeSessionId = resumeEligible
      ? ctx.sessionStore.get(sessionKey)
      : undefined
    const resumePrompt = resumeSessionId
      ? buildResumePrompt(body.messages)
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
    const emitReasoning = shouldEmitReasoning(model, body.reasoning_effort)

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

    logRequest(ctx.config.verboseLogging, "POST", "/v1/chat/completions", {
      id: requestId,
      model,
      requested_mode: requestedMode,
      cli_mode: execution.cliMode,
      hermes_delegation: execution.hermesDelegation,
      openrouter_compat: execution.openRouterCompat,
      plan_fast_path: execution.planSystemPrompt !== undefined,
      stream: invocation.stream,
      emit_reasoning: emitReasoning,
      session_resume: Boolean(resumeSessionId),
      prompt_chars: prompt.length,
      full_prompt_chars: fullPrompt.length,
      image_attachments: built.imagePaths.length,
    })

    await ctx.agentPool?.ensureWarm()
    await ctx.semaphore.acquire()

    try {
      if (invocation.stream) {
        await handleStreamingResponse(
          res,
          runner,
          invocation,
          requestId,
          model,
          prompt,
          ctx,
          startedAt,
          execution.hermesDelegation,
          execution.openRouterCompat,
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
        ? finalizeHermesDelegationOutput(
            execution.hermesDelegation,
            result.text,
            rawToolCalls,
          )
        : finalizeOpenRouterOutput(
            execution.openRouterCompat,
            result.text,
            body,
            rawToolCalls,
          )
      const jsonText = finalizeJsonModeOutput(finalized.text, responseFormat)
      const usage = buildUsage(result.usage, prompt, jsonText)
      const finishReason = finalized.toolCalls?.length
        ? "tool_calls"
        : isTruncatedOutput(result)
          ? "length"
          : "stop"

      sendJson(
        res,
        200,
        createChatResponse(
          requestId,
          result.model || model,
          jsonText,
          finalized.toolCalls,
          usage,
          result.reasoningText,
          finishReason,
        ),
      )

      logResponse(ctx.config.verboseLogging, requestId, 200, Date.now() - startedAt, {
        model: result.model || model,
        usage,
        tool_calls: finalized.toolCalls?.length ?? 0,
        cursor_session: result.sessionId,
        resumed: Boolean(resumeSessionId),
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

const resolveModel = (
  requested: string | undefined,
  config: ProxyConfig,
): string => normalizeModelId(requested) ?? config.defaultModel

const handleStreamingResponse = async (
  res: ServerResponse,
  runner: CursorAgentRunner,
  invocation: Parameters<CursorAgentRunner["runSyncJson"]>[0],
  requestId: string,
  model: string,
  prompt: string,
  ctx: HandlerContext,
  startedAt: number,
  hermesDelegation = false,
  openRouterCompat = false,
  requestBody?: OpenAiChatRequest,
  sessionKey?: string,
  responseFormat?: ReturnType<typeof parseResponseFormat>,
): Promise<void> => {
  writeSse(res, {
    "X-Request-Id": requestId,
  })

  let isFirst = true
  let closed = false
  let fullText = ""
  let resolvedModel = model
  let cliUsage: Parameters<typeof buildUsage>[0]
  let cursorSessionId: string | undefined
  const streamedToolCalls = new Map<number, OpenAiToolCall>()

  const closeStream = (): void => {
    if (closed) return
    closed = true
    writeSse(res, {}, "data: [DONE]\n\n")
    endSse(res)
  }

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
        `data: ${JSON.stringify(createTextChunk(requestId, resolvedModel, text, isFirst))}\n\n`,
      )
      isFirst = false
    }

    runner.on("reasoning", ({ text }) => {
      if (!text) return
      writeSse(
        res,
        {},
        `data: ${JSON.stringify(createReasoningChunk(requestId, resolvedModel, text))}\n\n`,
      )
    })

    runner.on("delta", ({ text }) => {
      if (openRouterCompat && looksLikeToolCallJson(text)) return
      emitTextDelta(text)
    })

    runner.on("toolCall", ({ toolCall, index }) => {
      if (hermesDelegation || openRouterCompat) return
      streamedToolCalls.set(index, toolCall)
      writeSse(
        res,
        {},
        `data: ${JSON.stringify(createToolCallChunk(requestId, resolvedModel, index, toolCall, "start"))}\n\n`,
      )
      writeSse(
        res,
        {},
        `data: ${JSON.stringify(createToolCallChunk(requestId, resolvedModel, index, toolCall, "arguments"))}\n\n`,
      )
    })

    runner.on("result", ({ text, model: detectedModel, toolCalls, usage, sessionId }) => {
      if (sessionId) cursorSessionId = sessionId
      if (text && !fullText.includes(text)) {
        fullText = text
      }
      resolvedModel = detectedModel || model
      cliUsage = usage

      if (toolCalls?.length && !hermesDelegation && !openRouterCompat) {
        for (const [index, toolCall] of toolCalls.entries()) {
          if (streamedToolCalls.has(index)) continue
          writeSse(
            res,
            {},
            `data: ${JSON.stringify(createToolCallChunk(requestId, resolvedModel, index, toolCall, "start"))}\n\n`,
          )
          writeSse(
            res,
            {},
            `data: ${JSON.stringify(createToolCallChunk(requestId, resolvedModel, index, toolCall, "arguments"))}\n\n`,
          )
        }
      }
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
        const rawToolCalls = fixToolCalls(
          parseToolCallsFromText(fullText) ??
          (streamedToolCalls.size
            ? [...streamedToolCalls.entries()]
                .sort(([a], [b]) => a - b)
                .map(([, call]) => call)
            : undefined),
        )
        const finalized = hermesDelegation
          ? finalizeHermesDelegationOutput(hermesDelegation, fullText, rawToolCalls)
          : finalizeOpenRouterOutput(
              openRouterCompat,
              fullText,
              requestBody ?? { messages: [] },
              rawToolCalls,
            )
        const jsonText = finalizeJsonModeOutput(finalized.text || fullText, responseFormat)
        if (openRouterCompat && finalized.toolCalls?.length) {
          for (const [index, toolCall] of finalized.toolCalls.entries()) {
            if (streamedToolCalls.has(index)) continue
            writeSse(
              res,
              {},
              `data: ${JSON.stringify(createToolCallChunk(requestId, resolvedModel, index, toolCall, "start"))}\n\n`,
            )
            writeSse(
              res,
              {},
              `data: ${JSON.stringify(createToolCallChunk(requestId, resolvedModel, index, toolCall, "arguments"))}\n\n`,
            )
          }
        } else if (hermesDelegation && jsonText !== fullText && jsonText) {
          emitTextDelta(jsonText.slice(fullText.length))
          fullText = jsonText
        } else if (!openRouterCompat && jsonText && jsonText !== fullText) {
          emitTextDelta(jsonText.slice(fullText.length))
          fullText = jsonText
        }

        const finishReason = finalized.toolCalls?.length
          ? "tool_calls"
          : isTruncatedOutput({ text: fullText, model: resolvedModel })
            ? "length"
            : "stop"
        const usage = buildUsage(cliUsage, prompt, jsonText || fullText)
        const includeUsage = requestBody?.stream_options?.include_usage === true

        if (ctx.config.sessionResume && cursorSessionId && sessionKey) {
          ctx.sessionStore.set(sessionKey, cursorSessionId)
        }

        writeSse(
          res,
          {},
          `data: ${JSON.stringify(createFinishChunk(requestId, resolvedModel, finishReason, includeUsage ? usage : undefined))}\n\n`,
        )
        closeStream()

        logResponse(ctx.config.verboseLogging, requestId, 200, Date.now() - startedAt, {
          model: resolvedModel,
          usage,
          tool_calls: finalized.toolCalls?.length ?? 0,
          cursor_session: cursorSessionId,
          resumed: Boolean(invocation.resumeSessionId),
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
