import { randomUUID } from "node:crypto"

import type {
  OpenAiChatChunk,
  OpenAiChatResponse,
  OpenAiToolCall,
} from "./types.js"
import type { OpenAiUsage } from "./tokens.js"

/**
 * Create an OpenAI streaming chunk for assistant text.
 */
export const createTextChunk = (
  requestId: string,
  model: string,
  text: string,
  isFirst: boolean,
): OpenAiChatChunk => ({
  id: `chatcmpl-${requestId}`,
  object: "chat.completion.chunk",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [
    {
      index: 0,
      delta: {
        role: isFirst ? "assistant" : undefined,
        content: text,
      },
      finish_reason: null,
    },
  ],
})

/**
 * Create an OpenAI streaming chunk for assistant reasoning text.
 */
export const createReasoningChunk = (
  requestId: string,
  model: string,
  text: string,
): OpenAiChatChunk => ({
  id: `chatcmpl-${requestId}`,
  object: "chat.completion.chunk",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [
    {
      index: 0,
      delta: {
        reasoning_content: text,
      },
      finish_reason: null,
    },
  ],
})

/**
 * Create an OpenAI streaming chunk for a tool call delta.
 */
export const createToolCallChunk = (
  requestId: string,
  model: string,
  index: number,
  toolCall: OpenAiToolCall,
  phase: "start" | "arguments",
): OpenAiChatChunk => ({
  id: `chatcmpl-${requestId}`,
  object: "chat.completion.chunk",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [
    {
      index: 0,
      delta: {
        tool_calls: [
          {
            index,
            ...(phase === "start"
              ? {
                  id: toolCall.id,
                  type: "function" as const,
                  function: { name: toolCall.function.name, arguments: "" },
                }
              : {
                  function: { arguments: toolCall.function.arguments },
                }),
          },
        ],
      },
      finish_reason: null,
    },
  ],
})

/**
 * Create the final streaming chunk.
 */
export const createFinishChunk = (
  requestId: string,
  model: string,
  finishReason: "stop" | "tool_calls" | "length",
  usage?: OpenAiUsage,
): OpenAiChatChunk => ({
  id: `chatcmpl-${requestId}`,
  object: "chat.completion.chunk",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [
    {
      index: 0,
      delta: {},
      finish_reason: finishReason,
    },
  ],
  ...(usage ? { usage } : {}),
})

/**
 * Create a non-streaming OpenAI chat completion response.
 */
export const createChatResponse = (
  requestId: string,
  model: string,
  content: string,
  toolCalls?: OpenAiToolCall[],
  usage?: OpenAiUsage,
  reasoningContent?: string,
  finishReason: "stop" | "tool_calls" | "length" = "stop",
): OpenAiChatResponse => ({
  id: `chatcmpl-${requestId}`,
  object: "chat.completion",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: toolCalls?.length ? null : content,
        reasoning_content: reasoningContent ?? undefined,
        tool_calls: toolCalls,
      },
      finish_reason: toolCalls?.length ? "tool_calls" : finishReason,
    },
  ],
  usage: usage ?? {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  },
})

/**
 * Generate a short request id for OpenAI-compatible responses.
 */
export const createRequestId = (): string =>
  randomUUID().replace(/-/g, "").slice(0, 24)
