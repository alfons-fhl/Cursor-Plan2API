import type { OpenAiToolCall } from "../openai/types.js"
import type { OpenAiUsage } from "../openai/tokens.js"

export type AnthropicStreamBlockType = "text" | "thinking" | "tool_use"

export type AnthropicStreamWriterState = {
  messageId: string
  model: string
  blockIndex: number
  openBlockType?: AnthropicStreamBlockType
  openBlockIndex?: number
}

/**
 * Format a single Anthropic SSE event line.
 */
export const formatAnthropicSseEvent = (
  eventType: string,
  data: Record<string, unknown>,
): string => `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`

/**
 * Create message_start event payload.
 */
export const createMessageStartEvent = (
  messageId: string,
  model: string,
  inputTokens = 0,
): string =>
  formatAnthropicSseEvent("message_start", {
    type: "message_start",
    message: {
      id: messageId,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    },
  })

/**
 * Open a new content block in the stream.
 */
export const openContentBlock = (
  state: AnthropicStreamWriterState,
  blockType: AnthropicStreamBlockType,
  extra?: Record<string, unknown>,
): { event: string; blockIndex: number } => {
  const blockIndex = state.blockIndex
  state.openBlockType = blockType
  state.openBlockIndex = blockIndex
  state.blockIndex += 1

  const contentBlock: Record<string, unknown> = { type: blockType, ...extra }
  if (blockType === "text") contentBlock.text = ""
  if (blockType === "thinking") contentBlock.thinking = ""

  return {
    blockIndex,
    event: formatAnthropicSseEvent("content_block_start", {
      type: "content_block_start",
      index: blockIndex,
      content_block: contentBlock,
    }),
  }
}

/**
 * Close the currently open content block.
 */
export const closeOpenContentBlock = (
  state: AnthropicStreamWriterState,
): string | undefined => {
  if (state.openBlockIndex === undefined) return undefined

  const event = formatAnthropicSseEvent("content_block_stop", {
    type: "content_block_stop",
    index: state.openBlockIndex,
  })

  state.openBlockType = undefined
  state.openBlockIndex = undefined
  return event
}

/**
 * Create a text delta event for the active text block.
 */
export const createTextDeltaEvent = (blockIndex: number, text: string): string =>
  formatAnthropicSseEvent("content_block_delta", {
    type: "content_block_delta",
    index: blockIndex,
    delta: { type: "text_delta", text },
  })

/**
 * Create a thinking delta event for extended thinking models.
 */
export const createThinkingDeltaEvent = (blockIndex: number, thinking: string): string =>
  formatAnthropicSseEvent("content_block_delta", {
    type: "content_block_delta",
    index: blockIndex,
    delta: { type: "thinking_delta", thinking },
  })

/**
 * Create tool_use blocks emitted after the assistant finishes streaming text.
 */
export const createToolUseBlockEvents = (
  state: AnthropicStreamWriterState,
  toolCalls: OpenAiToolCall[],
): string[] => {
  const events: string[] = []

  for (const call of toolCalls) {
    const { blockIndex, event } = openContentBlock(state, "tool_use", {
      id: call.id,
      name: call.function.name,
      input: {},
    })
    events.push(event)
    events.push(
      formatAnthropicSseEvent("content_block_delta", {
        type: "content_block_delta",
        index: blockIndex,
        delta: { type: "input_json_delta", partial_json: call.function.arguments },
      }),
    )
    events.push(
      formatAnthropicSseEvent("content_block_stop", {
        type: "content_block_stop",
        index: blockIndex,
      }),
    )
    state.openBlockType = undefined
    state.openBlockIndex = undefined
  }

  return events
}

/**
 * Create message_delta and message_stop terminal events.
 */
export const createMessageEndEvents = (
  toolCalls: OpenAiToolCall[] | undefined,
  usage: OpenAiUsage,
): string[] => [
  formatAnthropicSseEvent("message_delta", {
    type: "message_delta",
    delta: {
      stop_reason: toolCalls?.length ? "tool_use" : "end_turn",
      stop_sequence: null,
    },
    usage: { output_tokens: usage.completion_tokens },
  }),
  formatAnthropicSseEvent("message_stop", { type: "message_stop" }),
]

/**
 * Initialize stream writer state for a new Anthropic response.
 */
export const createAnthropicStreamState = (
  messageId: string,
  model: string,
): AnthropicStreamWriterState => ({
  messageId,
  model,
  blockIndex: 0,
})
