import type { IncomingMessage, ServerResponse } from "node:http"

import type { ProxyConfig } from "../config.js"
import type { RequestSemaphore } from "../concurrency.js"
import { listCursorModels } from "../cursor/cli.js"
import { mergeModelLists, resolvePublicModels } from "../cursor/models.js"
import { CursorAgentRunner } from "../cursor/runner.js"
import { resolveRequestMode, resolveWorkspace } from "../cursor/workspace.js"
import { resolveExecutionMode } from "../openai/plan-mode.js"
import {
  buildPromptFromMessages,
  normalizeModelId,
  parseToolCallsFromText,
  toolsToSystemText,
} from "../openai/prompt.js"
import {
  createChatResponse,
  createFinishChunk,
  createRequestId,
  createTextChunk,
  createToolCallChunk,
} from "../openai/response.js"
import { buildUsage } from "../openai/tokens.js"
import type { OpenAiChatRequest, OpenAiToolCall } from "../openai/types.js"
import { logRequest, logResponse } from "../request-log.js"
import { readJsonBody, writeSse } from "./http.js"
import { authorize, authorizeHealth, sendError } from "./shared.js"
import { sendJson } from "./http.js"

type HandlerContext = {
  config: ProxyConfig
  cliVersion?: string
  semaphore: RequestSemaphore
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
    auth: "cursor-cli-subscription",
    cli_version: ctx.cliVersion ?? "unknown",
    default_model: ctx.config.defaultModel,
    extra_models: ctx.config.extraModels.length,
    model_catalog: ctx.config.includeModelCatalog,
    mode: ctx.config.agentMode,
    plan_fast_path: ctx.config.planFastPath,
    embedding_provider: ctx.config.embeddingProvider,
    endpoints: [
      "GET /health",
      "GET /v1/models",
      "GET /v1/usage",
      "POST /v1/chat/completions",
      "POST /v1/embeddings",
      "POST /v1/images/generations",
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
    const models = resolvePublicModels(cliModels, {
      includeCatalog: ctx.config.includeModelCatalog,
      extraModels: ctx.config.extraModels,
    })
    sendJson(res, 200, {
      object: "list",
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

  const execution = resolveExecutionMode(ctx.config, requestedMode)

  const toolsText = toolsToSystemText(body.tools, body.functions)
  const systemParts: Array<{ role: "system"; content: string }> = []
  if (execution.planSystemPrompt) {
    systemParts.push({ role: "system", content: execution.planSystemPrompt })
  }
  if (toolsText) {
    systemParts.push({ role: "system", content: toolsText })
  }
  const messages = [...systemParts, ...body.messages]
  const prompt = buildPromptFromMessages(messages)
  const workspace = resolveWorkspace(
    ctx.config,
    req.headers["x-cursor-workspace"],
    execution.cliMode === "ask" ? ctx.config.chatOnlyWorkspace : undefined,
  )
  const runner = new CursorAgentRunner(ctx.config)

  const invocation = {
    model,
    prompt,
    stream: body.stream === true,
    mode: execution.cliMode,
    workspaceDir: workspace.workspaceDir,
  }

  logRequest(ctx.config.verboseLogging, "POST", "/v1/chat/completions", {
    id: requestId,
    model,
    requested_mode: requestedMode,
    cli_mode: execution.cliMode,
    plan_fast_path: execution.planSystemPrompt !== undefined,
    stream: invocation.stream,
  })

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
      )
      return
    }

    const result = await runner.runSyncJson(invocation)
    const toolCalls = result.toolCalls ?? parseToolCallsFromText(result.text)
    const usage = buildUsage(result.usage, prompt, result.text)

    sendJson(
      res,
      200,
      createChatResponse(
        requestId,
        result.model || model,
        result.text,
        toolCalls,
        usage,
      ),
    )

    logResponse(ctx.config.verboseLogging, requestId, 200, Date.now() - startedAt, {
      model: result.model || model,
      usage,
      tool_calls: toolCalls?.length ?? 0,
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
): Promise<void> => {
  writeSse(res, {
    "X-Request-Id": requestId,
  })

  let isFirst = true
  let fullText = ""
  let resolvedModel = model
  let cliUsage: Parameters<typeof buildUsage>[0]
  const streamedToolCalls = new Map<number, OpenAiToolCall>()

  await new Promise<void>((resolve) => {
    runner.on("delta", ({ text }) => {
      fullText += text
      writeSse(
        res,
        {},
        `data: ${JSON.stringify(createTextChunk(requestId, resolvedModel, text, isFirst))}\n\n`,
      )
      isFirst = false
    })

    runner.on("toolCall", ({ toolCall, index }) => {
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

    runner.on("result", ({ text, model: detectedModel, toolCalls, usage }) => {
      if (text && !fullText.includes(text)) {
        fullText = text
      }
      resolvedModel = detectedModel || model
      cliUsage = usage

      if (toolCalls?.length) {
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
      writeSse(res, {}, "data: [DONE]\n\n")
      res.end()
      resolve()
    })

    runner
      .runStream(invocation)
      .then(() => {
        const toolCalls =
          parseToolCallsFromText(fullText) ??
          (streamedToolCalls.size
            ? [...streamedToolCalls.entries()]
                .sort(([a], [b]) => a - b)
                .map(([, call]) => call)
            : undefined)
        const finishReason = toolCalls?.length ? "tool_calls" : "stop"
        const usage = buildUsage(cliUsage, prompt, fullText)

        writeSse(
          res,
          {},
          `data: ${JSON.stringify(createFinishChunk(requestId, resolvedModel, finishReason, usage))}\n\n`,
        )
        writeSse(res, {}, "data: [DONE]\n\n")
        res.end()

        logResponse(ctx.config.verboseLogging, requestId, 200, Date.now() - startedAt, {
          model: resolvedModel,
          usage,
          tool_calls: toolCalls?.length ?? 0,
        })
        resolve()
      })
      .catch((error) => {
        writeSse(
          res,
          {},
          `data: ${JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error), type: "server_error", code: null } })}\n\n`,
        )
        writeSse(res, {}, "data: [DONE]\n\n")
        res.end()
        resolve()
      })
  })
}
