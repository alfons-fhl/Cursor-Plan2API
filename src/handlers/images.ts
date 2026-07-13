import type { IncomingMessage, ServerResponse } from "node:http"

import type { ProxyConfig } from "../config.js"
import { generateImageViaAgent } from "../cursor/image-gen.js"
import { resolveWorkspace } from "../cursor/workspace.js"
import { readJsonBody, sendJson } from "./http.js"
import { authorize, sendError } from "./shared.js"

type HandlerContext = {
  config: ProxyConfig
}

type ImageGenerationRequest = {
  prompt: string
  model?: string
  n?: number
  size?: string
  response_format?: "url" | "b64_json"
}

const IMAGE_SIZES: Record<string, { width: number; height: number }> = {
  "256x256": { width: 256, height: 256 },
  "512x512": { width: 512, height: 512 },
  "1024x1024": { width: 1024, height: 1024 },
}

/**
 * Handle POST /v1/images/generations.
 */
export const handleImageGenerations = async (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerContext,
): Promise<void> => {
  if (!authorize(req, ctx.config)) {
    sendError(res, 401, "Invalid bridge API key", "authentication_error")
    return
  }

  let body: ImageGenerationRequest
  try {
    body = (await readJsonBody(req)) as ImageGenerationRequest
  } catch (error) {
    sendError(
      res,
      400,
      error instanceof Error ? error.message : "Invalid JSON body",
    )
    return
  }

  if (!body.prompt?.trim()) {
    sendError(res, 400, "prompt is required")
    return
  }

  const size = IMAGE_SIZES[body.size ?? "512x512"] ?? IMAGE_SIZES["512x512"]
  const model = body.model ?? ctx.config.imageModel
  const workspace = resolveWorkspace(ctx.config, undefined, true)

  try {
    const image = await generateImageViaAgent(ctx.config, {
      prompt: body.prompt.trim(),
      model,
      workspaceDir: workspace.workspaceDir,
      width: size.width,
      height: size.height,
    })

    const responseFormat = body.response_format ?? "b64_json"

    sendJson(res, 200, {
      created: Math.floor(Date.now() / 1000),
      source: image.source,
      size_bytes: image.buffer.length,
      data: [
        {
          ...(responseFormat === "b64_json"
            ? { b64_json: image.buffer.toString("base64") }
            : { url: image.filePath ? `file://${image.filePath}` : undefined }),
        },
      ],
    })
  } catch (error) {
    sendError(
      res,
      500,
      error instanceof Error ? error.message : "Image generation failed",
      "server_error",
    )
  }
}
