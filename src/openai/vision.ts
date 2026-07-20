import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ResolvedProxyConfig } from "../http-client.js"
import { proxiedFetch } from "../http-client.js"
import type { OpenAiContentPart } from "./types.js"

/** Maximum decoded image size (1 MB), aligned with composer-api. */
export const MAX_IMAGE_BYTES = 1_048_576

/** Default timeout for remote image downloads. */
export const IMAGE_DOWNLOAD_TIMEOUT_MS = 15_000

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

const ALLOWED_IMAGE_MIMES = new Set(Object.keys(MIME_TO_EXT))

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

/**
 * Validate that a MIME type is an allowed image format.
 */
export const isAllowedImageMime = (mime: string): boolean =>
  ALLOWED_IMAGE_MIMES.has(mime.toLowerCase())

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
 * Download an HTTPS image URL with size, timeout, and MIME validation.
 */
export const downloadImageUrl = async (
  url: string,
  proxy: ResolvedProxyConfig = {},
): Promise<{ mime: string; data: Buffer }> => {
  if (!url.startsWith("https://")) {
    throw new Error("Only https:// image URLs are supported")
  }

  const response = await proxiedFetch(
    url,
    {
      method: "GET",
      headers: { Accept: "image/*" },
      timeoutMs: IMAGE_DOWNLOAD_TIMEOUT_MS,
      redirect: "follow",
    },
    proxy,
  )

  if (!response.ok) {
    throw new Error(`Image download failed with status ${response.status}`)
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()
  if (!contentType || !isAllowedImageMime(contentType)) {
    throw new Error(`Unsupported image content-type: ${contentType ?? "unknown"}`)
  }

  const data = Buffer.from(await response.arrayBuffer())
  if (data.length === 0) {
    throw new Error("Downloaded image is empty")
  }
  if (data.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `Downloaded image exceeds ${MAX_IMAGE_BYTES} byte limit (${data.length} bytes)`,
    )
  }

  return { mime: contentType, data }
}

/**
 * Resolve an image_url part to a local file path when possible.
 */
export const resolveImagePart = async (
  part: Extract<OpenAiContentPart, { type: "image_url" }>,
  index: number,
  context: ImageAttachmentContext,
  proxy: ResolvedProxyConfig = {},
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

  let parsed = parseDataUrl(url)

  if (!parsed && url.startsWith("https://")) {
    parsed = await downloadImageUrl(url, proxy)
  }

  if (!parsed) return null

  if (!isAllowedImageMime(parsed.mime)) {
    throw new Error(`Unsupported image MIME type: ${parsed.mime}`)
  }

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
