import { readFileSync, existsSync } from "node:fs"

import type { ProxyConfig } from "../config.js"
import {
  buildAgentArgs,
  resolvePromptStdin,
  runAgentCommandWithRetry,
} from "./cli.js"

export type GeneratedImage = {
  buffer: Buffer
  filePath?: string
  source: "native" | "file"
}

type GenerateImageResult = {
  success?: {
    filePath?: string
    imageData?: string
  }
}

type ToolCallPayload = {
  generateImageToolCall?: {
    args?: { description?: string; filePath?: string }
    result?: GenerateImageResult
  }
}

type StreamMessage = {
  type?: string
  subtype?: string
  tool_call?: ToolCallPayload
}

/**
 * Extract base64 image data from a completed generateImageToolCall event.
 */
export const extractImageFromToolCall = (
  message: StreamMessage,
): GeneratedImage | undefined => {
  if (message.type !== "tool_call" || message.subtype !== "completed") {
    return undefined
  }

  const result = message.tool_call?.generateImageToolCall?.result?.success
  if (!result) return undefined

  if (result.imageData) {
    return {
      buffer: Buffer.from(result.imageData, "base64"),
      filePath: result.filePath,
      source: "native",
    }
  }

  if (result.filePath && existsSync(result.filePath)) {
    return {
      buffer: readFileSync(result.filePath),
      filePath: result.filePath,
      source: "file",
    }
  }

  return undefined
}

/**
 * Generate an image using Cursor's native generateImageToolCall via the CLI.
 */
export const generateImageViaAgent = async (
  config: ProxyConfig,
  options: {
    prompt: string
    model: string
    workspaceDir: string
    width: number
    height: number
  },
): Promise<GeneratedImage> => {
  const fileName = `hc-image-${Date.now()}.png`
  const agentPrompt = [
    "Generate an image using your built-in image generation tool.",
    `Description: ${options.prompt}`,
    `Save as: ${fileName}`,
    `Target dimensions: ${options.width}x${options.height} pixels.`,
    "Use the generate_image capability — do not use Python, PIL, or shell workarounds.",
    "After generation, reply with only: done",
  ].join("\n")

  const args = buildAgentArgs(config, {
    model: options.model,
    prompt: agentPrompt,
    stream: true,
    mode: "agent",
    workspaceDir: options.workspaceDir,
  })

  let captured: GeneratedImage | undefined
  let buffer = ""

  const result = await runAgentCommandWithRetry(config, args, {
    cwd: options.workspaceDir,
    timeoutMs: config.requestTimeoutMs,
    stdin: resolvePromptStdin(config, agentPrompt),
    onStdout: (chunk) => {
      buffer += chunk
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const message = JSON.parse(trimmed) as StreamMessage
          const image = extractImageFromToolCall(message)
          if (image) captured = image
        } catch {
          // ignore non-json
        }
      }
    },
  })

  if (buffer.trim()) {
    try {
      const message = JSON.parse(buffer.trim()) as StreamMessage
      const image = extractImageFromToolCall(message)
      if (image) captured = image
    } catch {
      // ignore
    }
  }

  if (captured) return captured

  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        `Image generation failed with code ${result.code}`,
    )
  }

  throw new Error(
    "Cursor CLI completed but no generateImageToolCall result was captured",
  )
}
