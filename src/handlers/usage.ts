import type { IncomingMessage, ServerResponse } from "node:http"

import type { ProxyConfig } from "../config.js"
import { fetchLocalAccountUsage } from "../cursor/auth.js"
import { sendJson } from "./http.js"
import { authorize, sendError } from "./shared.js"

type HandlerContext = {
  config: ProxyConfig
}

/**
 * Handle GET /v1/usage — Cursor subscription usage from api2.cursor.sh.
 */
export const handleUsage = async (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerContext,
): Promise<void> => {
  if (!authorize(req, ctx.config)) {
    sendError(res, 401, "Invalid bridge API key", "authentication_error")
    return
  }

  const usage = await fetchLocalAccountUsage()
  if (!usage) {
    sendError(
      res,
      503,
      "Could not read Cursor subscription usage. Ensure agent login on macOS.",
      "server_error",
    )
    return
  }

  sendJson(res, 200, {
    object: "cursor.usage",
    provider: "Cursor-Plan2API",
    start_of_month: usage.startOfMonth,
    models: usage.models,
  })
}
