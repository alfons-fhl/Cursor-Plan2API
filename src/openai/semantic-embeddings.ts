import type { ProxyConfig } from "../config.js"
import { embedTexts as embedTextsLocal } from "./embeddings.js"

type EmbeddingTensor = {
  data: Float32Array | number[] | Int8Array | Uint8Array
}

type EmbeddingExtractor = (
  text: string,
  options: { pooling: "mean"; normalize: true },
) => Promise<EmbeddingTensor>

let extractorPromise: Promise<EmbeddingExtractor> | undefined
let loadError: string | undefined

const loadExtractor = async (model: string): Promise<EmbeddingExtractor> => {
  if (loadError) throw new Error(loadError)
  if (!extractorPromise) {
    extractorPromise = (async () => {
      try {
        const { pipeline } = await import("@xenova/transformers")
        const extractor = await pipeline("feature-extraction", model, {
          quantized: true,
        })
        return extractor as EmbeddingExtractor
      } catch (error) {
        loadError =
          error instanceof Error ? error.message : "Failed to load embedding model"
        throw error
      }
    })()
  }
  return extractorPromise
}

const toVector = (data: EmbeddingTensor["data"]): number[] => {
  if (data instanceof Float32Array) return Array.from(data)
  if (Array.isArray(data)) return data
  return Array.from(data as ArrayLike<number>)
}

/**
 * Embed texts using a local transformer model (semantic vectors).
 */
export const embedTextsSemantic = async (
  inputs: string[],
  config: ProxyConfig,
): Promise<{ vectors: number[][]; model: string; dimensions: number }> => {
  const extractor = await loadExtractor(config.embeddingModel)
  const vectors: number[][] = []

  for (const input of inputs) {
    const output = await extractor(input, { pooling: "mean", normalize: true })
    vectors.push(toVector(output.data))
  }

  const dimensions = vectors[0]?.length ?? config.embeddingDimensions
  return {
    vectors,
    model: config.embeddingModel,
    dimensions,
  }
}

/**
 * Embed texts using the configured provider with automatic fallback.
 */
export const embedTextsWithProvider = async (
  inputs: string[],
  config: ProxyConfig,
  requestedDimensions?: number,
): Promise<{
  vectors: number[][]
  model: string
  provider: "semantic" | "local"
  dimensions: number
}> => {
  if (config.embeddingProvider === "semantic") {
    try {
      const result = await embedTextsSemantic(inputs, config)
      return {
        vectors: result.vectors,
        model: "text-embedding-plan2api-semantic",
        provider: "semantic",
        dimensions: result.dimensions,
      }
    } catch (error) {
      console.error(
        "[cursor-plan2api] Semantic embedding failed, falling back to local:",
        error instanceof Error ? error.message : error,
      )
    }
  }

  const dimensions = requestedDimensions ?? config.embeddingDimensions
  return {
    vectors: embedTextsLocal(inputs, dimensions),
    model: "text-embedding-plan2api-local",
    provider: "local",
    dimensions,
  }
}

/**
 * Warm up the semantic embedding model (optional, call at startup).
 */
export const warmupSemanticEmbeddings = async (
  config: ProxyConfig,
): Promise<boolean> => {
  if (config.embeddingProvider !== "semantic") return false
  try {
    await embedTextsSemantic(["warmup"], config)
    return true
  } catch {
    return false
  }
}

/**
 * Cosine similarity between two embedding vectors.
 */
export const cosineSimilarity = (a: number[], b: number[]): number => {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}
