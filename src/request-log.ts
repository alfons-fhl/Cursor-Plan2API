export type RequestLogEntry = {
  id: string
  timestamp: string
  method: string
  pathname: string
  status?: number
  latencyMs?: number
  model?: string
  meta?: Record<string, unknown>
}

const MAX_ENTRIES = 500
const ringBuffer: RequestLogEntry[] = []
let entryCounter = 0

/**
 * Append an entry to the in-memory request ring buffer.
 */
export const recordRequest = (entry: Omit<RequestLogEntry, "id" | "timestamp">): RequestLogEntry => {
  entryCounter += 1
  const full: RequestLogEntry = {
    id: String(entryCounter),
    timestamp: new Date().toISOString(),
    ...entry,
  }
  ringBuffer.push(full)
  if (ringBuffer.length > MAX_ENTRIES) {
    ringBuffer.shift()
  }
  return full
}

/**
 * Return recent request log entries (newest last).
 */
export const getRecentRequests = (limit = 100): RequestLogEntry[] =>
  ringBuffer.slice(-limit)

/**
 * SSE subscribers for live log tail.
 */
const subscribers = new Set<(entry: RequestLogEntry) => void>()

/**
 * Subscribe to live request log events.
 */
export const subscribeRequestLog = (
  listener: (entry: RequestLogEntry) => void,
): (() => void) => {
  subscribers.add(listener)
  return () => subscribers.delete(listener)
}

const notifySubscribers = (entry: RequestLogEntry): void => {
  for (const listener of subscribers) {
    try {
      listener(entry)
    } catch {
      // ignore subscriber errors
    }
  }
}

/**
 * Lightweight request logging for the proxy.
 */
export const logRequest = (
  verbose: boolean,
  method: string,
  pathname: string,
  meta?: Record<string, unknown>,
): void => {
  const ts = new Date().toISOString()
  const extra = meta ? ` ${JSON.stringify(meta)}` : ""
  console.error(`[cursor-plan2api] ${ts} ${method} ${pathname}${extra}`)
  if (verbose && meta) {
    console.error(`[cursor-plan2api:verbose]`, meta)
  }

  recordRequest({ method, pathname, meta })
  notifySubscribers(ringBuffer[ringBuffer.length - 1]!)
}

/**
 * Log a completed response summary.
 */
export const logResponse = (
  verbose: boolean,
  requestId: string,
  status: number,
  latencyMs: number,
  meta?: Record<string, unknown>,
): void => {
  const extra = meta ? ` ${JSON.stringify(meta)}` : ""
  console.error(
    `[cursor-plan2api] id=${requestId} status=${status} latency=${latencyMs}ms${extra}`,
  )
  if (verbose && meta) {
    console.error(`[cursor-plan2api:verbose] id=${requestId}`, meta)
  }

  const entry = recordRequest({
    method: "RESPONSE",
    pathname: requestId,
    status,
    latencyMs,
    model: typeof meta?.model === "string" ? meta.model : undefined,
    meta,
  })
  notifySubscribers(entry)
}
