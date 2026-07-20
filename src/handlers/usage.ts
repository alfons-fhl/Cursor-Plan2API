import type { IncomingMessage, ServerResponse } from "node:http"

import type { ProxyConfig } from "../config.js"
import { fetchLocalAccountUsage } from "../cursor/auth.js"
import { estimateModelCostUsd } from "../cursor/pricing.js"
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

  const usage = await fetchLocalAccountUsage(ctx.config)
  if (!usage) {
    sendError(
      res,
      503,
      "Could not read Cursor subscription usage. Ensure agent login on macOS.",
      "server_error",
    )
    return
  }

  let totalEstimatedCostUsd = 0
  const modelsWithCost: Record<string, unknown> = {}

  for (const [modelId, modelUsage] of Object.entries(usage.models)) {
    const estimatedCostUsd = estimateModelCostUsd(
      modelId,
      modelUsage.numTokens,
      modelUsage.numRequests,
    )
    totalEstimatedCostUsd += estimatedCostUsd
    modelsWithCost[modelId] = {
      ...modelUsage,
      estimated_cost_usd: estimatedCostUsd,
    }
  }

  sendJson(res, 200, {
    object: "cursor.usage",
    provider: "Cursor-Plan2API",
    start_of_month: usage.startOfMonth,
    models: modelsWithCost,
    estimated_cost_usd_total: Math.round(totalEstimatedCostUsd * 1_000_000) / 1_000_000,
    pricing_note:
      "Cost estimates are approximate based on published model pricing; Composer models on subscription show $0.",
  })
}
