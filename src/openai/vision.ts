import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { OpenAiContentPart } from "./types.js"

/** Maximum decoded image size (1 MB), aligned with composer-api. */
export const MAX_IMAGE_BYTES = 1_048_576

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/tiff": "tiff",
}

/** Prompt prefix injected when images are attached for CLI vision tasks. */
export const VISION_PROMPT_PREFIX = [
  "Vision task: The user attached image file(s) saved on disk.",
  "Read and analyze each file path below using your vision capability.",
  "When multiple images are present, refer to them by number (Image 1, Image 2, …).",
  "Describe visible content accurately; do not claim you cannot see images when paths are provided.",
].join(" ")

export type ResolvedImage = {
  path: string
  mimeType: string
  sizeBytes: number
}

export type ImageAttachmentContext = {
  dir: string
  images: ResolvedImage[]
  cleanup: () => Promise<void>
}

/**
 * Parse a data URL into mime type and binary payload.
 */
export const parseDataUrl = (
  url: string,
): { mime: string; data: Buffer } | null => {
  const match = url.match(/^data:([^;]+);base64,(.+)$/i)
  if (!match) return null

  try {
    const data = Buffer.from(match[2], "base64")
    return { mime: match[1].toLowerCase(), data }
  } catch {
    return null
  }
}

const extensionForMime = (mime: string): string =>
  MIME_TO_EXT[mime.toLowerCase()] ?? "png"

/**
 * Create a temp directory for image attachments.
 */
export const createImageAttachmentContext =
  async (): Promise<ImageAttachmentContext> => {
    const dir = await mkdtemp(join(tmpdir(), "plan2api-images-"))
    const images: ResolvedImage[] = []

    return {
      dir,
      images,
      cleanup: async () => {
        await rm(dir, { recursive: true, force: true })
      },
    }
  }

/**
 * Resolve an image_url part to a local file path when possible.
 */
export const resolveImagePart = async (
  part: Extract<OpenAiContentPart, { type: "image_url" }>,
  index: number,
  context: ImageAttachmentContext,
): Promise<ResolvedImage | null> => {
  const url =
    typeof part.image_url === "string"
      ? part.image_url
      : part.image_url?.url ?? ""

  if (!url) return null

  if (url.startsWith("file://")) {
    return {
      path: url.slice("file://".length),
      mimeType: "image/png",
      sizeBytes: 0,
    }
  }

  const parsed = parseDataUrl(url)
  if (!parsed) return null

  if (parsed.data.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image ${index + 1} exceeds ${MAX_IMAGE_BYTES} byte limit (${parsed.data.length} bytes)`,
    )
  }

  const ext = extensionForMime(parsed.mime)
  const path = join(context.dir, `image-${index}.${ext}`)
  await writeFile(path, parsed.data)

  const resolved: ResolvedImage = {
    path,
    mimeType: parsed.mime,
    sizeBytes: parsed.data.length,
  }
  context.images.push(resolved)
  return resolved
}

/**
 * Extract image_url parts from multimodal content.
 */
export const extractImageParts = (
  content: string | OpenAiContentPart[] | null | undefined,
): Array<Extract<OpenAiContentPart, { type: "image_url" }>> => {
  if (!Array.isArray(content)) return []
  return content.filter(
    (part): part is Extract<OpenAiContentPart, { type: "image_url" }> =>
      part.type === "image_url",
  )
}

/**
 * Build attachment instructions for the CLI prompt.
 */
export const formatImageAttachmentsForPrompt = (
  images: ResolvedImage[],
): string => {
  if (images.length === 0) return ""

  const lines = images.map(
    (image, index) =>
      `- Image ${index + 1} (${image.mimeType}, ${image.sizeBytes} bytes): ${image.path}`,
  )

  return [`${VISION_PROMPT_PREFIX}`, ...lines, ""].join("\n")
}
