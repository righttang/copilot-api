import type { Context } from "hono"
import { randomUUID } from "node:crypto"
import { streamSSE } from "hono/streaming"
import consola from "consola"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import { isNullish } from "~/lib/is-nullish"
import { HTTPError } from "~/lib/http-error"

import type {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicTokenCountRequest,
  AnthropicTokenCountResponse,
  AnthropicErrorResponse
} from "~/types/anthropic"

import {
  convertAnthropicToOpenAIMessages,
  convertAnthropicToolsToOpenAI,
  convertAnthropicToolChoiceToOpenAI,
  convertOpenAIToAnthropicResponse
} from "~/services/anthropic/converters"

import { convertOpenAIStreamToAnthropic } from "~/services/anthropic/streaming"

import {
  createChatCompletions,
  type ChatCompletionsPayload
} from "~/services/copilot/create-chat-completions"

export async function handleAnthropicMessages(c: Context) {
  await checkRateLimit(state)

  const requestId = randomUUID()
  
  try {
    const anthropicRequest = await c.req.json<AnthropicMessagesRequest>()
    
    consola.info("Received Anthropic messages request", anthropicRequest)

    if (anthropicRequest.messages) {
      const tokenCount = getTokenCount(
        convertAnthropicToOpenAIMessages(anthropicRequest.messages, anthropicRequest.system)
      )
      consola.info("Estimated token count:", tokenCount)
    }

    if (state.manualApprove) {
      await awaitApproval()
    }

    // Convert Anthropic request to OpenAI format
    const openaiMessages = convertAnthropicToOpenAIMessages(
      anthropicRequest.messages,
      anthropicRequest.system
    )
    
    const openaiTools = convertAnthropicToolsToOpenAI(anthropicRequest.tools)
    const openaiToolChoice = convertAnthropicToolChoiceToOpenAI(anthropicRequest.tool_choice)

    // Build OpenAI payload
    let openaiPayload: ChatCompletionsPayload = {
      model: selectCopilotModel(anthropicRequest.model),
      messages: openaiMessages,
      stream: anthropicRequest.stream || false
    }

    // Set max_tokens
    if (isNullish(anthropicRequest.max_tokens)) {
      const selectedModel = state.models?.data.find(
        (model) => model.id === openaiPayload.model
      )
      openaiPayload.max_tokens = selectedModel?.capabilities.limits.max_output_tokens
    } else {
      openaiPayload.max_tokens = anthropicRequest.max_tokens
    }

    // Add optional parameters
    if (anthropicRequest.temperature !== undefined) {
      openaiPayload.temperature = anthropicRequest.temperature
    }
    if (anthropicRequest.top_p !== undefined) {
      openaiPayload.top_p = anthropicRequest.top_p
    }
    if (anthropicRequest.stop_sequences) {
      openaiPayload.stop = anthropicRequest.stop_sequences
    }
    if (openaiTools) {
      openaiPayload.tools = openaiTools
    }
    if (openaiToolChoice) {
      openaiPayload.tool_choice = openaiToolChoice
    }

    consola.debug("Converted to OpenAI payload", { 
      model: openaiPayload.model,
      messageCount: openaiPayload.messages.length,
      hasTools: Boolean(openaiPayload.tools),
      requestId
    })

    const response = await createChatCompletions(openaiPayload)

    // Handle streaming response
    if (anthropicRequest.stream && isAsyncIterable(response)) {
      return streamSSE(c, async (stream) => {
        const estimatedInputTokens = getTokenCount(openaiMessages)
        
        for await (const sseEvent of convertOpenAIStreamToAnthropic(
          response,
          anthropicRequest.model,
          estimatedInputTokens,
          requestId
        )) {
          await stream.write(sseEvent)
        }
      })
    }

    // Handle non-streaming response
    if (isNonStreamingResponse(response)) {
      const anthropicResponse = convertOpenAIToAnthropicResponse(
        response,
        anthropicRequest.model,
        requestId
      )

      consola.info("Anthropic messages request completed", {
        model: anthropicResponse.model,
        stopReason: anthropicResponse.stop_reason,
        inputTokens: anthropicResponse.usage.input_tokens,
        outputTokens: anthropicResponse.usage.output_tokens,
        requestId
      })

      return c.json(anthropicResponse)
    }

    throw new Error("Unexpected response type from OpenAI")

  } catch (error) {
    consola.error("Error handling Anthropic messages request:", error)
    
    if (error instanceof HTTPError) {
      const errorResponse: AnthropicErrorResponse = {
        type: "error",
        error: {
          type: error.response.status >= 400 && error.response.status < 500 
            ? "invalid_request_error" 
            : "api_error",
          message: error.message
        }
      }
      return c.json(errorResponse, error.response.status)
    }

    const errorResponse: AnthropicErrorResponse = {
      type: "error",
      error: {
        type: "api_error",
        message: error instanceof Error ? error.message : "An unexpected error occurred"
      }
    }
    return c.json(errorResponse, 500)
  }
}

export async function handleAnthropicTokenCount(c: Context) {
  try {
    const request = await c.req.json<AnthropicTokenCountRequest>()
    
    consola.info("Received Anthropic token count request", {
      model: request.model,
      messageCount: request.messages.length
    })

    const openaiMessages = convertAnthropicToOpenAIMessages(
      request.messages,
      request.system
    )

    const tokenCount = getTokenCount(openaiMessages)

    const response: AnthropicTokenCountResponse = {
      input_tokens: tokenCount
    }

    consola.info("Token count completed", { 
      tokens: tokenCount,
      model: request.model
    })

    return c.json(response)

  } catch (error) {
    consola.error("Error counting tokens:", error)
    
    const errorResponse: AnthropicErrorResponse = {
      type: "error",
      error: {
        type: "invalid_request_error",
        message: error instanceof Error ? error.message : "Failed to count tokens"
      }
    }
    return c.json(errorResponse, 400)
  }
}

function selectCopilotModel(anthropicModel: string): string {
  // Map Anthropic model names to available Copilot models
  const modelName = anthropicModel.toLowerCase()
  
  if (!state.models?.data) {
    // Fallback to a default model name if models aren't cached
    return "claude-3-5-sonnet-20241022"
  }
  
  // Try to find a Claude model first
  const claudeModel = state.models.data.find(model => 
    model.id.toLowerCase().includes("claude")
  )
  
  if (claudeModel) {
    return claudeModel.id
  }
  
  // Fallback to first available model
  return state.models.data[0]?.id || "claude-3-5-sonnet-20241022"
}

function isAsyncIterable(obj: any): obj is AsyncIterable<any> {
  return obj != null && typeof obj[Symbol.asyncIterator] === "function"
}

function isNonStreamingResponse(response: any): response is import("~/services/copilot/create-chat-completions").ChatCompletionResponse {
  return response && typeof response === "object" && "choices" in response
}