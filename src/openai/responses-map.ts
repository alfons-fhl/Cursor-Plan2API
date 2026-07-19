import type {
  ResponsesInputItem,
  ResponsesMappedChat,
  ResponsesRequest,
  ResponsesResponse,
} from "./responses-types.js"
import type { OpenAiMessage, OpenAiToolCall } from "./types.js"
import type { OpenAiUsage } from "./tokens.js"

const toMessageContent = (
  content: NonNullable<Extract<ResponsesInputItem, object>["content"]>,
): OpenAiMessage["content"] => {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""

  return content.map((part) => {
    if (part.type === "input_text" || part.type === "text") {
      return { type: "text" as const, text: part.text ?? "" }
    }
    if (part.type === "input_image" || part.type === "image_url") {
      return {
        type: "image_url" as const,
        image_url: part.image_url ?? { url: "" },
      }
    }
    return { type: "text" as const, text: part.text ?? "" }
  })
}

/**
 * Map a Responses API request to internal OpenAI chat messages.
 */
export const mapResponsesRequestToChat = (
  body: ResponsesRequest,
): ResponsesMappedChat => {
  const messages: OpenAiMessage[] = []

  if (body.instructions?.trim()) {
    messages.push({ role: "system", content: body.instructions.trim() })
  }

  const inputItems = body.input === undefined
    ? []
    : Array.isArray(body.input)
      ? body.input
      : [body.input]

  for (const item of inputItems) {
    if (typeof item === "string") {
      messages.push({ role: "user", content: item })
      continue
    }

    if (item.type === "message" || item.role) {
      const role = item.role ?? "user"
      if (role === "system" || role === "developer") {
        messages.push({
          role: "system",
          content: toMessageContent(item.content ?? ""),
        })
        continue
      }
      if (role === "assistant") {
        messages.push({
          role: "assistant",
          content: toMessageContent(item.content ?? ""),
        })
        continue
      }
      messages.push({
        role: "user",
        content: toMessageContent(item.content ?? ""),
      })
      continue
    }

    if (item.content !== undefined) {
      messages.push({
        role: "user",
        content: toMessageContent(item.content),
      })
    }
  }

  return {
    messages,
    model: body.model,
    stream: body.stream,
    user: body.user,
    tools: body.tools,
    mode: body.mode,
    reasoningEffort: body.reasoning_effort,
  }
}

/**
 * Build a Responses API response object from assistant output.
 */
export const createResponsesResponse = (
  responseId: string,
  model: string,
  text: string,
  usage?: OpenAiUsage,
  reasoningText?: string,
  toolCalls?: OpenAiToolCall[],
): ResponsesResponse => {
  const outputText =
    toolCalls?.length && !text.trim()
      ? JSON.stringify({ tool_calls: toolCalls })
      : text

  return {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model,
    status: "completed",
    output: [
      {
        type: "message",
        id: `msg_${responseId}`,
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: outputText }],
      },
    ],
    ...(usage
      ? {
          usage: {
            input_tokens: usage.prompt_tokens,
            output_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
          },
        }
      : {}),
    ...(reasoningText?.trim()
      ? { reasoning: { summary: reasoningText.trim() } }
      : {}),
  }
}

/**
 * Determine whether reasoning output should be surfaced for a model/request.
 */
export const shouldEmitReasoning = (
  model: string,
  reasoningEffort?: string,
): boolean =>
  /thinking/i.test(model) || Boolean(reasoningEffort?.trim())
