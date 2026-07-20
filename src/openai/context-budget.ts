import type { ProxyConfig } from "../config.js"
import type { OpenAiMessage } from "./types.js"
import { estimateTokens } from "./tokens.js"
import { messageContentToText } from "./prompt.js"

export type CompressionLevel = ProxyConfig["compressionLevel"]

type CompressionProfile = {
  budgetMultiplier: number
  headTailChars: number
  minKeptTurns: number
  perMessageFloor: number
}

const COMPRESSION_PROFILES: Record<CompressionLevel, CompressionProfile> = {
  minimal: {
    budgetMultiplier: 1.25,
    headTailChars: 1_000,
    minKeptTurns: 4,
    perMessageFloor: 3_000,
  },
  default: {
    budgetMultiplier: 1,
    headTailChars: 500,
    minKeptTurns: 2,
    perMessageFloor: 2_000,
  },
  aggressive: {
    budgetMultiplier: 0.6,
    headTailChars: 250,
    minKeptTurns: 1,
    perMessageFloor: 1_000,
  },
}

/**
 * Resolve effective history token budget for a compression level.
 */
export const resolveHistoryTokenBudget = (
  maxHistoryTokens: number,
  level: CompressionLevel = "default",
): number => {
  const profile = COMPRESSION_PROFILES[level]
  return Math.max(1_000, Math.floor(maxHistoryTokens * profile.budgetMultiplier))
}

/**
 * Estimate tokens for a single message.
 */
const messageTokens = (message: OpenAiMessage): number => {
  let text = messageContentToText(message.content)
  if (message.tool_calls?.length) {
    text += JSON.stringify(message.tool_calls)
  }
  return estimateTokens(text)
}

/**
 * Truncate long tool result text using head+tail preservation.
 */
const truncateToolResult = (text: string, maxChars: number, headTailChars: number): string => {
  if (text.length <= maxChars) return text

  const head = text.slice(0, headTailChars)
  const tail = text.slice(-headTailChars)
  const omitted = text.length - headTailChars * 2
  return `${head}\n\n[... truncated ${omitted} chars ...]\n\n${tail}`
}

/**
 * Compress a single message if it exceeds per-message budget.
 */
const compressMessage = (
  message: OpenAiMessage,
  maxChars: number,
  headTailChars: number,
): OpenAiMessage => {
  if (message.role !== "tool" && message.role !== "function") return message

  const text = messageContentToText(message.content)
  if (text.length <= maxChars) return message

  return {
    ...message,
    content: truncateToolResult(text, maxChars, headTailChars),
  }
}

/**
 * Compress conversation history to fit within a token budget.
 * Preserves system messages and the most recent turns; drops or truncates older content.
 */
export const compressMessages = (
  messages: OpenAiMessage[],
  maxHistoryTokens: number,
  level: CompressionLevel = "default",
): OpenAiMessage[] => {
  if (maxHistoryTokens <= 0 || messages.length === 0) return messages

  const profile = COMPRESSION_PROFILES[level]
  const effectiveBudget = resolveHistoryTokenBudget(maxHistoryTokens, level)

  const systemMessages = messages.filter(
    (m) => m.role === "system" || m.role === "developer",
  )
  const conversation = messages.filter(
    (m) => m.role !== "system" && m.role !== "developer",
  )

  const systemTokens = systemMessages.reduce((sum, m) => sum + messageTokens(m), 0)
  let budget = effectiveBudget - systemTokens
  if (budget <= 0) return [...systemMessages, ...conversation.slice(-profile.minKeptTurns)]

  const perMessageCharBudget = Math.max(
    profile.perMessageFloor,
    Math.floor((budget / Math.max(conversation.length, 1)) * 4),
  )
  const compressed = conversation.map((m) =>
    compressMessage(m, perMessageCharBudget, profile.headTailChars),
  )

  let totalTokens = compressed.reduce((sum, m) => sum + messageTokens(m), 0)

  if (totalTokens <= budget) {
    return [...systemMessages, ...compressed]
  }

  const kept: OpenAiMessage[] = []
  let runningTokens = 0

  for (let i = compressed.length - 1; i >= 0; i -= 1) {
    const msg = compressed[i]!
    const tokens = messageTokens(msg)
    if (runningTokens + tokens > budget && kept.length >= profile.minKeptTurns) {
      break
    }
    kept.unshift(msg)
    runningTokens += tokens
  }

  if (kept.length < compressed.length) {
    const dropped = compressed.length - kept.length
    kept.unshift({
      role: "user",
      content: `[${dropped} earlier message(s) omitted to fit context budget (${level})]`,
    })
  }

  return [...systemMessages, ...kept]
}
