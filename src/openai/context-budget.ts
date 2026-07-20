import type { OpenAiMessage } from "./types.js"
import { estimateTokens } from "./tokens.js"
import { messageContentToText } from "./prompt.js"

const HEAD_TAIL_CHARS = 500

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
const truncateToolResult = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text

  const head = text.slice(0, HEAD_TAIL_CHARS)
  const tail = text.slice(-HEAD_TAIL_CHARS)
  const omitted = text.length - HEAD_TAIL_CHARS * 2
  return `${head}\n\n[... truncated ${omitted} chars ...]\n\n${tail}`
}

/**
 * Compress a single message if it exceeds per-message budget.
 */
const compressMessage = (message: OpenAiMessage, maxChars: number): OpenAiMessage => {
  if (message.role !== "tool" && message.role !== "function") return message

  const text = messageContentToText(message.content)
  if (text.length <= maxChars) return message

  return {
    ...message,
    content: truncateToolResult(text, maxChars),
  }
}

/**
 * Compress conversation history to fit within a token budget.
 * Preserves system messages and the most recent turns; drops or truncates older content.
 */
export const compressMessages = (
  messages: OpenAiMessage[],
  maxHistoryTokens: number,
): OpenAiMessage[] => {
  if (maxHistoryTokens <= 0 || messages.length === 0) return messages

  const systemMessages = messages.filter(
    (m) => m.role === "system" || m.role === "developer",
  )
  const conversation = messages.filter(
    (m) => m.role !== "system" && m.role !== "developer",
  )

  const systemTokens = systemMessages.reduce((sum, m) => sum + messageTokens(m), 0)
  let budget = maxHistoryTokens - systemTokens
  if (budget <= 0) return [...systemMessages, ...conversation.slice(-2)]

  const perMessageCharBudget = Math.max(2_000, Math.floor((budget / conversation.length) * 4))
  const compressed = conversation.map((m) => compressMessage(m, perMessageCharBudget))

  let totalTokens = compressed.reduce((sum, m) => sum + messageTokens(m), 0)

  if (totalTokens <= budget) {
    return [...systemMessages, ...compressed]
  }

  const kept: OpenAiMessage[] = []
  let runningTokens = 0

  for (let i = compressed.length - 1; i >= 0; i -= 1) {
    const msg = compressed[i]!
    const tokens = messageTokens(msg)
    if (runningTokens + tokens > budget && kept.length >= 2) {
      break
    }
    kept.unshift(msg)
    runningTokens += tokens
  }

  if (kept.length < compressed.length) {
    const dropped = compressed.length - kept.length
    kept.unshift({
      role: "user",
      content: `[${dropped} earlier message(s) omitted to fit context budget]`,
    })
  }

  return [...systemMessages, ...kept]
}
