import type { OpenAiChatRequest } from "./types.js"

const DEFAULT_MAX_DESCRIPTION = 120

/**
 * Compact a JSON Schema object by removing verbose metadata.
 */
export const compactJsonSchema = (
  schema: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> => {
  if (depth > 6) return { type: "object" }

  const compact: Record<string, unknown> = {}

  if (typeof schema.type === "string") compact.type = schema.type
  if (Array.isArray(schema.enum)) compact.enum = schema.enum
  if (schema.required) compact.required = schema.required

  const properties = schema.properties
  if (properties && typeof properties === "object") {
    const next: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(properties)) {
      if (value && typeof value === "object") {
        next[key] = compactJsonSchema(value as Record<string, unknown>, depth + 1)
      }
    }
    if (Object.keys(next).length > 0) compact.properties = next
  }

  if (schema.items && typeof schema.items === "object") {
    compact.items = compactJsonSchema(schema.items as Record<string, unknown>, depth + 1)
  }

  return compact
}

/**
 * Truncate tool function metadata for large tool arrays.
 */
export const compactToolDefinition = (
  fn: Record<string, unknown>,
  maxDescription = DEFAULT_MAX_DESCRIPTION,
): Record<string, unknown> => {
  const compact: Record<string, unknown> = {
    name: fn.name,
  }

  const description = String(fn.description ?? "").trim()
  if (description) {
    compact.description =
      description.length > maxDescription
        ? `${description.slice(0, maxDescription)}…`
        : description
  }

  const parameters = fn.parameters
  if (parameters && typeof parameters === "object") {
    compact.parameters = compactJsonSchema(parameters as Record<string, unknown>)
  }

  return compact
}

/**
 * Optionally compact OpenAI tool definitions before prompt injection.
 */
export const maybeCompactTools = (
  tools: OpenAiChatRequest["tools"],
  functions: OpenAiChatRequest["functions"],
  enabled: boolean,
): { tools?: OpenAiChatRequest["tools"]; functions?: OpenAiChatRequest["functions"] } => {
  if (!enabled) return { tools, functions }

  const compactedTools = tools?.map((tool) => {
    const fn = tool.type === "function" ? tool.function : tool
    if (!fn) return tool
    return {
      type: "function" as const,
      function: compactToolDefinition(fn),
    }
  })

  const compactedFunctions = functions?.map((fn) => compactToolDefinition(fn))

  return {
    tools: compactedTools,
    functions: compactedFunctions,
  }
}
