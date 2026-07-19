import type { OpenAiMessage, OpenAiToolCall } from "./types.js"

export type ResponsesInputItem =
  | string
  | {
      role?: "user" | "assistant" | "system" | "developer"
      content?: string | Array<{ type: string; text?: string; image_url?: { url?: string } }>
      type?: string
    }

export type ResponsesRequest = {
  model?: string
  input?: ResponsesInputItem | ResponsesInputItem[]
  instructions?: string
  stream?: boolean
  user?: string
  tools?: Array<{ type?: string; function?: Record<string, unknown> }>
  reasoning_effort?: string
  mode?: "ask" | "plan" | "agent"
}

export type ResponsesOutputText = {
  type: "output_text"
  text: string
}

export type ResponsesOutputMessage = {
  type: "message"
  id: string
  role: "assistant"
  status: "completed"
  content: ResponsesOutputText[]
}

export type ResponsesResponse = {
  id: string
  object: "response"
  created_at: number
  model: string
  status: "completed"
  output: ResponsesOutputMessage[]
  usage?: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
  reasoning?: {
    effort?: string
    summary?: string
  }
}

export type ResponsesStreamEvent =
  | {
      type: "response.created"
      response: Pick<ResponsesResponse, "id" | "object" | "created_at" | "model" | "status">
    }
  | {
      type: "response.output_text.delta"
      item_id: string
      output_index: number
      content_index: number
      delta: string
    }
  | {
      type: "response.reasoning_text.delta"
      item_id: string
      output_index: number
      content_index: number
      delta: string
    }
  | {
      type: "response.completed"
      response: ResponsesResponse
    }

export type ResponsesMappedChat = {
  messages: OpenAiMessage[]
  model?: string
  stream?: boolean
  user?: string
  tools?: ResponsesRequest["tools"]
  mode?: ResponsesRequest["mode"]
  reasoningEffort?: string
}
