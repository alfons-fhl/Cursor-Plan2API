import { EventEmitter } from "node:events"

import type { ProxyConfig } from "../config.js"
import { parseToolCallsFromText } from "../openai/prompt.js"
import {
  buildAgentArgs,
  resolvePromptStdin,
  runAgentCommandWithRetry,
  type AgentInvocation,
} from "./cli.js"
import {
  isAssistantMessage,
  isResultMessage,
  isSystemInit,
  isToolCallMessage,
  type AgentRunOutput,
  type CursorCliUsage,
  type ParsedToolCall,
} from "./types.js"

export type AgentStreamEvents = {
  delta: [{ text: string }]
  toolCall: [{ toolCall: ParsedToolCall; index: number }]
  result: [{ text: string; model: string; toolCalls?: ParsedToolCall[]; usage?: CursorCliUsage }]
  error: [Error]
  close: [number | null]
}

/**
 * Execute Cursor CLI and parse stream-json output into assistant text.
 */
export class CursorAgentRunner extends EventEmitter<AgentStreamEvents> {
  private turnBuffer = ""
  private detectedModel = "auto"
  private sawResult = false
  private toolCallIndex = 0

  constructor(private readonly config: ProxyConfig) {
    super()
  }

  /**
   * Run the Cursor CLI in streaming mode.
   */
  async runStream(invocation: AgentInvocation): Promise<void> {
    this.turnBuffer = ""
    this.detectedModel = invocation.model
    this.sawResult = false
    this.toolCallIndex = 0

    const args = buildAgentArgs(this.config, { ...invocation, stream: true })
    const stdin = resolvePromptStdin(this.config, invocation.prompt)
    let buffer = ""

    try {
      const result = await runAgentCommandWithRetry(this.config, args, {
        cwd: invocation.workspaceDir,
        timeoutMs: this.config.requestTimeoutMs,
        stdin,
        onStdout: (chunk) => {
          buffer += chunk
          buffer = this.consumeBuffer(buffer)
        },
      })

      if (result.code !== 0) {
        throw new Error(
          result.stderr.trim() ||
            result.stdout.trim() ||
            `Cursor CLI exited with code ${result.code}`,
        )
      }
    } catch (error) {
      this.emit("error", error instanceof Error ? error : new Error(String(error)))
      return
    }

    if (buffer.trim()) {
      this.consumeBuffer(`${buffer}\n`)
    }

    if (!this.sawResult && this.turnBuffer.trim()) {
      const toolCalls = parseToolCallsFromText(this.turnBuffer)
      this.emit("result", {
        text: this.turnBuffer,
        model: this.detectedModel,
        toolCalls,
      })
    }
  }

  /**
   * Run the Cursor CLI in blocking text mode.
   */
  async runSync(invocation: AgentInvocation): Promise<AgentRunOutput> {
    const args = buildAgentArgs(this.config, { ...invocation, stream: false })
    const stdin = resolvePromptStdin(this.config, invocation.prompt)
    const result = await runAgentCommandWithRetry(this.config, args, {
      cwd: invocation.workspaceDir,
      timeoutMs: this.config.requestTimeoutMs,
      stdin,
    })

    if (result.code !== 0) {
      throw new Error(
        result.stderr.trim() ||
          result.stdout.trim() ||
          `Cursor CLI exited with code ${result.code}`,
      )
    }

    const text = result.stdout.trim()
    const toolCalls = parseToolCallsFromText(text)

    return {
      text,
      model: invocation.model,
      toolCalls,
    }
  }

  /**
   * Run the Cursor CLI in stream-json mode and return the parsed result.
   */
  async runSyncJson(invocation: AgentInvocation): Promise<AgentRunOutput> {
    this.turnBuffer = ""
    this.detectedModel = invocation.model
    this.sawResult = false
    this.toolCallIndex = 0

    const args = buildAgentArgs(this.config, { ...invocation, stream: true })
    const stdin = resolvePromptStdin(this.config, invocation.prompt)
    let buffer = ""
    let usage: CursorCliUsage | undefined
    let collectedToolCalls: ParsedToolCall[] = []

    const result = await runAgentCommandWithRetry(this.config, args, {
      cwd: invocation.workspaceDir,
      timeoutMs: this.config.requestTimeoutMs,
      stdin,
      onStdout: (chunk) => {
        buffer += chunk
        buffer = this.consumeBuffer(buffer, {
          onToolCall: (toolCall) => {
            collectedToolCalls.push(toolCall)
          },
          onUsage: (nextUsage) => {
            usage = nextUsage
          },
        })
      },
    })

    if (buffer.trim()) {
      this.consumeBuffer(`${buffer}\n`, {
        onToolCall: (toolCall) => {
          collectedToolCalls.push(toolCall)
        },
        onUsage: (nextUsage) => {
          usage = nextUsage
        },
      })
    }

    if (result.code !== 0) {
      throw new Error(
        result.stderr.trim() ||
          result.stdout.trim() ||
          `Cursor CLI exited with code ${result.code}`,
      )
    }

    const text = this.turnBuffer.trim() || result.stdout.trim()
    const parsedToolCalls = parseToolCallsFromText(text)

    return {
      text,
      model: this.detectedModel,
      toolCalls: parsedToolCalls ?? (collectedToolCalls.length ? collectedToolCalls : undefined),
      usage,
    }
  }

  private consumeBuffer(
    buffer: string,
    options?: {
      collectToolCalls?: boolean
      onToolCall?: (toolCall: ParsedToolCall) => void
      onUsage?: (usage: CursorCliUsage) => void
    },
  ): string {
    const lines = buffer.split("\n")
    const remainder = lines.pop() ?? ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const message = JSON.parse(trimmed) as Parameters<
          typeof this.handleMessage
        >[0]
        this.handleMessage(message, options)
      } catch {
        // Ignore non-json noise from the CLI.
      }
    }

    return remainder
  }

  private handleMessage(
    message: Parameters<typeof isSystemInit>[0],
    options?: {
      collectToolCalls?: boolean
      onToolCall?: (toolCall: ParsedToolCall) => void
      onUsage?: (usage: CursorCliUsage) => void
    },
  ): void {
    if (isSystemInit(message) && message.model) {
      this.detectedModel = message.model
      return
    }

    if (isAssistantMessage(message)) {
      const text = message.message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")

      if (!text || text === this.turnBuffer) return

      if (text.startsWith(this.turnBuffer)) {
        const diff = text.slice(this.turnBuffer.length)
        if (diff) this.emit("delta", { text: diff })
        this.turnBuffer = text
        return
      }

      this.emit("delta", { text })
      this.turnBuffer += text
      return
    }

    if (isToolCallMessage(message)) {
      const mapped = mapCliToolCall(message)
      if (mapped) {
        this.emit("toolCall", { toolCall: mapped, index: this.toolCallIndex })
        this.toolCallIndex += 1
        options?.onToolCall?.(mapped)
      }
      this.turnBuffer = ""
      return
    }

    if (isResultMessage(message)) {
      this.sawResult = true
      if (message.usage) {
        options?.onUsage?.(message.usage)
      }
      const toolCalls = parseToolCallsFromText(message.result ?? this.turnBuffer)
      this.emit("result", {
        text: message.result ?? this.turnBuffer,
        model: this.detectedModel,
        toolCalls,
        usage: message.usage,
      })
    }
  }
}

const mapCliToolCall = (
  message: Extract<Parameters<typeof isToolCallMessage>[0], { type: "tool_call" }>,
): ParsedToolCall | undefined => {
  if (message.subtype !== "started") return undefined

  const callId = message.call_id ?? `call_${Date.now()}`
  const toolCall = message.tool_call ?? {}
  const keys = Object.keys(toolCall)
  if (keys.length === 0) return undefined

  const toolName = keys[0].replace(/ToolCall$/i, "").replace(/^./, (c) => c.toLowerCase())
  const payload = toolCall[keys[0]] as { args?: Record<string, unknown> } | undefined
  const args = payload?.args ?? toolCall

  return {
    id: callId,
    type: "function",
    function: {
      name: toolName,
      arguments: JSON.stringify(args),
    },
  }
}
