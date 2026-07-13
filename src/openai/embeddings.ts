/**
 * Deterministic local embedding for OpenAI-compatible /v1/embeddings.
 *
 * Cursor CLI does not expose a native embedding model. This implementation
 * produces stable normalized vectors so clients (RAG pipelines, etc.) can
 * integrate without a separate API key.
 */

const hashString = (input: string): number => {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const seededUnit = (seed: number, index: number): number => {
  const mixed = hashString(`${seed}:${index}`)
  return (mixed / 0xffffffff) * 2 - 1
}

/**
 * Create a normalized embedding vector for the given text.
 */
export const embedText = (text: string, dimensions: number): number[] => {
  const seed = hashString(text)
  const vector = Array.from({ length: dimensions }, (_, index) =>
    seededUnit(seed, index),
  )

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (norm === 0) return vector
  return vector.map((value) => value / norm)
}

/**
 * Batch-embed multiple inputs.
 */
export const embedTexts = (inputs: string[], dimensions: number): number[][] =>
  inputs.map((input) => embedText(input, dimensions))
