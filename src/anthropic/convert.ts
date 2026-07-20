import type { OpenAiChatRequest, OpenAiMessage, OpenAiToolCall } from "../openai/types.js"
import type {
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicMessageResponse,
  AnthropicMessagesRequest,
} from "./types.js"
import type { OpenAiUsage } from "../openai/tokens.js"

const blockToText = (blocks: AnthropicContentBlock[]): string =>
  blocks
    .filter((b): b is Extract<AnthropicContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("")

/**
 * Convert Anthropic messages request to internal OpenAI chat format.
 */
export const anthropicToOpenAi = (
  body: AnthropicMessagesRequest,
): OpenAiChatRequest => {
  const messages: OpenAiMessage[] = []

  if (body.system) {
    const systemText =
      typeof body.system === "string"
        ? body.system
        : blockToText(body.system.filter((b) => b.type === "text") as Extract<AnthropicContentBlock, { type: "text" }>[])
    if (systemText) {
      messages.push({ role: "system", content: systemText })
    }
  }

  for (const message of body.messages) {
    if (typeof message.content === "string") {
      messages.push({ role: message.role, content: message.content })
      continue
    }

    const textParts: string[] = []
    const toolCalls: OpenAiToolCall[] = []
    const toolResults: Array<{ id: string; content: string }> = []

    for (const block of message.content) {
      if (block.type === "text") {
        textParts.push(block.text)
      } else if (block.type === "image") {
        const dataUrl = `data:${block.source.media_type};base64,${block.source.data}`
        messages.push({
          role: message.role,
          content: [
            ...(textParts.length ? [{ type: "text" as const, text: textParts.join("\n") }] : []),
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        })
        textParts.length = 0
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        })
      } else if (block.type === "tool_result") {
        const content =
          typeof block.content === "string"
            ? block.content
            : blockToText(block.content.filter((b) => b.type === "text") as Extract<AnthropicContentBlock, { type: "text" }>[])
        toolResults.push({ id: block.tool_use_id, content })
      }
    }

    if (toolCalls.length) {
      messages.push({
        role: "assistant",
        content: textParts.join("\n") || null,
        tool_calls: toolCalls,
      })
    } else if (textParts.length && message.role === "assistant") {
      messages.push({ role: "assistant", content: textParts.join("\n") })
    } else if (textParts.length && message.role === "user") {
      messages.push({ role: "user", content: textParts.join("\n") })
    }

    for (const result of toolResults) {
      messages.push({
        role: "tool",
        tool_call_id: result.id,
        content: result.content,
      })
    }
  }

  const tools = body.tools?.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.input_schema ?? { type: "object", properties: {} },
    },
  }))

  return {
    model: body.model,
    messages,
    stream: body.stream,
    tools,
  }
}

/**
 * Convert OpenAI completion output to Anthropic message response.
 */
export const openAiToAnthropic = (
  requestId: string,
  model: string,
  text: string,
  toolCalls: OpenAiToolCall[] | undefined,
  usage: OpenAiUsage,
): AnthropicMessageResponse => {
  const content: AnthropicContentBlock[] = []

  if (toolCalls?.length) {
    for (const call of toolCalls) {
      let input: Record<string, unknown> = {}
      try {
        input = JSON.parse(call.function.arguments) as Record<string, unknown>
      } catch {
        input = { raw: call.function.arguments }
      }
      content.push({
        type: "tool_use",
        id: call.id,
        name: call.function.name,
        input,
      })
    }
  } else if (text) {
    content.push({ type: "text", text })
  }

  return {
    id: `msg_${requestId}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: toolCalls?.length ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
    },
  }
}

/**
 * Create Anthropic SSE event lines for streaming.
 */
export const createAnthropicStreamEvents = (
  requestId: string,
  model: string,
  text: string,
  toolCalls: OpenAiToolCall[] | undefined,
  usage: OpenAiUsage,
): string[] => {
  const events: string[] = []
  const messageId = `msg_${requestId}`

  events.push(
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: usage.prompt_tokens, output_tokens: 0 },
      },
    })}\n\n`,
  )

  if (toolCalls?.length) {
    for (const [index, call] of toolCalls.entries()) {
      events.push(
        `event: content_block_start\ndata: ${JSON.stringify({
          type: "content_block_start",
          index,
          content_block: { type: "tool_use", id: call.id, name: call.function.name, input: {} },
        })}\n\n`,
      )
      events.push(
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json: call.function.arguments },
        })}\n\n`,
      )
      events.push(
        `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index })}\n\n`,
      )
    }
  } else {
    events.push(
      `event: content_block_start\ndata: ${JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      })}\n\n`,
    )
    if (text) {
      events.push(
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text },
        })}\n\n`,
      )
    }
    events.push(
      `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
    )
  }

  events.push(
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: {
        stop_reason: toolCalls?.length ? "tool_use" : "end_turn",
        stop_sequence: null,
      },
      usage: { output_tokens: usage.completion_tokens },
    })}\n\n`,
  )

  events.push(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`)

  return events
}
