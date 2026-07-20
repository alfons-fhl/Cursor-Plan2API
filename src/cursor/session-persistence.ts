import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { z } from "zod"

const entrySchema = z.object({
  cursorSessionId: z.string(),
  updatedAt: z.number(),
})

const storeSchema = z.record(entrySchema)

export type SessionPersistenceEntry = z.infer<typeof entrySchema>

/**
 * Persistence backend for Cursor CLI session ids.
 */
export interface SessionPersistence {
  get(key: string): SessionPersistenceEntry | undefined
  set(key: string, cursorSessionId: string): void
  delete(key: string): void
  entries(): Iterable<[string, SessionPersistenceEntry]>
  close(): void
}

const defaultDbPath = (): string =>
  join(homedir(), ".cursor-plan2api", "sessions.db")

/**
 * Resolve the session database path from config or default.
 */
export const resolveSessionDbPath = (configuredPath?: string): string =>
  configuredPath?.trim() || defaultDbPath()

const ensureParentDir = (filePath: string): void => {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/**
 * Create a SQLite-backed session store when `node:sqlite` is available.
 */
const createSqlitePersistence = (dbPath: string): SessionPersistence | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void
        prepare(sql: string): {
          get(key: string): SessionPersistenceEntry | undefined
          all(): Array<{ key: string } & SessionPersistenceEntry>
          run(key: string, cursorSessionId: string, updatedAt: number): void
        }
        close(): void
      }
    }

    ensureParentDir(dbPath)
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        key TEXT PRIMARY KEY,
        cursor_session_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    const getStmt = db.prepare(
      "SELECT cursor_session_id AS cursorSessionId, updated_at AS updatedAt FROM sessions WHERE key = ?",
    )
    const setStmt = db.prepare(
      "INSERT INTO sessions (key, cursor_session_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET cursor_session_id = excluded.cursor_session_id, updated_at = excluded.updated_at",
    )
    const deleteStmt = db.prepare("DELETE FROM sessions WHERE key = ?") as unknown as {
      run(key: string): void
    }

    return {
      get: (key: string) => {
        const row = getStmt.get(key) as SessionPersistenceEntry | undefined
        return row
      },
      set: (key: string, cursorSessionId: string) => {
        setStmt.run(key, cursorSessionId, Date.now())
      },
      delete: (key: string) => {
        deleteStmt.run(key)
      },
      entries: function* () {
        const allStmt = db.prepare(
          "SELECT key, cursor_session_id AS cursorSessionId, updated_at AS updatedAt FROM sessions",
        )
        const rows = allStmt.all() as Array<{ key: string } & SessionPersistenceEntry>
        for (const row of rows) {
          yield [row.key, { cursorSessionId: row.cursorSessionId, updatedAt: row.updatedAt }] as const
        }
      },
      close: () => {
        db.close()
      },
    }
  } catch {
    return null
  }
}

/**
 * JSON file fallback when SQLite is unavailable (Node < 22).
 */
const createJsonPersistence = (dbPath: string): SessionPersistence => {
  const jsonPath = dbPath.endsWith(".db")
    ? dbPath.replace(/\.db$/, ".json")
    : `${dbPath}.json`

  ensureParentDir(jsonPath)

  const readStore = (): Record<string, SessionPersistenceEntry> => {
    if (!existsSync(jsonPath)) return {}
    try {
      const parsed = storeSchema.safeParse(JSON.parse(readFileSync(jsonPath, "utf8")))
      return parsed.success ? parsed.data : {}
    } catch {
      return {}
    }
  }

  let cache = readStore()
  let dirty = false

  const flush = (): void => {
    if (!dirty) return
    writeFileSync(jsonPath, JSON.stringify(cache, null, 2), "utf8")
    dirty = false
  }

  return {
    get: (key: string) => cache[key],
    set: (key: string, cursorSessionId: string) => {
      cache[key] = { cursorSessionId, updatedAt: Date.now() }
      dirty = true
      flush()
    },
    delete: (key: string) => {
      if (!(key in cache)) return
      delete cache[key]
      dirty = true
      flush()
    },
    entries: function* () {
      for (const [key, entry] of Object.entries(cache)) {
        yield [key, entry] as const
      }
    },
    close: () => {
      flush()
    },
  }
}

/**
 * Open a persistent session store at the configured path.
 */
export const openSessionPersistence = (
  configuredPath?: string,
): SessionPersistence => {
  const dbPath = resolveSessionDbPath(configuredPath)
  return createSqlitePersistence(dbPath) ?? createJsonPersistence(dbPath)
}
