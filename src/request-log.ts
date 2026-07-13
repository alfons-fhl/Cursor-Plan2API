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
}
