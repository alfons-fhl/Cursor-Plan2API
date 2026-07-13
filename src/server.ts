import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http"

import type { ProxyConfig } from "./config.js"
import { RequestSemaphore } from "./concurrency.js"
import {
  handleChatCompletions,
  handleHealth,
  handleModels,
} from "./handlers/chat-completions.js"
import { handleEmbeddings } from "./handlers/embeddings.js"
import { sendJson } from "./handlers/http.js"
import { handleImageGenerations } from "./handlers/images.js"
import { sendError } from "./handlers/shared.js"
import { handleUsage } from "./handlers/usage.js"
import { logRequest } from "./request-log.js"

type ServerContext = {
  config: ProxyConfig
  cliVersion?: string
  semaphore: RequestSemaphore
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-Cursor-Mode, X-Cursor-Workspace",
}

const notFound = (res: ServerResponse): void => {
  sendJson(res, 404, {
    error: {
      message: "Not found",
      type: "invalid_request_error",
      code: null,
    },
  })
}

const applyCors = (res: ServerResponse, enabled: boolean): void => {
  if (!enabled) return
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value)
  }
}

/**
 * Create the cursor-plan2api HTTP server.
 */
export const createProxyServer = (ctx: ServerContext): Server => {
  const router = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    applyCors(res, ctx.config.corsEnabled)

    const method = req.method ?? "GET"
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname

    if (method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS)
      res.end()
      return
    }

    logRequest(ctx.config.verboseLogging, method, pathname)

    try {
      if (method === "GET" && (pathname === "/health" || pathname === "/v1/health")) {
        handleHealth(req, res, ctx)
        return
      }

      if (method === "GET" && pathname === "/v1/models") {
        await handleModels(req, res, ctx)
        return
      }

      if (method === "GET" && pathname === "/v1/usage") {
        await handleUsage(req, res, ctx)
        return
      }

      if (method === "POST" && pathname === "/v1/chat/completions") {
        await handleChatCompletions(req, res, ctx)
        return
      }

      if (method === "POST" && pathname === "/v1/embeddings") {
        await handleEmbeddings(req, res, ctx)
        return
      }

      if (method === "POST" && pathname === "/v1/images/generations") {
        await handleImageGenerations(req, res, ctx)
        return
      }

      notFound(res)
    } catch (error) {
      sendError(
        res,
        500,
        error instanceof Error ? error.message : "Internal server error",
        "server_error",
      )
    }
  }

  return createServer((req, res) => {
    void router(req, res)
  })
}

/**
 * Start listening for OpenAI-compatible requests.
 */
export const startServer = async (
  config: ProxyConfig,
  cliVersion?: string,
): Promise<Server> => {
  const server = createProxyServer({
    config,
    cliVersion,
    semaphore: new RequestSemaphore(config.maxConcurrentRequests),
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(config.port, config.host, () => resolve())
  })

  return server
}

/**
 * Register foreground PID for daemon status/stop commands.
 */
export { registerForegroundPid } from "./daemon.js"
