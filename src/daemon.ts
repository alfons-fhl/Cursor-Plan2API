import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const STATE_DIR = join(homedir(), ".cursor-plan2api")
const PID_FILE = join(STATE_DIR, "pid")
const LOG_FILE = join(STATE_DIR, "server.log")

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const ensureStateDir = (): void => {
  mkdirSync(STATE_DIR, { recursive: true })
}

const readPid = (): number | null => {
  if (!existsSync(PID_FILE)) return null
  const raw = readFileSync(PID_FILE, "utf8").trim()
  const pid = Number.parseInt(raw, 10)
  return Number.isNaN(pid) ? null : pid
}

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const removePidFile = (): void => {
  try {
    unlinkSync(PID_FILE)
  } catch {
    // ignore
  }
}

const getEntryPath = (): string => join(__dirname, "cli.js")

/**
 * Register the current process PID for daemon management.
 */
export const registerForegroundPid = (): void => {
  ensureStateDir()
  writeFileSync(PID_FILE, String(process.pid))
}

/**
 * Print daemon status.
 */
export const daemonStatus = (): void => {
  const pid = readPid()
  if (pid && isRunning(pid)) {
    console.log(`cursor-plan2api is running (pid: ${pid}).`)
    console.log(`  Logs: ${LOG_FILE}`)
    return
  }

  if (pid) removePidFile()
  console.log("cursor-plan2api is not running.")
}

/**
 * Stop the background daemon.
 */
export const daemonStop = (): boolean => {
  const pid = readPid()
  if (!pid || !isRunning(pid)) {
    console.log("cursor-plan2api is not running.")
    removePidFile()
    return false
  }

  try {
    process.kill(pid, "SIGTERM")
  } catch {
    try {
      process.kill(pid)
    } catch {
      // ignore
    }
  }

  let tries = 0
  while (tries < 20 && isRunning(pid)) {
    const start = Date.now()
    while (Date.now() - start < 100) {
      // busy wait
    }
    tries += 1
  }

  if (isRunning(pid)) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // ignore
    }
  }

  removePidFile()
  console.log(`cursor-plan2api stopped (was pid: ${pid}).`)
  return true
}

/**
 * Start the proxy as a background daemon.
 */
export const daemonStart = (port?: number): void => {
  const existingPid = readPid()
  if (existingPid && isRunning(existingPid)) {
    console.log(`cursor-plan2api is already running (pid: ${existingPid}).`)
    console.log("Run `cursor-plan2api restart` to restart.")
    return
  }

  removePidFile()
  ensureStateDir()

  const env = { ...process.env }
  if (port) {
    env.CURSOR_PLAN2API_PORT = String(port)
  }

  const logFd = openSync(LOG_FILE, "a")
  const child = spawn(process.execPath, [getEntryPath(), "--daemon-child"], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env,
  })

  if (!child.pid) {
    console.error("Failed to start background process.")
    process.exit(1)
  }

  writeFileSync(PID_FILE, String(child.pid))
  child.unref()

  const listenPort = port ?? Number.parseInt(env.CURSOR_PLAN2API_PORT ?? "8787", 10)
  const base = `http://127.0.0.1:${listenPort}`

  console.log(`
  Cursor-Plan2API running (pid: ${child.pid})
  Base URL : ${base}/v1
  Health   : ${base}/health
  Usage    : ${base}/v1/usage
  Logs     : ~/.cursor-plan2api/server.log
  Stop     : cursor-plan2api stop
`)
}

/**
 * Restart the background daemon.
 */
export const daemonRestart = (port?: number): void => {
  daemonStop()
  daemonStart(port)
}

export const clearPidFile = removePidFile
