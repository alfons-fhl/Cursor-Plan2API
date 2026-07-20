import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { parse as parseYaml } from "yaml"
import { z } from "zod"

import { parseExtraModels } from "./cursor/models.js"

const boolFromEnv = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined || value.trim() === "") return defaultValue
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase())
}

/** Read env with CURSOR_PLAN2API_* prefix, legacy CURSOR_PLAN2API_* fallback. */
const env = (key: string): string | undefined =>
  process.env[`CURSOR_PLAN2API_${key}`] ?? process.env[`CURSOR_PLAN2API_${key}`]

const configSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.coerce.number().int().min(1).max(65535).default(8787),
  defaultModel: z.string().default("composer-2.5"),
  agentMode: z.enum(["ask", "plan", "agent"]).default("ask"),
  chatOnlyWorkspace: z.boolean().default(true),
  agentBin: z.string().default("agent"),
  requestTimeoutMs: z.coerce.number().int().positive().default(300_000),
  bridgeApiKey: z.string().optional(),
  trustWorkspace: z.boolean().default(true),
  forceRun: z.boolean().default(true),
  promptViaStdin: z.boolean().default(true),
  maxConcurrentRequests: z.coerce.number().int().positive().default(4),
  rateLimitMaxRetries: z.coerce.number().int().min(0).max(10).default(3),
  rateLimitRetryDelayMs: z.coerce.number().int().positive().default(2_000),
  corsEnabled: z.boolean().default(true),
  verboseLogging: z.boolean().default(false),
  embeddingDimensions: z.coerce.number().int().positive().default(384),
  embeddingProvider: z.enum(["semantic", "local"]).default("semantic"),
  embeddingModel: z.string().default("Xenova/all-MiniLM-L6-v2"),
  imageModel: z.string().default("composer-2.5"),
  planFastPath: z.boolean().default(true),
  healthPublic: z.boolean().default(false),
  clientCompat: z.enum(["openrouter", "delegate"]).default("openrouter"),
  sessionResume: z.boolean().default(true),
  sessionResumeMinChars: z.coerce.number().int().positive().default(12_000),
  sessionTtlMs: z.coerce.number().int().positive().default(3_600_000),
  warmupOnStart: z.boolean().default(true),
  agentPool: z.boolean().default(false),
  agentPoolSize: z.coerce.number().int().positive().default(2),
  includeModelCatalog: z.boolean().default(true),
  extraModels: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  /** Max estimated tokens for conversation history before compression. */
  maxHistoryTokens: z.coerce.number().int().positive().default(80_000),
  /** Max auto-continue attempts when output is truncated. */
  autoContinueMax: z.coerce.number().int().min(0).max(10).default(3),
})

export type ProxyConfig = z.infer<typeof configSchema>

/** YAML keys use snake_case; map to camelCase config fields. */
const yamlKeyMap: Record<string, keyof z.input<typeof configSchema>> = {
  host: "host",
  port: "port",
  default_model: "defaultModel",
  mode: "agentMode",
  chat_only: "chatOnlyWorkspace",
  agent_bin: "agentBin",
  timeout_ms: "requestTimeoutMs",
  api_key: "bridgeApiKey",
  trust: "trustWorkspace",
  force: "forceRun",
  stdin: "promptViaStdin",
  max_concurrent: "maxConcurrentRequests",
  rate_limit_retries: "rateLimitMaxRetries",
  rate_limit_delay_ms: "rateLimitRetryDelayMs",
  cors: "corsEnabled",
  verbose: "verboseLogging",
  embedding_dims: "embeddingDimensions",
  embedding_provider: "embeddingProvider",
  embedding_model: "embeddingModel",
  image_model: "imageModel",
  plan_fast: "planFastPath",
  health_public: "healthPublic",
  client_compat: "clientCompat",
  session_resume: "sessionResume",
  session_resume_min_chars: "sessionResumeMinChars",
  session_ttl_ms: "sessionTtlMs",
  warmup_on_start: "warmupOnStart",
  agent_pool: "agentPool",
  agent_pool_size: "agentPoolSize",
  include_model_catalog: "includeModelCatalog",
  extra_models: "extraModels",
  max_history_tokens: "maxHistoryTokens",
  auto_continue_max: "autoContinueMax",
}

const normalizeYamlValue = (key: string, value: unknown): unknown => {
  if (key === "extra_models" && typeof value === "string") {
    return parseExtraModels(value)
  }
  if (key === "extra_models" && Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string") return { id: item, name: item }
      if (item && typeof item === "object" && "id" in item) {
        const record = item as { id: string; name?: string }
        return { id: record.id, name: record.name ?? record.id }
      }
      return null
    }).filter(Boolean)
  }
  return value
}

/**
 * Load optional config.yaml from ~/.cursor-plan2api/config.yaml or ./config.yaml.
 */
const loadYamlConfig = (): Record<string, unknown> => {
  const candidates = [
    join(homedir(), ".cursor-plan2api", "config.yaml"),
    join(process.cwd(), "config.yaml"),
  ]

  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      const raw = readFileSync(path, "utf8")
      const parsed = parseYaml(raw) as Record<string, unknown>
      if (!parsed || typeof parsed !== "object") continue

      const mapped: Record<string, unknown> = {}
      for (const [yamlKey, value] of Object.entries(parsed)) {
        const configKey = yamlKeyMap[yamlKey] ?? yamlKey
        mapped[configKey] = normalizeYamlValue(yamlKey, value)
      }
      return mapped
    } catch {
      continue
    }
  }

  return {}
}

const buildEnvConfig = (): Record<string, unknown> => ({
  host: env("HOST"),
  port: env("PORT"),
  defaultModel: env("DEFAULT_MODEL"),
  agentMode: env("MODE"),
  chatOnlyWorkspace: boolFromEnv(env("CHAT_ONLY"), true),
  agentBin: env("AGENT_BIN"),
  requestTimeoutMs: env("TIMEOUT_MS"),
  bridgeApiKey: env("API_KEY"),
  trustWorkspace: boolFromEnv(env("TRUST"), true),
  forceRun: boolFromEnv(env("FORCE"), true),
  promptViaStdin: boolFromEnv(env("STDIN"), true),
  maxConcurrentRequests: env("MAX_CONCURRENT"),
  rateLimitMaxRetries: env("RATE_LIMIT_RETRIES"),
  rateLimitRetryDelayMs: env("RATE_LIMIT_DELAY_MS"),
  corsEnabled: boolFromEnv(env("CORS"), true),
  verboseLogging: boolFromEnv(env("VERBOSE"), false),
  embeddingDimensions: env("EMBEDDING_DIMS"),
  embeddingProvider: env("EMBEDDING_PROVIDER"),
  embeddingModel: env("EMBEDDING_MODEL"),
  imageModel: env("IMAGE_MODEL"),
  planFastPath: boolFromEnv(env("PLAN_FAST"), true),
  healthPublic: boolFromEnv(env("HEALTH_PUBLIC"), false),
  clientCompat: env("CLIENT_COMPAT") === "delegate" ? "delegate" : "openrouter",
  sessionResume: boolFromEnv(env("SESSION_RESUME"), true),
  sessionResumeMinChars: env("SESSION_RESUME_MIN_CHARS"),
  sessionTtlMs: env("SESSION_TTL_MS"),
  warmupOnStart: boolFromEnv(env("WARMUP_ON_START"), true),
  agentPool: boolFromEnv(env("AGENT_POOL"), false),
  agentPoolSize: env("AGENT_POOL_SIZE"),
  includeModelCatalog: boolFromEnv(env("INCLUDE_MODEL_CATALOG"), true),
  extraModels: parseExtraModels(env("EXTRA_MODELS")),
  maxHistoryTokens: env("MAX_HISTORY_TOKENS"),
  autoContinueMax: env("AUTO_CONTINUE_MAX"),
})

/**
 * Merge config layers: defaults < yaml < env (env wins on conflict).
 */
const mergeDefined = (
  ...layers: Array<Record<string, unknown>>
): Record<string, unknown> => {
  const merged: Record<string, unknown> = {}
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined && value !== null && value !== "") {
        merged[key] = value
      }
    }
  }
  return merged
}

/**
 * Load proxy configuration from yaml + environment variables.
 */
export const loadConfig = (): ProxyConfig => {
  const yamlConfig = loadYamlConfig()
  const envConfig = buildEnvConfig()
  return configSchema.parse(mergeDefined(yamlConfig, envConfig))
}

/**
 * Return path to the first discovered config.yaml, if any.
 */
export const resolveConfigPath = (): string | undefined => {
  const candidates = [
    join(homedir(), ".cursor-plan2api", "config.yaml"),
    join(process.cwd(), "config.yaml"),
  ]
  return candidates.find((path) => existsSync(path))
}
