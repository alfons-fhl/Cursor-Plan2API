import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { parse as parseYaml } from "yaml"
import type { IncomingMessage, ServerResponse } from "node:http"

import type { ProxyConfig } from "../config.js"
import { authorize } from "./shared.js"

type HandlerContext = {
  config: ProxyConfig
}

const moduleDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(moduleDir, "..", "..")
const OPENAPI_YAML_PATH = join(repoRoot, "docs", "openapi.yaml")

let cachedOpenApiJson: Record<string, unknown> | undefined

const loadOpenApiJson = (): Record<string, unknown> => {
  if (cachedOpenApiJson) return cachedOpenApiJson
  const raw = readFileSync(OPENAPI_YAML_PATH, "utf8")
  cachedOpenApiJson = parseYaml(raw) as Record<string, unknown>
  return cachedOpenApiJson
}

/**
 * Handle GET /openapi.json — OpenAPI 3.1 document as JSON.
 */
export const handleOpenApiJson = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerContext,
): void => {
  if (!authorize(req, ctx.config)) {
    res.writeHead(401, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: { message: "Invalid bridge API key" } }))
    return
  }

  const spec = loadOpenApiJson()
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(spec))
}

/**
 * Handle GET /docs/openapi.yaml — raw OpenAPI YAML file.
 */
export const handleOpenApiYaml = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerContext,
): void => {
  if (!authorize(req, ctx.config)) {
    res.writeHead(401, { "Content-Type": "text/plain" })
    res.end("Unauthorized")
    return
  }

  const raw = readFileSync(OPENAPI_YAML_PATH, "utf8")
  res.writeHead(200, { "Content-Type": "application/yaml; charset=utf-8" })
  res.end(raw)
}

/**
 * Handle GET /docs — redirect to OpenAPI YAML.
 */
export const handleDocsRedirect = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerContext,
): void => {
  if (!authorize(req, ctx.config)) {
    res.writeHead(401, { "Content-Type": "text/plain" })
    res.end("Unauthorized")
    return
  }

  res.writeHead(302, { Location: "/docs/openapi.yaml" })
  res.end()
}
