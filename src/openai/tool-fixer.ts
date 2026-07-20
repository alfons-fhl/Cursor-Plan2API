import type { OpenAiMessage, OpenAiToolCall } from "./types.js"

/** Common model mistakes mapped to canonical parameter names. */
const PARAM_ALIASES: Record<string, string> = {
  file_path: "path",
  filepath: "path",
  filePath: "path",
  directory: "path",
  dir: "path",
  filename: "path",
}

/**
 * Replace smart/curly quotes with ASCII equivalents.
 */
export const normalizeQuotes = (text: string): string =>
  text
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")

/**
 * Tolerant JSON parse — fixes quotes and trailing commas before parsing.
 */
export const tolerantJsonParse = (raw: string): unknown => {
  const normalized = normalizeQuotes(raw.trim())
  try {
    return JSON.parse(normalized)
  } catch {
    const repaired = normalized
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')
    return JSON.parse(repaired)
  }
}

/**
 * Normalize tool call argument keys (file_path → path, etc.).
 */
export const fixToolArguments = (argsJson: string): string => {
  if (!argsJson.trim()) return "{}"

  try {
    const parsed = tolerantJsonParse(argsJson) as Record<string, unknown>
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return normalizeQuotes(argsJson)
    }

    const fixed: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(parsed)) {
      const canonical = PARAM_ALIASES[key] ?? key
      fixed[canonical] = value
    }
    return JSON.stringify(fixed)
  } catch {
    return normalizeQuotes(argsJson)
  }
}

/**
 * Apply parameter fixes to outgoing tool calls.
 */
export const fixToolCalls = (toolCalls?: OpenAiToolCall[]): OpenAiToolCall[] | undefined => {
  if (!toolCalls?.length) return undefined

  return toolCalls.map((call) => ({
    ...call,
    function: {
      ...call.function,
      arguments: fixToolArguments(call.function.arguments),
    },
  }))
}

/**
 * Fix tool result message content (normalize quotes in JSON tool outputs).
 */
export const fixToolResultMessages = (messages: OpenAiMessage[]): OpenAiMessage[] =>
  messages.map((message) => {
    if (message.role !== "tool" && message.role !== "function") return message

    const content = message.content
    if (typeof content !== "string") return message

    const normalized = normalizeQuotes(content)
    if (normalized === content) return message
    return { ...message, content: normalized }
  })

/**
 * Fix assistant tool_calls embedded in messages.
 */
export const fixMessageToolCalls = (messages: OpenAiMessage[]): OpenAiMessage[] =>
  messages.map((message) => {
    if (!message.tool_calls?.length) return message
    return {
      ...message,
      tool_calls: fixToolCalls(message.tool_calls),
    }
  })

/**
 * Apply all tool fixes to a message array.
 */
export const applyToolFixes = (messages: OpenAiMessage[]): OpenAiMessage[] =>
  fixToolResultMessages(fixMessageToolCalls(messages))
