import type { ProxyConfig } from "../config.js"
import type { ParsedToolCall } from "../cursor/types.js"
import type { OpenAiChatRequest } from "./types.js"
import { resolveExecutionMode, type ExecutionMode } from "./plan-mode.js"

export type HermesExecution = ExecutionMode & {
  /** True when the request carries OpenAI tool definitions (typical Hermes). */
  isToolClient: boolean
  /** Cursor agent mode executes file/shell work on behalf of Hermes. */
  hermesDelegation: boolean
  /** Inject tool schemas as a system prompt block for ask-mode tool_calls parsing. */
  injectToolsAsPrompt: boolean
  /** Extra system text prepended for Hermes-backed requests. */
  systemPrompt?: string
  /** Use the user's home directory as CLI workspace (not an isolated temp dir). */
  useHomeWorkspace: boolean
}

/**
 * Detect OpenAI-style tool/function definitions (Hermes, OpenAI SDK, etc.).
 */
export const hasClientTools = (body: OpenAiChatRequest): boolean =>
  (body.tools?.length ?? 0) > 0 || (body.functions?.length ?? 0) > 0

const HERMES_DELEGATION_PROMPT = [
  "You are the execution backend for Hermes Agent via cursor-plan2api.",
  "Run with full Cursor agent capabilities (files, shell, workspace).",
  "Fulfill the user's latest request directly — do not refuse citing ask mode.",
  "Never tell the user to switch Cursor modes or use a terminal themselves.",
  "When finished, reply briefly with what you did.",
].join("\n")

const HERMES_ASK_TOOLS_PROMPT = [
  "You are the LLM backend for Hermes Agent. You are NOT Cursor's chat UI.",
  "The Hermes client executes tools on the user's machine.",
  "When a tool is required, respond with ONLY a JSON object (no markdown, no prose):",
  '{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"<tool_name>","arguments":"<json string>"}}]}',
  "Use exact function names from the Available tools list.",
  "Never refuse by citing ask mode or Cursor agent mode.",
].join("\n")

/**
 * Resolve CLI mode and prompts for Hermes-style clients that send tool schemas.
 *
 * Default: tool-bearing requests delegate execution to Cursor agent mode so
 * file/shell tasks complete in one turn without OpenAI tool_calls from Composer.
 */
export const resolveHermesExecution = (
  config: ProxyConfig,
  requestedMode: ProxyConfig["agentMode"],
  body: OpenAiChatRequest,
): HermesExecution => {
  const isToolClient = hasClientTools(body)
  const base = resolveExecutionMode(config, requestedMode)

  if (!isToolClient) {
    return {
      ...base,
      isToolClient: false,
      hermesDelegation: false,
      injectToolsAsPrompt: false,
      useHomeWorkspace: false,
    }
  }

  if (config.hermesAgentMode && requestedMode !== "agent") {
    return {
      requestedMode,
      cliMode: "agent",
      isToolClient: true,
      hermesDelegation: true,
      injectToolsAsPrompt: false,
      systemPrompt: HERMES_DELEGATION_PROMPT,
      useHomeWorkspace: true,
    }
  }

  if (requestedMode === "ask") {
    return {
      ...base,
      isToolClient: true,
      hermesDelegation: false,
      injectToolsAsPrompt: true,
      systemPrompt: HERMES_ASK_TOOLS_PROMPT,
      useHomeWorkspace: false,
    }
  }

  return {
    ...base,
    isToolClient: true,
    hermesDelegation: true,
    injectToolsAsPrompt: false,
    systemPrompt: HERMES_DELEGATION_PROMPT,
    useHomeWorkspace: true,
  }
}

/**
 * Normalize agent-mode output for Hermes: Cursor already ran native tools.
 * Do not forward Cursor tool_calls (edit, shell, …) — Hermes cannot execute them.
 */
export const finalizeHermesDelegationOutput = (
  hermesDelegation: boolean,
  text: string,
  toolCalls?: ParsedToolCall[],
): { text: string; toolCalls?: ParsedToolCall[] } => {
  if (!hermesDelegation) {
    return { text, toolCalls }
  }

  const trimmed = text.trim()
  return {
    text: trimmed || "Task completed.",
    toolCalls: undefined,
  }
}
