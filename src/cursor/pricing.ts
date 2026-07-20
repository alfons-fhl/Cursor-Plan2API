/**
 * Approximate Cursor subscription pricing per 1M tokens (USD).
 * These are estimates for cost burn-rate display — not billing truth.
 */
export const MODEL_PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "composer-2.5": { input: 0, output: 0 },
  "composer-2.5-fast": { input: 0, output: 0 },
  auto: { input: 0, output: 0 },
  "claude-sonnet-5-thinking-high": { input: 3.0, output: 15.0 },
  "claude-opus-4-8-thinking-max": { input: 15.0, output: 75.0 },
  "gpt-5.6-sol-medium": { input: 2.5, output: 10.0 },
  "gpt-5.6-terra-medium": { input: 2.5, output: 10.0 },
  "cursor-grok-4.5-high": { input: 2.0, output: 10.0 },
}

const DEFAULT_PRICING = { input: 1.0, output: 3.0 }

/**
 * Resolve pricing for a model id (prefix match for variants).
 */
export const getModelPricing = (
  modelId: string,
): { input: number; output: number } => {
  if (MODEL_PRICING_USD_PER_MTOK[modelId]) {
    return MODEL_PRICING_USD_PER_MTOK[modelId]
  }

  const prefix = Object.keys(MODEL_PRICING_USD_PER_MTOK).find((key) =>
    modelId.startsWith(key),
  )
  if (prefix) return MODEL_PRICING_USD_PER_MTOK[prefix]!

  if (modelId.includes("opus")) return { input: 15.0, output: 75.0 }
  if (modelId.includes("sonnet")) return { input: 3.0, output: 15.0 }
  if (modelId.includes("thinking")) return { input: 3.0, output: 15.0 }
  if (modelId.includes("composer")) return { input: 0, output: 0 }

  return DEFAULT_PRICING
}

export type ModelCostEstimate = {
  model: string
  num_requests: number
  num_tokens: number
  estimated_cost_usd: number
}

/**
 * Estimate USD cost from token usage for a model.
 */
export const estimateModelCostUsd = (
  modelId: string,
  numTokens: number,
  numRequests = 1,
): number => {
  const pricing = getModelPricing(modelId)
  const inputRatio = 0.7
  const inputTokens = Math.round(numTokens * inputRatio)
  const outputTokens = numTokens - inputTokens
  const cost =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  return Math.round(cost * 1_000_000) / 1_000_000 + numRequests * 0
}
