import type { CursorCliUsage } from "../cursor/types.js"

export type OpenAiUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

/**
 * Estimate token count from text using a chars/4 heuristic.
 */
export const estimateTokens = (text: string): number =>
  Math.max(1, Math.round(text.length / 4))

/**
 * Build OpenAI usage from Cursor CLI usage or fall back to heuristics.
 */
export const buildUsage = (
  cliUsage: CursorCliUsage | undefined,
  promptText: string,
  completionText: string,
): OpenAiUsage => {
  if (cliUsage) {
    const promptTokens = cliUsage.inputTokens ?? estimateTokens(promptText)
    const completionTokens = cliUsage.outputTokens ?? estimateTokens(completionText)
    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    }
  }

  const promptTokens = estimateTokens(promptText)
  const completionTokens = estimateTokens(completionText)
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  }
}
