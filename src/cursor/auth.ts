import { execFile } from "node:child_process"
import { promisify } from "node:util"
import * as https from "node:https"

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

const apiGet = (path: string, token: string): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: API_HOST,
        path,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        let data = ""
        res.on("data", (chunk) => {
          data += chunk
        })
        res.on("end", () => {
          try {
            resolve(JSON.parse(data))
          } catch {
            resolve(null)
          }
        })
      },
    )

    req.on("error", reject)
    req.setTimeout(8_000, () => {
      req.destroy(new Error("Cursor API timeout"))
    })
    req.end()
  })

/**
 * Fetch subscription usage from Cursor's billing API.
 */
export const fetchAccountUsage = async (
  token: string,
): Promise<CursorAccountUsage | null> => {
  try {
    const raw = (await apiGet("/auth/usage", token)) as Record<
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
 * Fetch account usage using the local keychain token.
 */
export const fetchLocalAccountUsage = async (): Promise<CursorAccountUsage | null> => {
  const token = await readKeychainToken()
  if (!token) return null
  return fetchAccountUsage(token)
}
