import type { IncomingMessage, ServerResponse } from "node:http"

import type { ProxyConfig } from "../config.js"
import { extractBearerToken } from "../cursor/workspace.js"
import type { OpenAiErrorBody } from "../openai/types.js"
import { sendJson } from "./http.js"

const PLACEHOLDER_KEYS = new Set(["not-needed", "no-key", "unused", "null", ""])

/**
 * Validate optional bridge API key.
 */
export const authorize = (req: IncomingMessage, config: ProxyConfig): boolean => {
  if (!config.bridgeApiKey) return true

  const token = extractBearerToken(req)
  if (!token) return false
  if (PLACEHOLDER_KEYS.has(token)) return false
  return token === config.bridgeApiKey
}

/**
 * Authorize health checks. When an API key is configured, health requires
 * auth unless CURSOR_PLAN2API_HEALTH_PUBLIC=true.
 */
export const authorizeHealth = (
  req: IncomingMessage,
  config: ProxyConfig,
): boolean => {
  if (!config.bridgeApiKey || config.healthPublic) return true
  return authorize(req, config)
}

/**
 * Send an OpenAI-compatible error response.
 */
export const sendError = (
  res: ServerResponse,
  status: number,
  message: string,
  code = "invalid_request_error",
): void => {
  const body: OpenAiErrorBody = {
    error: {
      message,
      type: code,
      code: null,
    },
  }
  sendJson(res, status, body)
}
