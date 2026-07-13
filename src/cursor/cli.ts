import { spawn } from "node:child_process"

import type { ProxyConfig } from "../config.js"
import type { CursorCliModel } from "./types.js"

const stripAnsi = (text: string): string =>
  text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")

/**
 * Detect rate-limit errors in Cursor CLI stderr.
 */
export const isRateLimited = (stderr: string): boolean =>
  /\b429\b|rate.?limit|too many requests/i.test(stderr)

/**
 * Parse `agent --list-models` output into model ids.
 */
export const parseModelList = (output: string): CursorCliModel[] => {
  const models: CursorCliModel[] = []

  for (const line of stripAnsi(output).split(/\r?\n/)) {
    const trimmed = line.trim()
    const match = trimmed.match(/^([A-Za-z0-9][A-Za-z0-9._:/-]*)\s+-\s+(.*)$/)
    if (!match) continue

    const id = match[1]
    const name = match[2].replace(/\s*\([^)]*\)\s*$/g, "").trim()
    models.push({ id, name: name || id })
  }

  const byId = new Map(models.map((model) => [model.id, model]))
  return [...byId.values()]
}

/**
 * List models from the local Cursor CLI.
 */
export const listCursorModels = async (
  config: ProxyConfig,
): Promise<CursorCliModel[]> => {
  const result = await runAgentCommand(config, ["--list-models"], {
    timeoutMs: 30_000,
  })

  if (result.code !== 0) {
    throw new Error(
      `agent --list-models failed: ${result.stderr.trim() || result.stdout.trim()}`,
    )
  }

  return parseModelList(result.stdout)
}

/**
 * Verify that the Cursor CLI is installed and authenticated.
 */
export const verifyCursorCli = async (
  config: ProxyConfig,
): Promise<{ ok: boolean; version?: string; error?: string }> => {
  const versionResult = await runAgentCommand(config, ["--version"], {
    timeoutMs: 10_000,
  })

  if (versionResult.code !== 0) {
    return {
      ok: false,
      error: versionResult.stderr.trim() || "Cursor CLI is not available",
    }
  }

  const statusResult = await runAgentCommand(config, ["status"], {
    timeoutMs: 15_000,
  })

  if (statusResult.code !== 0 || !/logged in/i.test(statusResult.stdout)) {
    return {
      ok: false,
      error: "Cursor CLI is installed but not logged in. Run: agent login",
    }
  }

  return {
    ok: true,
    version: versionResult.stdout.trim(),
  }
}

type RunOptions = {
  timeoutMs: number
  cwd?: string
  stdin?: string
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

type RunResult = {
  code: number | null
  stdout: string
  stderr: string
}

/**
 * Run the Cursor CLI with the given arguments.
 */
export const runAgentCommand = (
  config: ProxyConfig,
  args: string[],
  options: RunOptions,
): Promise<RunResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(config.agentBin, args, {
      cwd: options.cwd ?? process.cwd(),
      env: {
        ...process.env,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        TERM: "dumb",
      },
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    })

    let stdout = ""
    let stderr = ""
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, options.timeoutMs)

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      options.onStdout?.(text)
    })

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      options.onStderr?.(text)
    })

    child.on("error", (error) => {
      clearTimeout(timer)
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            `Cursor CLI '${config.agentBin}' not found. Install: curl https://cursor.com/install -fsS | bash`,
          ),
        )
        return
      }
      reject(error)
    })

    child.on("close", (code) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(new Error(`Cursor CLI timed out after ${options.timeoutMs}ms`))
        return
      }
      resolve({ code, stdout, stderr })
    })

    if (options.stdin !== undefined) {
      child.stdin.write(options.stdin)
      child.stdin.end()
    } else {
      child.stdin.end()
    }
  })

/**
 * Run the Cursor CLI with optional 429 retry.
 */
export const runAgentCommandWithRetry = async (
  config: ProxyConfig,
  args: string[],
  options: RunOptions,
): Promise<RunResult> => {
  let lastResult: RunResult | undefined
  let attempt = 0

  while (attempt <= config.rateLimitMaxRetries) {
    let stderr = ""
    const result = await runAgentCommand(config, args, {
      ...options,
      onStderr: (chunk) => {
        stderr += chunk
        options.onStderr?.(chunk)
      },
    })

    lastResult = result
    if (result.code === 0 || !isRateLimited(result.stderr || stderr)) {
      return result
    }

    attempt += 1
    if (attempt > config.rateLimitMaxRetries) break

    await new Promise((resolve) => {
      setTimeout(resolve, config.rateLimitRetryDelayMs * attempt)
    })
  }

  return lastResult ?? { code: 1, stdout: "", stderr: "Rate limited" }
}

export type AgentInvocation = {
  model: string
  prompt: string
  stream: boolean
  mode: ProxyConfig["agentMode"]
  workspaceDir: string
  /** Do not emit Cursor-native tool_call events (Hermes delegation). */
  suppressNativeToolCalls?: boolean
  /** Cursor CLI session id for `--resume` follow-ups. */
  resumeSessionId?: string
}

/**
 * Build CLI arguments for a chat completion request.
 */
export const buildAgentArgs = (
  config: ProxyConfig,
  invocation: AgentInvocation,
): string[] => {
  const args = ["--print"]

  if (config.forceRun) args.push("--force")
  if (config.trustWorkspace) args.push("--trust")
  if (invocation.resumeSessionId) {
    args.push("--resume", invocation.resumeSessionId)
  }
  if (invocation.mode !== "agent") args.push("--mode", invocation.mode)

  args.push("--workspace", invocation.workspaceDir, "--model", invocation.model)

  if (invocation.stream) {
    args.push("--stream-partial-output", "--output-format", "stream-json")
  } else {
    args.push("--output-format", "text")
  }

  if (!config.promptViaStdin) {
    args.push(invocation.prompt)
  }

  return args
}

/**
 * Resolve stdin content when promptViaStdin is enabled.
 */
export const resolvePromptStdin = (
  config: ProxyConfig,
  prompt: string,
): string | undefined => (config.promptViaStdin ? prompt : undefined)
