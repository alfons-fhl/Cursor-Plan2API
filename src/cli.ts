#!/usr/bin/env node

import { loadConfig } from "./config.js"
import {
  daemonRestart,
  daemonStart,
  daemonStatus,
  daemonStop,
  registerForegroundPid,
} from "./daemon.js"
import { verifyCursorCli } from "./cursor/cli.js"
import { warmupSemanticEmbeddings } from "./openai/semantic-embeddings.js"
import { startServer } from "./server.js"

const showHelp = (): void => {
  console.log(`Cursor-Plan2API

OpenAI-compatible bridge — Cursor.ai subscription for Hermes Agent, OpenCode & OpenAI clients.

Recommended models: composer-2.5 | composer-2.5-fast | auto

Usage:
  cursor-plan2api [command] [--help]

Commands:
  start              Start as background daemon (default if no command)
  stop               Stop background daemon
  restart            Restart background daemon
  status             Show daemon status
  run                Run in foreground (same as no command with --foreground)

Environment:
  CURSOR_PLAN2API_HOST=127.0.0.1
  CURSOR_PLAN2API_PORT=8787
  CURSOR_PLAN2API_DEFAULT_MODEL=composer-2.5
  CURSOR_PLAN2API_MODE=ask
  CURSOR_PLAN2API_CHAT_ONLY=true
  CURSOR_PLAN2API_STDIN=true
  CURSOR_PLAN2API_MAX_CONCURRENT=4
  CURSOR_PLAN2API_RATE_LIMIT_RETRIES=3
  CURSOR_PLAN2API_CORS=true
  CURSOR_PLAN2API_VERBOSE=false
  CURSOR_PLAN2API_EMBEDDING_PROVIDER=semantic
  CURSOR_PLAN2API_PLAN_FAST=true
  CURSOR_PLAN2API_HEALTH_PUBLIC=false
  CURSOR_PLAN2API_API_KEY=            Optional local bearer token
  CURSOR_PLAN2API_TIMEOUT_MS=300000
  CURSOR_PLAN2API_AGENT_BIN=agent

Endpoints:
  GET  /health
  GET  /v1/models
  GET  /v1/usage
  POST /v1/chat/completions
  POST /v1/embeddings
  POST /v1/images/generations

Headers:
  X-Cursor-Mode: ask|plan|agent
  X-Cursor-Workspace: /path/to/workspace
  X-Plan2API-Client: opencode
  X-Plan2API-Session: stable-conversation-id

Clients:
  Hermes Agent  ~/.hermes/config.yaml → base_url http://127.0.0.1:8787/v1
  OpenCode      opencode.jsonc in repo or ~/.config/opencode/opencode.jsonc
`)
}

const runForeground = async (): Promise<void> => {
  const config = loadConfig()
  const check = await verifyCursorCli(config)

  if (!check.ok) {
    console.error(`Cursor CLI check failed: ${check.error}`)
    console.error("Install: curl https://cursor.com/install -fsS | bash")
    console.error("Login:   agent login")
    process.exit(1)
  }

  registerForegroundPid()
  const server = await startServer(config, check.version)

  if (config.embeddingProvider === "semantic") {
    console.log("  warming up semantic embedding model (first run may download)...")
    const warmed = await warmupSemanticEmbeddings(config)
    console.log(`  embeddings   ${warmed ? "semantic model ready" : "semantic failed, will fallback to local"}`)
  }

  const baseUrl = `http://${config.host}:${config.port}`

  console.log("Cursor-Plan2API running")
  console.log(`  auth          cursor-cli subscription (agent login)`)
  console.log(`  cli version   ${check.version ?? "unknown"}`)
  console.log(`  default model ${config.defaultModel}`)
  console.log(`  mode          ${config.agentMode}`)
  console.log(`  base url      ${baseUrl}/v1`)
  console.log(`  health        ${baseUrl}/health`)
  console.log(`  usage         ${baseUrl}/v1/usage`)

  const shutdown = (): void => {
    server.close(() => process.exit(0))
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

const main = async (): Promise<void> => {
  const args = process.argv.slice(2)

  if (args.includes("--help") || args.includes("-h")) {
    showHelp()
    return
  }

  if (args.includes("--daemon-child")) {
    await runForeground()
    return
  }

  const command = args.find((arg) => !arg.startsWith("-")) ?? "run"
  const portArg = args.find((arg) => /^\d+$/.test(arg))
  const port = portArg ? Number.parseInt(portArg, 10) : undefined

  switch (command) {
    case "start":
      daemonStart(port)
      return
    case "stop":
      daemonStop()
      return
    case "restart":
      daemonRestart(port)
      return
    case "status":
      daemonStatus()
      return
    case "run":
    default:
      await runForeground()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
