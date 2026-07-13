import type { IncomingMessage } from "node:http"
import { mkdtempSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import type { ProxyConfig } from "../config.js"

export type WorkspaceContext = {
  workspaceDir: string
  cleanup?: () => void
}

const VALID_MODES = new Set<ProxyConfig["agentMode"]>(["ask", "plan", "agent"])

/**
 * Resolve the workspace directory used for a Cursor CLI invocation.
 */
export const resolveWorkspace = (
  config: ProxyConfig,
  headerWorkspace?: string | string[],
  chatOnlyOverride?: boolean,
): WorkspaceContext => {
  const headerValue = Array.isArray(headerWorkspace)
    ? headerWorkspace[0]
    : headerWorkspace

  if (headerValue?.trim()) {
    return { workspaceDir: headerValue.trim() }
  }

  const chatOnly = chatOnlyOverride ?? config.chatOnlyWorkspace
  if (!chatOnly) {
    return { workspaceDir: process.cwd() }
  }

  const workspaceDir = mkdtempSync(join(tmpdir(), "cursor-plan2api-"))
  return {
    workspaceDir,
    cleanup: () => {
      // Temp dirs are cheap; explicit cleanup is optional for v1.
    },
  }
}

/**
 * Resolve workspace for agent-mode requests (home dir unless header overrides).
 */
export const resolveAgentWorkspace = (
  headerWorkspace?: string | string[],
): WorkspaceContext => {
  const headerValue = Array.isArray(headerWorkspace)
    ? headerWorkspace[0]
    : headerWorkspace

  if (headerValue?.trim()) {
    return { workspaceDir: headerValue.trim() }
  }

  return { workspaceDir: homedir() }
}

/**
 * Resolve Cursor execution mode from headers and body.
 *
 * Precedence: body.mode > X-Cursor-Mode header > config default.
 * Returns 400 when both header and body specify different modes.
 */
export const resolveRequestMode = (
  config: ProxyConfig,
  headerMode: string | string[] | undefined,
  bodyMode?: ProxyConfig["agentMode"],
): ProxyConfig["agentMode"] => {
  const headerValue = Array.isArray(headerMode) ? headerMode[0] : headerMode
  const headerNormalized = headerValue?.trim().toLowerCase()
  const bodyNormalized = bodyMode?.toLowerCase()

  if (
    headerNormalized &&
    bodyNormalized &&
    headerNormalized !== bodyNormalized
  ) {
    throw new Error(
      `Mode conflict: body.mode='${bodyNormalized}' differs from X-Cursor-Mode='${headerNormalized}'. Use one source or match both values.`,
    )
  }

  const raw = bodyNormalized ?? headerNormalized ?? config.agentMode

  if (!VALID_MODES.has(raw as ProxyConfig["agentMode"])) {
    throw new Error(`Invalid mode '${raw}'. Allowed: ask, plan, agent`)
  }

  return raw as ProxyConfig["agentMode"]
}

/**
 * Extract bearer token from Authorization header.
 */
export const extractBearerToken = (req: IncomingMessage): string | undefined => {
  const auth = req.headers.authorization
  if (!auth?.startsWith("Bearer ")) return undefined
  return auth.slice(7).trim()
}
