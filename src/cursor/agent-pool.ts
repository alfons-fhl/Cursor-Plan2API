import type { ProxyConfig } from "../config.js"
import { runAgentCommand } from "./cli.js"

export type AgentPoolStats = {
  enabled: boolean
  poolSize: number
  warmCount: number
  lastWarmMs: number | null
  avgWarmMs: number | null
  lastWarmAt: string | null
}

/**
 * Keep the Cursor CLI warm between requests to reduce cold-start latency.
 */
export class AgentWarmPool {
  private warmCount = 0
  private totalWarmMs = 0
  private lastWarmMs: number | null = null
  private lastWarmAt: number | null = null
  private inFlight = 0

  constructor(private readonly config: ProxyConfig) {}

  /**
   * Warm the configured number of CLI slots on startup.
   */
  async start(): Promise<void> {
    if (!this.config.agentPool) return
    await this.warmSlots(this.config.agentPoolSize)
  }

  /**
   * Ensure at least one warm slot exists before a request.
   */
  async ensureWarm(): Promise<void> {
    if (!this.config.agentPool) return

    const staleMs = 5 * 60_000
    if (
      this.lastWarmAt === null ||
      Date.now() - this.lastWarmAt > staleMs
    ) {
      await this.warmSlots(1)
    }
  }

  /**
   * Schedule a background warm after a request completes.
   */
  scheduleRewarm(): void {
    if (!this.config.agentPool) return
    void this.warmSlots(1)
  }

  /**
   * Return pool timing stats for health checks and benchmarks.
   */
  getStats(): AgentPoolStats {
    return {
      enabled: this.config.agentPool,
      poolSize: this.config.agentPoolSize,
      warmCount: this.warmCount,
      lastWarmMs: this.lastWarmMs,
      avgWarmMs:
        this.warmCount > 0
          ? Math.round(this.totalWarmMs / this.warmCount)
          : null,
      lastWarmAt: this.lastWarmAt
        ? new Date(this.lastWarmAt).toISOString()
        : null,
    }
  }

  private async warmSlots(count: number): Promise<void> {
    const slots = Math.max(1, Math.min(count, this.config.agentPoolSize))
    const tasks = Array.from({ length: slots }, () => this.warmOnce())
    await Promise.allSettled(tasks)
  }

  private async warmOnce(): Promise<void> {
    if (!this.config.agentPool) return
    if (this.inFlight >= this.config.agentPoolSize) return

    this.inFlight += 1
    const startedAt = Date.now()

    try {
      await runAgentCommand(
        this.config,
        [
          "--print",
          "--force",
          "--trust",
          "--mode",
          "ask",
          "--model",
          this.config.defaultModel,
          "--output-format",
          "text",
        ],
        {
          timeoutMs: 60_000,
          stdin: "Reply with only: ok",
        },
      )

      const elapsed = Date.now() - startedAt
      this.warmCount += 1
      this.totalWarmMs += elapsed
      this.lastWarmMs = elapsed
      this.lastWarmAt = Date.now()

      if (this.config.verboseLogging) {
        console.log(`[agent-pool] warm slot ready in ${elapsed}ms`)
      }
    } catch {
      // Warmup is best-effort.
    } finally {
      this.inFlight = Math.max(0, this.inFlight - 1)
    }
  }
}
