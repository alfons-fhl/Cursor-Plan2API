import { createHash } from "node:crypto"

import type { IncomingMessage } from "node:http"

import type { OpenAiChatRequest } from "../openai/types.js"
import { messageContentToText } from "../openai/prompt.js"
import {
  openSessionPersistence,
  type SessionPersistence,
} from "./session-persistence.js"

type SessionEntry = {
  cursorSessionId: string
  updatedAt: number
}

/**
 * In-memory map from client conversation keys to Cursor CLI session ids,
 * backed by SQLite (or JSON fallback) for restart survival.
 */
export class CursorSessionStore {
  private readonly entries = new Map<string, SessionEntry>()
  private readonly persistence: SessionPersistence

  constructor(
    private readonly ttlMs: number,
    sessionDbPath?: string,
  ) {
    this.persistence = openSessionPersistence(sessionDbPath)
    this.loadFromDisk()
  }

  private loadFromDisk(): void {
    for (const [key, entry] of this.persistence.entries()) {
      this.entries.set(key, entry)
    }
    this.prune()
  }

  private persist(key: string, entry: SessionEntry): void {
    this.persistence.set(key, entry.cursorSessionId)
  }

  private remove(key: string): void {
    this.persistence.delete(key)
  }

  /**
   * Resolve a stable conversation key for session reuse.
   */
  resolveKey(
    req: IncomingMessage,
    body: OpenAiChatRequest,
    model: string,
  ): string {
    const header = req.headers["x-plan2api-session"]
    if (typeof header === "string" && header.trim()) {
      return `hdr:${header.trim()}`
    }

    if (typeof body.user === "string" && body.user.trim()) {
      return `user:${body.user.trim()}:${model}`
    }

    const firstUser = body.messages.find((message) => message.role === "user")
    const firstUserText = firstUser
      ? messageContentToText(firstUser.content).slice(0, 256)
      : "no-user"

    return `auto:${model}:${hashText(firstUserText)}`
  }

  /**
   * Look up a Cursor session id for a conversation key.
   */
  get(key: string): string | undefined {
    this.prune()
    return this.entries.get(key)?.cursorSessionId
  }

  /**
   * Persist a Cursor session id for a conversation key.
   */
  set(key: string, cursorSessionId: string): void {
    if (!cursorSessionId.trim()) return
    const entry: SessionEntry = {
      cursorSessionId: cursorSessionId.trim(),
      updatedAt: Date.now(),
    }
    this.entries.set(key, entry)
    this.persist(key, entry)
  }

  /** Remove expired session mappings. */
  prune(): void {
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (now - entry.updatedAt > this.ttlMs) {
        this.entries.delete(key)
        this.remove(key)
      }
    }
  }

  /** Current number of cached session mappings. */
  size(): number {
    this.prune()
    return this.entries.size
  }

  /** Close the persistence backend. */
  close(): void {
    this.persistence.close()
  }
}

const hashText = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 24)

/**
 * Extract new messages since the last assistant turn for Cursor `--resume`.
 */
export const buildResumePrompt = (
  messages: OpenAiChatRequest["messages"],
): string | null => {
  let lastAssistantIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      lastAssistantIndex = index
      break
    }
  }

  const tail =
    lastAssistantIndex >= 0
      ? messages.slice(lastAssistantIndex + 1)
      : messages

  if (tail.length === 0) return null

  const parts: string[] = []
  for (const message of tail) {
    if (message.role === "user") {
      const text = messageContentToText(message.content).trim()
      if (text) parts.push(text)
      continue
    }

    if (message.role === "tool") {
      const name =
        typeof message.name === "string" && message.name.trim()
          ? message.name.trim()
          : "tool"
      const text = messageContentToText(message.content).trim()
      if (text) parts.push(`Tool result (${name}):\n${text}`)
    }
  }

  const combined = parts.join("\n\n").trim()
  return combined || null
}

/**
 * Whether a follow-up request can reuse an existing Cursor CLI session.
 */
export const canResumeSession = (
  messages: OpenAiChatRequest["messages"],
): boolean => messages.length > 1 && buildResumePrompt(messages) !== null
