import type { ProxyConfig } from "../config.js"

/**
 * System prompt injected when plan mode uses the fast ask shortcut.
 */
export const PLAN_MODE_SYSTEM_PROMPT = [
  "You are in planning mode (cursor-plan2api fast plan).",
  "Produce a concise structured plan only — do not execute tools or write files.",
  "Format:",
  "1. Goal (1 sentence)",
  "2. Steps (numbered, brief)",
  "3. Risks (bullets, optional)",
  "Keep the plan under 400 words unless the user asks for detail.",
].join("\n")

export type ExecutionMode = {
  /** Mode requested by the client. */
  requestedMode: ProxyConfig["agentMode"]
  /** Mode passed to the Cursor CLI. */
  cliMode: ProxyConfig["agentMode"]
  /** Extra system text to prepend when using the plan shortcut. */
  planSystemPrompt?: string
}

/**
 * Map requested mode to CLI execution mode.
 *
 * Plan mode in the Cursor CLI is slow (~60s+). When planFastPath is enabled,
 * plan requests run in ask mode with a planning system prompt instead.
 */
export const resolveExecutionMode = (
  config: ProxyConfig,
  requestedMode: ProxyConfig["agentMode"],
): ExecutionMode => {
  if (requestedMode === "plan" && config.planFastPath) {
    return {
      requestedMode,
      cliMode: "ask",
      planSystemPrompt: PLAN_MODE_SYSTEM_PROMPT,
    }
  }

  return {
    requestedMode,
    cliMode: requestedMode,
  }
}
