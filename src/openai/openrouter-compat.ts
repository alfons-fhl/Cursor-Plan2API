import type { ParsedToolCall } from "../cursor/types.js"
import type { OpenAiChatRequest, OpenAiToolCall } from "./types.js"
import { parseToolCallsFromText } from "./prompt.js"

/** Cursor-native tool names that must never be forwarded to Hermes/OpenAI clients. */
const CURSOR_NATIVE_TOOL_NAMES = new Set([
  "edit",
  "shell",
  "read",
  "write",
  "grep",
  "glob",
  "ls",
  "delete",
  "search",
  "web",
  "generateImage",
])

/**
 * OpenAI-compatible backend instructions for clients that execute tools locally (Hermes, SDKs).
 */
export const OPENROUTER_BACKEND_PROMPT = [
  "You are an OpenAI-compatible chat completions API backend.",
  "The client application executes all tools locally on the user's machine.",
  "You do NOT have direct file or shell access — use the client's tools when action is required.",
  "Never mention Cursor, ask mode, agent mode, or tell the user to switch modes.",
  "",
  "Response rules:",
  "1. If you need a tool: reply with ONLY a JSON object (no markdown fences, no prose):",
  '   {"tool_calls":[{"id":"call_1","type":"function","function":{"name":"<exact_tool_name>","arguments":"<json string>"}}]}',
  "2. Use exact function names from the Available tools list below.",
  "3. If no tool is needed: reply with plain assistant text only (no JSON wrapper).",
  "4. Never invent tool names that are not in the Available tools list.",
].join("\n")

/**
 * Collect allowed OpenAI function names from a chat request.
 */
export const collectAllowedToolNames = (body: OpenAiChatRequest): Set<string> => {
  const names = new Set<string>()

  for (const tool of body.tools ?? []) {
    const raw = tool.type === "function" ? tool.function : tool
    const fn = raw as Record<string, unknown> | undefined
    const name = fn?.name
    if (typeof name === "string" && name.trim()) names.add(name.trim())
  }

  for (const fn of body.functions ?? []) {
    const name = fn.name
    if (typeof name === "string" && name.trim()) names.add(String(name).trim())
  }

  return names
}

/**
 * Keep only tool calls the client declared and block Cursor-native names.
 */
export const filterClientToolCalls = (
  toolCalls: ParsedToolCall[] | undefined,
  allowedNames: Set<string>,
): OpenAiToolCall[] | undefined => {
  if (!toolCalls?.length) return undefined

  const filtered = toolCalls.filter((call) => {
    const name = call.function.name.trim()
    if (!name || CURSOR_NATIVE_TOOL_NAMES.has(name)) return false
    if (allowedNames.size === 0) return true
    return allowedNames.has(name)
  })

  return filtered.length ? filtered : undefined
}

/**
 * Parse and validate model output for OpenAI-compatible clients.
 */
export const resolveOpenRouterToolCalls = (
  text: string,
  body: OpenAiChatRequest,
  nativeToolCalls?: ParsedToolCall[],
): { text: string; toolCalls?: OpenAiToolCall[] } => {
  const allowed = collectAllowedToolNames(body)
  const parsed = parseToolCallsFromText(text)
  const merged = parsed ?? nativeToolCalls
  const toolCalls = filterClientToolCalls(merged, allowed)

  if (toolCalls?.length) {
    const stripped = stripToolCallJson(text)
    return {
      text: stripped.trim(),
      toolCalls,
    }
  }

  return { text, toolCalls: undefined }
}

/**
 * Remove a leading/trailing JSON tool_calls payload from assistant text.
 */
export const stripToolCallJson = (text: string): string => {
  const trimmed = text.trim()
  if (!trimmed) return ""

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```\s*([\s\S]*)?$/i)
  if (fenced) {
    const rest = (fenced[2] ?? "").trim()
    return rest || ""
  }

  if (trimmed.startsWith("{") && trimmed.includes("tool_calls")) {
    try {
      JSON.parse(trimmed)
      return ""
    } catch {
      // fall through
    }
  }

  return trimmed
}

/**
 * Serialize OpenAI tools for prompt injection (OpenRouter-compatible clients).
 */
export const toolsToOpenRouterSystemText = (
  tools?: OpenAiChatRequest["tools"],
  functions?: OpenAiChatRequest["functions"],
): string | undefined => {
  const defs: Array<Record<string, unknown>> = []

  for (const tool of tools ?? []) {
    const fn = tool.type === "function" ? tool.function : tool
    if (fn) defs.push(fn)
  }

  for (const fn of functions ?? []) {
    defs.push(fn)
  }

  if (defs.length === 0) return undefined

  const lines = [
    "Available tools (OpenAI function calling):",
    ...defs.map((fn) => {
      const name = String(fn.name ?? "unknown")
      const description = String(fn.description ?? "")
      const parameters = fn.parameters
        ? JSON.stringify(fn.parameters, null, 2)
        : "{}"
      return `- ${name}: ${description}\n  parameters: ${parameters}`
    }),
  ]

  return lines.join("\n")
}
