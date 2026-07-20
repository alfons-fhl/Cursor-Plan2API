import type { ProxyConfig } from "../config.js"
import type { AgentRunOutput } from "../cursor/types.js"
import type { CursorAgentRunner } from "../cursor/runner.js"
import type { AgentInvocation } from "../cursor/cli.js"

const CONTINUE_PROMPT =
  "Continue exactly from where you left off. Do not repeat content already written."

/**
 * Heuristic detection of truncated model output.
 */
export const isTruncatedOutput = (result: AgentRunOutput): boolean => {
  const text = result.text.trim()
  if (!text) return false

  const subtype = (result as AgentRunOutput & { subtype?: string }).subtype
  if (subtype === "max_tokens" || subtype === "length") return true

  if (result.usage?.outputTokens && result.usage.outputTokens >= 8_000) {
    return true
  }

  if (text.endsWith("```") && (text.match(/```/g)?.length ?? 0) % 2 !== 0) {
    return true
  }

  const openBraces = (text.match(/\{/g) ?? []).length
  const closeBraces = (text.match(/\}/g) ?? []).length
  if (openBraces > closeBraces && openBraces - closeBraces >= 2) {
    return true
  }

  const openBrackets = (text.match(/\[/g) ?? []).length
  const closeBrackets = (text.match(/\]/g) ?? []).length
  if (openBrackets > closeBrackets && openBrackets - closeBrackets >= 2) {
    return true
  }

  if (text.length > 500 && !/[.!?)"'`\]}>]\s*$/.test(text)) {
    const lastLine = text.split("\n").pop() ?? ""
    if (lastLine.length > 80 && !lastLine.endsWith(";")) {
      return true
    }
  }

  return false
}

/**
 * Run a sync JSON invocation with auto-continue on truncation.
 */
export const runWithAutoContinue = async (
  runner: CursorAgentRunner,
  invocation: AgentInvocation,
  config: ProxyConfig,
): Promise<AgentRunOutput> => {
  const maxContinues = config.autoContinueMax
  if (maxContinues <= 0) {
    return runner.runSyncJson(invocation)
  }

  let accumulatedText = ""
  let lastResult: AgentRunOutput | undefined
  let currentPrompt = invocation.prompt
  let sessionId = invocation.resumeSessionId

  for (let attempt = 0; attempt <= maxContinues; attempt += 1) {
    const result = await runner.runSyncJson({
      ...invocation,
      prompt: currentPrompt,
      resumeSessionId: sessionId,
    })

    if (accumulatedText && result.text) {
      accumulatedText += result.text
    } else {
      accumulatedText = result.text
    }

    lastResult = {
      ...result,
      text: accumulatedText,
    }

    sessionId = result.sessionId ?? sessionId

    if (!isTruncatedOutput(result) || attempt >= maxContinues) {
      break
    }

    currentPrompt = `${currentPrompt}\n\nAssistant: ${result.text}\n\nUser: ${CONTINUE_PROMPT}`
  }

  return lastResult!
}
