import type { ProxyConfig } from "../config.js"

export type AgentProfile = {
  name: string
  agentBin?: string
  workspace?: string
}

export type ProfileSelection = {
  profile: AgentProfile
  agentBin: string
  workspace?: string
}

/**
 * Round-robin or least-recently-used rotation across configured CLI profiles.
 * Each profile may use a different `agent` binary or home directory (separate `agent login`).
 */
export class ProfileRotator {
  private roundRobinIndex = 0
  private readonly lastUsedAt = new Map<string, number>()

  constructor(
    private readonly profiles: AgentProfile[],
    private readonly rotation: ProxyConfig["profileRotation"],
    private readonly defaultAgentBin: string,
  ) {}

  /**
   * Whether profile rotation is active.
   */
  isEnabled(): boolean {
    return this.profiles.length > 0 && this.rotation !== "none"
  }

  /**
   * Select the next profile for an incoming request.
   */
  select(): ProfileSelection | undefined {
    if (this.profiles.length === 0 || this.rotation === "none") return undefined

    const profile =
      this.rotation === "lru"
        ? this.selectLru()
        : this.selectRoundRobin()

    this.lastUsedAt.set(profile.name, Date.now())

    return {
      profile,
      agentBin: profile.agentBin?.trim() || this.defaultAgentBin,
      workspace: profile.workspace?.trim() || undefined,
    }
  }

  /**
   * Merge base config with a profile-specific agent binary override.
   */
  applyConfig(base: ProxyConfig, selection?: ProfileSelection): ProxyConfig {
    if (!selection) return base
    return {
      ...base,
      agentBin: selection.agentBin,
    }
  }

  /**
   * Return configured profile names for health checks.
   */
  listNames(): string[] {
    return this.profiles.map((profile) => profile.name)
  }

  private selectRoundRobin(): AgentProfile {
    const profile = this.profiles[this.roundRobinIndex % this.profiles.length]
    this.roundRobinIndex += 1
    return profile
  }

  private selectLru(): AgentProfile {
    let chosen = this.profiles[0]
    let oldest = Number.POSITIVE_INFINITY

    for (const profile of this.profiles) {
      const usedAt = this.lastUsedAt.get(profile.name) ?? 0
      if (usedAt < oldest) {
        oldest = usedAt
        chosen = profile
      }
    }

    return chosen
  }
}

/**
 * Parse CURSOR_PLAN2API_PROFILES env value (JSON array or `name:bin:workspace` tuples).
 */
export const parseProfilesEnv = (raw: string | undefined): AgentProfile[] => {
  if (!raw?.trim()) return []

  const trimmed = raw.trim()
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed
        .map((item) => normalizeProfileRecord(item))
        .filter((profile): profile is AgentProfile => profile !== null)
    } catch {
      return []
    }
  }

  return trimmed
    .split(/[|;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, agentBin, workspace] = part.split(":").map((segment) => segment.trim())
      if (!name) return null
      return {
        name,
        ...(agentBin ? { agentBin } : {}),
        ...(workspace ? { workspace } : {}),
      }
    })
    .filter((profile): profile is AgentProfile => profile !== null)
}

const normalizeProfileRecord = (item: unknown): AgentProfile | null => {
  if (!item || typeof item !== "object") return null
  const record = item as Record<string, unknown>
  const name = String(record.name ?? record.id ?? "").trim()
  if (!name) return null

  const agentBin =
    typeof record.agent_bin === "string"
      ? record.agent_bin
      : typeof record.agentBin === "string"
        ? record.agentBin
        : undefined

  const workspace =
    typeof record.workspace === "string" ? record.workspace : undefined

  return {
    name,
    ...(agentBin?.trim() ? { agentBin: agentBin.trim() } : {}),
    ...(workspace?.trim() ? { workspace: workspace.trim() } : {}),
  }
}
