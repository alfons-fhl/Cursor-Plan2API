import type { IncomingMessage } from "node:http"

import type { ProxyConfig } from "../config.js"
import type { ParsedToolCall } from "../cursor/types.js"
import type { OpenAiChatRequest } from "./types.js"
import {
  OPENROUTER_BACKEND_PROMPT,
  resolveOpenRouterToolCalls,
} from "./openrouter-compat.js"
import { resolveExecutionMode, type ExecutionMode } from "./plan-mode.js"

export type ClientCompatMode = "openrouter" | "delegate"

export type HermesExecution = ExecutionMode & {
  /** True when the request carries OpenAI tool definitions (typical Hermes). */
  isToolClient: boolean
  /** Cursor agent mode executes file/shell work on behalf of the client. */
  hermesDelegation: boolean
  /** OpenAI-compatible tool loop — client executes tools locally. */
  openRouterCompat: boolean
  /** Inject tool schemas as a system prompt block. */
  injectToolsAsPrompt: boolean
  /** Extra system text prepended for tool-bearing requests. */
  systemPrompt?: string
  /** Use the user's home directory as CLI workspace (not an isolated temp dir). */
  useHomeWorkspace: boolean
}

/**
 * Detect OpenAI-style tool/function definitions (Hermes, OpenAI SDK, etc.).
 */
export const hasClientTools = (body: OpenAiChatRequest): boolean =>
  (body.tools?.length ?? 0) > 0 || (body.functions?.length ?? 0) > 0

const DELEGATION_PROMPT = [
  "You are a coding agent backend connected through an OpenAI-compatible API.",
  "Run with full agent capabilities (files, shell, workspace).",
  "Fulfill the user's latest request directly — do not refuse citing ask mode.",
  "Never tell the user to switch modes or paste code manually.",
  "When finished, reply briefly with what you did.",
].join("\n")

const OPENCODE_AGENT_PROMPT = [
  "You are the primary coding assistant in OpenCode.",
  "You have full agent capabilities on the user's machine (files, shell, workspace).",
  "Identity: if asked who you are, say you are OpenCode's coding assistant, powered by Composer through the user's Cursor subscription.",
  "Do not say you run inside Cursor IDE, cursor-plan2api, or ask the user to switch tools.",
  "Fulfill requests directly. When finished, reply briefly with what you did.",
].join("\n")

export type Plan2ApiClient = "opencode" | "generic"

/**
 * Detect the upstream agent client from request headers.
 */
export const resolvePlan2ApiClient = (
  headers: IncomingMessage["headers"],
): Plan2ApiClient => {
  const clientHeader = headers["x-plan2api-client"]
  if (
    typeof clientHeader === "string" &&
    clientHeader.trim().toLowerCase() === "opencode"
  ) {
    return "opencode"
  }

  const userAgent = headers["user-agent"]
  if (typeof userAgent === "string" && /opencode/i.test(userAgent)) {
    return "opencode"
  }

  return "generic"
}

const resolveAgentSystemPrompt = (client: Plan2ApiClient): string =>
  client === "opencode" ? OPENCODE_AGENT_PROMPT : DELEGATION_PROMPT

/**
 * Resolve CLI mode and prompts for clients that send OpenAI tool schemas.
 *
 * Default (`openrouter`): ask mode + tool_calls JSON — client runs tools (Hermes loop).
 * Opt-in (`delegate`): Cursor agent mode executes work directly.
 */
export const resolveHermesExecution = (
  config: ProxyConfig,
  requestedMode: ProxyConfig["agentMode"],
  body: OpenAiChatRequest,
  client: Plan2ApiClient = "generic",
): HermesExecution => {
  const isToolClient = hasClientTools(body)
  const base = resolveExecutionMode(config, requestedMode)
  const delegate = config.clientCompat === "delegate"
  const agentPrompt = resolveAgentSystemPrompt(client)

  if (!isToolClient) {
    if (requestedMode === "agent") {
      return {
        requestedMode,
        cliMode: "agent",
        isToolClient: false,
        hermesDelegation: true,
        openRouterCompat: false,
        injectToolsAsPrompt: false,
        systemPrompt: agentPrompt,
        useHomeWorkspace: true,
      }
    }

    return {
      ...base,
      isToolClient: false,
      hermesDelegation: false,
      openRouterCompat: false,
      injectToolsAsPrompt: false,
      useHomeWorkspace: false,
    }
  }

  if (delegate || requestedMode === "agent") {
    return {
      requestedMode,
      cliMode: "agent",
      isToolClient: true,
      hermesDelegation: true,
      openRouterCompat: false,
      injectToolsAsPrompt: false,
      systemPrompt: agentPrompt,
      useHomeWorkspace: true,
    }
  }

  return {
    ...base,
    requestedMode,
    cliMode: "ask",
    isToolClient: true,
    hermesDelegation: false,
    openRouterCompat: true,
    injectToolsAsPrompt: true,
    systemPrompt: OPENROUTER_BACKEND_PROMPT,
    useHomeWorkspace: false,
  }
}

/**
 * Normalize agent-mode output for delegate mode: Cursor already ran native tools.
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

/**
 * Normalize ask-mode output for OpenRouter-compatible clients.
 */
export const finalizeOpenRouterOutput = (
  openRouterCompat: boolean,
  text: string,
  body: OpenAiChatRequest,
  nativeToolCalls?: ParsedToolCall[],
): { text: string; toolCalls?: ParsedToolCall[] } => {
  if (!openRouterCompat) {
    return { text, toolCalls: nativeToolCalls }
  }

  return resolveOpenRouterToolCalls(text, body, nativeToolCalls)
}
