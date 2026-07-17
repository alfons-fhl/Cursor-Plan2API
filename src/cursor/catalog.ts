import type { CursorCliModel } from "./types.js"

/**
 * Known Cursor CLI model ids (Cursor desktop + agent ecosystem, 2026).
 * Used to populate /v1/models when agent --list-models only returns Composer.
 * CLI-listed models always win on id conflicts.
 */
export const CURSOR_MODEL_CATALOG: readonly CursorCliModel[] = [
  { id: "auto", name: "Auto" },
  { id: "composer-2.5", name: "Composer 2.5" },
  { id: "composer-2.5-fast", name: "Composer 2.5 Fast" },

  { id: "claude-4.6-sonnet-high-thinking", name: "Claude 4.6 Sonnet Thinking" },
  { id: "claude-sonnet-5-thinking-high", name: "Claude Sonnet 5 Thinking" },
  { id: "claude-fable-5-thinking-high", name: "Claude Fable 5 Thinking" },
  { id: "claude-fable-5-thinking-xhigh", name: "Claude Fable 5 Thinking (Extra High)" },
  { id: "claude-opus-4-7-thinking-high", name: "Claude Opus 4.7 Thinking" },
  { id: "claude-opus-4-7-thinking-high-fast", name: "Claude Opus 4.7 Thinking Fast" },
  { id: "claude-opus-4-8-thinking-high", name: "Claude Opus 4.8 Thinking" },
  { id: "claude-opus-4-8-thinking-high-fast", name: "Claude Opus 4.8 Thinking Fast" },

  { id: "gpt-5.2", name: "GPT-5.2" },
  { id: "gpt-5.3-codex-high", name: "GPT-5.3 Codex" },
  { id: "gpt-5.3-codex-high-fast", name: "GPT-5.3 Codex Fast" },
  { id: "gpt-5.4-high", name: "GPT-5.4" },
  { id: "gpt-5.4-high-fast", name: "GPT-5.4 Fast" },
  { id: "gpt-5.5-high", name: "GPT-5.5" },
  { id: "gpt-5.5-high-fast", name: "GPT-5.5 Fast" },
  { id: "gpt-5.5-medium", name: "GPT-5.5 Medium" },
  { id: "gpt-5.6-sol-high", name: "GPT-5.6 Sol" },
  { id: "gpt-5.6-sol-high-fast", name: "GPT-5.6 Sol Fast" },
  { id: "gpt-5.6-sol-xhigh", name: "GPT-5.6 Sol (Extra High)" },
  { id: "gpt-5.6-sol-xhigh-fast", name: "GPT-5.6 Sol Fast (Extra High)" },

  { id: "cursor-grok-4.5-high", name: "Grok 4.5" },
  { id: "cursor-grok-4.5-high-fast", name: "Grok 4.5 Fast" },

  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  { id: "gemini-3-pro", name: "Gemini 3 Pro" },
] as const

export const CURSOR_MODEL_CATALOG_IDS = CURSOR_MODEL_CATALOG.map((model) => model.id)
