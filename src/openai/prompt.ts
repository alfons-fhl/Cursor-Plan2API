import type { OpenAiMessage } from "./types.js"

/**
 * Convert multimodal or plain message content to text.
 */
export const messageContentToText = (content: OpenAiMessage["content"]): string => {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""

  return content
    .map((part) => {
      if (part.type === "text") return part.text ?? ""
      if (part.type === "image_url") {
        const url =
          typeof part.image_url === "string"
            ? part.image_url
            : part.image_url?.url ?? ""
        if (!url) return "[Image]"
        if (url.startsWith("data:")) return "[Image: inline]"
        return `[Image: ${url}]`
      }
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

/**
 * Serialize OpenAI tool definitions into a system prompt block for the CLI.
 */
export const toolsToSystemText = (
  tools?: Array<{ type?: string; function?: Record<string, unknown> }>,
  functions?: Array<Record<string, unknown>>,
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
    "You are connected through cursor-plan2api. The client executes tools locally.",
    "When you need a tool, respond with a single JSON object only:",
    '{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"<name>","arguments":"<json string>"}}]}',
    "",
    "Available tools:",
    ...defs.map((fn) => {
      const name = String(fn.name ?? "unknown")
      const description = String(fn.description ?? "")
      const parameters = fn.parameters
        ? JSON.stringify(fn.parameters, null, 2)
        : "{}"
      return `Function: ${name}\nDescription: ${description}\nParameters:\n${parameters}`
    }),
  ]

  return lines.join("\n")
}

/**
 * Build a single prompt string from OpenAI chat messages.
 */
export const buildPromptFromMessages = (messages: OpenAiMessage[]): string => {
  const systemParts: string[] = []
  const conversation: string[] = []

  for (const message of messages) {
    const text = messageContentToText(message.content)
    if (!text) continue

    if (message.role === "system" || message.role === "developer") {
      systemParts.push(text)
      continue
    }

    if (message.role === "user") {
      conversation.push(`User: ${text}`)
      continue
    }

    if (message.role === "assistant") {
      if (message.tool_calls?.length) {
        conversation.push(
          `Assistant tool calls: ${JSON.stringify(message.tool_calls)}`,
        )
      }
      if (text.trim()) conversation.push(`Assistant: ${text}`)
      continue
    }

    if (message.role === "tool" || message.role === "function") {
      const label = message.name ? `Tool (${message.name})` : "Tool"
      conversation.push(`${label}: ${text}`)
    }
  }

  const system = systemParts.length
    ? `System:\n${systemParts.join("\n\n")}\n\n`
    : ""

  return `${system}${conversation.join("\n\n")}`.trim()
}

/**
 * Normalize model ids such as `openai/composer-2.5` to `composer-2.5`.
 */
export const normalizeModelId = (raw?: string): string | undefined => {
  if (!raw?.trim()) return undefined
  const trimmed = raw.trim()
  const parts = trimmed.split("/")
  return parts[parts.length - 1] || undefined
}

/**
 * Try to parse tool calls emitted as JSON by the model.
 */
export const parseToolCallsFromText = (
  text: string,
): Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> | undefined => {
  const trimmed = text.trim()
  if (!trimmed) return undefined

  const candidates = [trimmed]
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) candidates.unshift(fenced[1].trim())

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        tool_calls?: Array<{
          id?: string
          type?: string
          function?: { name?: string; arguments?: unknown }
        }>
      }

      if (!Array.isArray(parsed.tool_calls) || parsed.tool_calls.length === 0) {
        continue
      }

      return parsed.tool_calls.map((call, index) => ({
        id: call.id ?? `call_${index + 1}`,
        type: "function" as const,
        function: {
          name: String(call.function?.name ?? ""),
          arguments:
            typeof call.function?.arguments === "string"
              ? call.function.arguments
              : JSON.stringify(call.function?.arguments ?? {}),
        },
      }))
    } catch {
      continue
    }
  }

  return undefined
}
