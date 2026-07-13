export type CursorCliUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export type CursorCliSystemInit = {
  type: "system"
  subtype: "init"
  model?: string
  session_id?: string
}

export type CursorCliAssistantMessage = {
  type: "assistant"
  message: {
    content: Array<{ type: "text"; text: string }>
  }
  timestamp_ms?: number
}

export type CursorCliToolCallMessage = {
  type: "tool_call"
  subtype: "started" | "completed"
  call_id?: string
  tool_call?: Record<string, unknown>
}

export type CursorCliResult = {
  type: "result"
  subtype?: string
  result: string
  usage?: CursorCliUsage
}

export type CursorCliMessage =
  | CursorCliSystemInit
  | CursorCliAssistantMessage
  | CursorCliToolCallMessage
  | CursorCliResult

export type CursorCliModel = {
  id: string
  name: string
}

export type ParsedToolCall = {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export type AgentRunOutput = {
  text: string
  model: string
  toolCalls?: ParsedToolCall[]
  usage?: CursorCliUsage
  sessionId?: string
}

export const isSystemInit = (
  message: CursorCliMessage,
): message is CursorCliSystemInit =>
  message.type === "system" && (message as CursorCliSystemInit).subtype === "init"

export const isAssistantMessage = (
  message: CursorCliMessage,
): message is CursorCliAssistantMessage => message.type === "assistant"

export const isToolCallMessage = (
  message: CursorCliMessage,
): message is CursorCliToolCallMessage => message.type === "tool_call"

export const isResultMessage = (
  message: CursorCliMessage,
): message is CursorCliResult => message.type === "result"
