export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string | AnthropicContentBlock[] }

export type AnthropicThinkingConfig = {
  type: "enabled" | "disabled"
  budget_tokens?: number
}

export type AnthropicMessage = {
  role: "user" | "assistant"
  content: string | AnthropicContentBlock[]
}

export type AnthropicMessagesRequest = {
  model: string
  messages: AnthropicMessage[]
  max_tokens?: number
  system?: string | AnthropicContentBlock[]
  stream?: boolean
  tools?: Array<{
    name: string
    description?: string
    input_schema?: Record<string, unknown>
  }>
  tool_choice?: { type: "auto" | "any" | "tool"; name?: string }
  temperature?: number
  thinking?: AnthropicThinkingConfig
}

export type AnthropicMessageResponse = {
  id: string
  type: "message"
  role: "assistant"
  model: string
  content: AnthropicContentBlock[]
  stop_reason: "end_turn" | "max_tokens" | "tool_use" | "stop_sequence" | null
  stop_sequence: string | null
  usage: {
    input_tokens: number
    output_tokens: number
  }
}

export type AnthropicErrorBody = {
  type: "error"
  error: {
    type: string
    message: string
  }
}
