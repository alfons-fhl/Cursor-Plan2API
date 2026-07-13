import type { IncomingMessage, ServerResponse } from "node:http"

/**
 * Read a JSON request body from an HTTP request.
 */
export const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim()
  if (!raw) return {}
  return JSON.parse(raw) as unknown
}

/**
 * Send a JSON HTTP response.
 */
export const sendJson = (
  res: ServerResponse,
  status: number,
  body: unknown,
): void => {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  })
  res.end(payload)
}

/**
 * Initialize a Server-Sent Events response.
 */
export const writeSse = (
  res: ServerResponse,
  headers: Record<string, string>,
  chunk?: string,
): void => {
  if (!res.headersSent) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...headers,
    })
    res.write(":ok\n\n")
  }

  if (chunk) {
    res.write(chunk)
  }
}
