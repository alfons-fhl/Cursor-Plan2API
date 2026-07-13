import type { IncomingMessage, ServerResponse } from "node:http"

import type { ProxyConfig } from "../config.js"
import { embedTextsWithProvider } from "../openai/semantic-embeddings.js"
import { estimateTokens } from "../openai/tokens.js"
import { readJsonBody, sendJson } from "./http.js"
import { authorize, sendError } from "./shared.js"

type HandlerContext = {
  config: ProxyConfig
}

type EmbeddingsRequest = {
  model?: string
  input: string | string[]
  encoding_format?: "float" | "base64"
  dimensions?: number
}

/**
 * Handle POST /v1/embeddings.
 */
export const handleEmbeddings = async (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerContext,
): Promise<void> => {
  if (!authorize(req, ctx.config)) {
    sendError(res, 401, "Invalid bridge API key", "authentication_error")
    return
  }

  let body: EmbeddingsRequest
  try {
    body = (await readJsonBody(req)) as EmbeddingsRequest
  } catch (error) {
    sendError(
      res,
      400,
      error instanceof Error ? error.message : "Invalid JSON body",
    )
    return
  }

  const inputs = Array.isArray(body.input) ? body.input : [body.input]
  if (inputs.length === 0 || inputs.some((value) => typeof value !== "string")) {
    sendError(res, 400, "input must be a string or array of strings")
    return
  }

  const { vectors, model, provider, dimensions } = await embedTextsWithProvider(
    inputs,
    ctx.config,
    body.dimensions,
  )

  sendJson(res, 200, {
    object: "list",
    model: body.model ?? model,
    provider,
    dimensions,
    data: vectors.map((embedding, index) => ({
      object: "embedding",
      index,
      embedding,
    })),
    usage: {
      prompt_tokens: inputs.reduce((sum, input) => sum + estimateTokens(input), 0),
      total_tokens: inputs.reduce((sum, input) => sum + estimateTokens(input), 0),
    },
  })
}
