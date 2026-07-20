import type { OpenAiChatRequest } from "./types.js"
import type { OpenAiResponseFormat } from "./types.js"

export type ResponseFormat = OpenAiResponseFormat

const JSON_OBJECT_INSTRUCTION =
  "You must respond with valid JSON only. Do not wrap the response in markdown code fences. Do not include any text outside the JSON object."

const JSON_SCHEMA_INSTRUCTION = (schema?: Record<string, unknown>): string => {
  const schemaText = schema ? JSON.stringify(schema, null, 2) : "{}"
  return [
    "You must respond with valid JSON only that conforms to this schema:",
    schemaText,
    "Do not wrap the response in markdown code fences. Do not include any text outside the JSON object.",
  ].join("\n")
}

/**
 * Parse response_format from a chat request body.
 */
export const parseResponseFormat = (
  body: OpenAiChatRequest,
): ResponseFormat | undefined => {
  const rf = (body as OpenAiChatRequest & { response_format?: ResponseFormat }).response_format
  if (!rf || typeof rf !== "object") return undefined
  if (rf.type === "json_object" || rf.type === "json_schema" || rf.type === "text") {
    return rf
  }
  return undefined
}

/**
 * Build a system instruction for JSON mode.
 */
export const buildJsonModeInstruction = (format: ResponseFormat): string | undefined => {
  if (format.type === "json_object") return JSON_OBJECT_INSTRUCTION
  if (format.type === "json_schema") {
    return JSON_SCHEMA_INSTRUCTION(format.json_schema?.schema)
  }
  return undefined
}

/**
 * Strip markdown code fences from JSON mode output.
 */
export const stripJsonFences = (text: string): string => {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i)
  if (fenced?.[1]) return fenced[1].trim()

  const inline = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```/i)
  if (inline?.[1]) return inline[1].trim()

  return trimmed
}

/**
 * Apply JSON mode post-processing to assistant text.
 */
export const finalizeJsonModeOutput = (
  text: string,
  format: ResponseFormat | undefined,
): string => {
  if (!format || format.type === "text") return text
  return stripJsonFences(text)
}
