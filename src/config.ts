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
  includeModelCatalog: z.boolean().default(true),
  extraModels: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
})

export type ProxyConfig = z.infer<typeof configSchema>

/**
 * Load proxy configuration from environment variables.
 */
export const loadConfig = (): ProxyConfig =>
  configSchema.parse({
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
    includeModelCatalog: boolFromEnv(env("INCLUDE_MODEL_CATALOG"), true),
    extraModels: parseExtraModels(env("EXTRA_MODELS")),
  })
