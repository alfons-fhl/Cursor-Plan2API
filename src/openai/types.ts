export type OpenAiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url?: { url?: string } | string }

export type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool" | "developer" | "function"
  content?: string | OpenAiContentPart[] | null
  name?: string
  tool_call_id?: string
  tool_calls?: OpenAiToolCall[]
}

export type OpenAiToolCall = {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export type OpenAiResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: { name: string; schema?: Record<string, unknown>; strict?: boolean } }

export type OpenAiChatRequest = {
  model?: string
  messages: OpenAiMessage[]
  stream?: boolean
  stream_options?: { include_usage?: boolean }
  user?: string
  tools?: Array<{ type?: string; function?: Record<string, unknown> }>
  tool_choice?: unknown
  functions?: Array<Record<string, unknown>>
  mode?: "ask" | "plan" | "agent"
  reasoning_effort?: string
  response_format?: OpenAiResponseFormat
}

export type OpenAiChatResponse = {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: "assistant"
      content: string | null
      reasoning_content?: string | null
      tool_calls?: OpenAiToolCall[]
    }
    finish_reason: "stop" | "tool_calls" | "length" | null
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export type OpenAiChatChunk = {
  id: string
  object: "chat.completion.chunk"
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: "assistant"
      content?: string
      reasoning_content?: string
      tool_calls?: Array<{
        index: number
        id?: string
        type?: "function"
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason: "stop" | "tool_calls" | "length" | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export type OpenAiModelList = {
  object: "list"
  data: Array<{
    id: string
    object: "model"
    created: number
    owned_by: string
  }>
}

export type OpenAiErrorBody = {
  error: {
    message: string
    type: string
    code: string | null
  }
}
