import type { ProxyConfig } from "../config.js"
import { readKeychainToken } from "./auth.js"

export type CursorAuthSource = "cli-keychain" | "dashboard-api-key" | "none"

export type CursorAuthState = {
  source: CursorAuthSource
  token: string | null
  /** Whether Cursor CLI subscription auth is expected to work. */
  cliSubscription: boolean
  /** Whether a Dashboard API key is configured. */
  dashboardApiKey: boolean
}

/**
 * Resolve Dashboard API key from config or CURSOR_API_KEY env.
 */
export const resolveDashboardApiKey = (
  config: Pick<ProxyConfig, "cursorApiKey">,
): string | null => {
  const fromConfig = config.cursorApiKey?.trim()
  if (fromConfig) return fromConfig

  const fromEnv = process.env.CURSOR_API_KEY?.trim()
  return fromEnv || null
}

/**
 * Resolve Cursor auth for Dashboard API calls (usage, billing).
 * Execution still uses the Cursor CLI (`agent login`); the Dashboard key
 * enables cross-platform usage reporting without macOS Keychain.
 */
export const resolveCursorAuth = async (
  config: Pick<ProxyConfig, "cursorApiKey">,
): Promise<CursorAuthState> => {
  const dashboardKey = resolveDashboardApiKey(config)
  const keychainToken = await readKeychainToken()

  if (keychainToken) {
    return {
      source: "cli-keychain",
      token: keychainToken,
      cliSubscription: true,
      dashboardApiKey: Boolean(dashboardKey),
    }
  }

  if (dashboardKey) {
    return {
      source: "dashboard-api-key",
      token: dashboardKey,
      cliSubscription: true,
      dashboardApiKey: true,
    }
  }

  return {
    source: "none",
    token: null,
    cliSubscription: true,
    dashboardApiKey: false,
  }
}

/**
 * Human-readable auth label for health and admin endpoints.
 */
export const formatAuthLabel = (auth: CursorAuthState): string => {
  if (auth.source === "cli-keychain" && auth.dashboardApiKey) {
    return "cli-subscription+dashboard-api-key"
  }
  if (auth.source === "cli-keychain") return "cursor-cli-subscription"
  if (auth.source === "dashboard-api-key") return "cursor-dashboard-api-key"
  return "cursor-cli-subscription"
}
