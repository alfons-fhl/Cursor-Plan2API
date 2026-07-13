import type { ProxyConfig } from "../config.js"
import { runAgentCommand } from "./cli.js"

/**
 * Run a tiny CLI request so the agent binary and Node cache are warm.
 */
export const warmupCursorCli = async (config: ProxyConfig): Promise<void> => {
  try {
    await runAgentCommand(
      config,
      [
        "--print",
        "--force",
        "--trust",
        "--mode",
        "ask",
        "--model",
        config.defaultModel,
        "--output-format",
        "text",
      ],
      {
        timeoutMs: 60_000,
        stdin: "Reply with only: ok",
      },
    )
  } catch {
    // Warmup is best-effort; failures should not block startup.
  }
}
