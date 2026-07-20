import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type { ProxyConfig } from "../config.js"
import { proxiedFetch, resolveProxyConfig } from "../http-client.js"
import { resolveCursorAuth } from "./bridge-auth.js"

const execFileAsync = promisify(execFile)

const API_HOST = "api2.cursor.sh"

export type ModelUsage = {
  numRequests: number
  numRequestsTotal: number
  numTokens: number
  maxTokenUsage: number | null
  maxRequestUsage: number | null
}

export type CursorAccountUsage = {
  startOfMonth: string
  models: Record<string, ModelUsage>
}

/**
 * Read the Cursor access token from macOS Keychain.
 */
export const readKeychainToken = async (): Promise<string | null> => {
  if (process.platform !== "darwin") return null

  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      "cursor-access-token",
      "-w",
    ])
    const token = stdout.trim()
    return token || null
  } catch {
    return null
  }
}

/**
 * Fetch JSON from Cursor's Dashboard API with optional proxy support.
 */
const apiGet = async (
  path: string,
  token: string,
  config: Pick<ProxyConfig, "httpProxy" | "httpsProxy">,
): Promise<unknown> => {
  const url = `https://${API_HOST}${path}`
  const response = await proxiedFetch(
    url,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 8_000,
    },
    resolveProxyConfig(config),
  )

  if (!response.ok) {
    throw new Error(`Cursor API ${response.status}`)
  }

  return response.json()
}

/**
 * Fetch subscription usage from Cursor's billing API.
 */
export const fetchAccountUsage = async (
  token: string,
  config: Pick<ProxyConfig, "httpProxy" | "httpsProxy"> = {},
): Promise<CursorAccountUsage | null> => {
  try {
    const raw = (await apiGet("/auth/usage", token, config)) as Record<
      string,
      unknown
    > | null
    if (!raw || typeof raw !== "object") return null

    const { startOfMonth, ...rest } = raw
    return {
      startOfMonth: typeof startOfMonth === "string" ? startOfMonth : "",
      models: rest as Record<string, ModelUsage>,
    }
  } catch {
    return null
  }
}

/**
 * Fetch account usage using CLI keychain or Dashboard API key.
 */
export const fetchLocalAccountUsage = async (
  config: Pick<ProxyConfig, "cursorApiKey" | "httpProxy" | "httpsProxy"> = {},
): Promise<CursorAccountUsage | null> => {
  const auth = await resolveCursorAuth(config)
  if (!auth.token) return null
  return fetchAccountUsage(auth.token, config)
}
