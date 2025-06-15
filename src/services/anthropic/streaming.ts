import { randomUUID } from "node:crypto"
import type { 
  AnthropicStreamEvent,
  AnthropicMessageStartEvent,
  AnthropicContentBlockStartEvent,
  AnthropicContentBlockDeltaEvent,
  AnthropicContentBlockStopEvent,
  AnthropicMessageDeltaEvent,
  AnthropicMessageStopEvent,
  AnthropicPingEvent,
  AnthropicErrorEvent
} from "~/types/anthropic"
import type { ChatCompletionChunk } from "~/services/copilot/create-chat-completions"
import { getTokenCount } from "~/lib/tokenizer"

export async function* convertOpenAIStreamToAnthropic(
  openaiStream: AsyncIterable<any>,
  originalAnthropicModel: string,
  estimatedInputTokens: number,
  requestId: string
): AsyncGenerator<string> {
  const anthropicMessageId = `msg_stream_${requestId}_${randomUUID().slice(0, 8)}`
  
  let nextAnthropicBlockIdx = 0
  let textBlockAnthropicIdx: number | null = null
  const openaiToolIdxToAnthropicBlockIdx: Map<number, number> = new Map()
  const toolStates: Map<number, {
    id: string
    name: string
    argumentsBuffer: string
  }> = new Map()
  const sentToolBlockStarts = new Set<number>()
  
  let outputTokenCount = 0
  let finalAnthropicStopReason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "error" = "end_turn"

  const openaiToAnthropicStopReasonMap: Record<string, typeof finalAnthropicStopReason> = {
    "stop": "end_turn",
    "length": "max_tokens", 
    "tool_calls": "tool_use",
    "function_call": "tool_use",
    "content_filter": "stop_sequence"
  }

  try {
    // Send message_start event
    const messageStartEvent: AnthropicMessageStartEvent = {
      type: "message_start",
      message: {
        id: anthropicMessageId,
        type: "message",
        role: "assistant",
        model: originalAnthropicModel,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: estimatedInputTokens, output_tokens: 0 }
      }
    }
    yield `event: message_start\ndata: ${JSON.stringify(messageStartEvent)}\n\n`
    
    // Send ping event
    const pingEvent: AnthropicPingEvent = { type: "ping" }
    yield `event: ping\ndata: ${JSON.stringify(pingEvent)}\n\n`

    for await (const chunk of openaiStream) {
      // Parse the chunk - events() from fetch-event-stream returns parsed objects
      let parsedChunk: ChatCompletionChunk
      if (typeof chunk === "string") {
        try {
          // Handle SSE format: "data: {...}"
          const dataMatch = chunk.match(/^data: (.+)$/)
          if (dataMatch) {
            parsedChunk = JSON.parse(dataMatch[1])
          } else {
            parsedChunk = JSON.parse(chunk)
          }
        } catch (e) {
          console.warn("Failed to parse chunk:", chunk)
          continue
        }
      } else if (chunk && typeof chunk === "object" && chunk.data) {
        // Handle fetch-event-stream format where chunk.data contains the actual data
        try {
          parsedChunk = typeof chunk.data === "string" ? JSON.parse(chunk.data) : chunk.data
        } catch (e) {
          console.warn("Failed to parse chunk.data:", chunk.data)
          continue
        }
      } else {
        parsedChunk = chunk as ChatCompletionChunk
      }
      
      if (!parsedChunk.choices || parsedChunk.choices.length === 0) {
        continue
      }

      const delta = parsedChunk.choices[0].delta
      const openaiFinishReason = parsedChunk.choices[0].finish_reason

      // Handle text content
      if (delta.content) {
        outputTokenCount += estimateTokenCount(delta.content)
        
        if (textBlockAnthropicIdx === null) {
          textBlockAnthropicIdx = nextAnthropicBlockIdx
          nextAnthropicBlockIdx += 1
          
          const startTextEvent: AnthropicContentBlockStartEvent = {
            type: "content_block_start",
            index: textBlockAnthropicIdx,
            content_block: { type: "text", text: "" }
          }
          yield `event: content_block_start\ndata: ${JSON.stringify(startTextEvent)}\n\n`
        }

        const textDeltaEvent: AnthropicContentBlockDeltaEvent = {
          type: "content_block_delta",
          index: textBlockAnthropicIdx,
          delta: { type: "text_delta", text: delta.content }
        }
        yield `event: content_block_delta\ndata: ${JSON.stringify(textDeltaEvent)}\n\n`
      }

      // Handle tool calls
      if (delta.tool_calls) {
        for (const toolDelta of delta.tool_calls) {
          const openaiTcIdx = toolDelta.index

          if (!openaiToolIdxToAnthropicBlockIdx.has(openaiTcIdx)) {
            const currentAnthropicToolBlockIdx = nextAnthropicBlockIdx
            nextAnthropicBlockIdx += 1
            openaiToolIdxToAnthropicBlockIdx.set(openaiTcIdx, currentAnthropicToolBlockIdx)

            toolStates.set(currentAnthropicToolBlockIdx, {
              id: toolDelta.id || `tool_ph_${requestId}_${currentAnthropicToolBlockIdx}`,
              name: "",
              argumentsBuffer: ""
            })
          }

          const currentAnthropicToolBlockIdx = openaiToolIdxToAnthropicBlockIdx.get(openaiTcIdx)!
          const toolState = toolStates.get(currentAnthropicToolBlockIdx)!

          // Update tool state
          if (toolDelta.id && toolState.id.startsWith("tool_ph_")) {
            toolState.id = toolDelta.id
          }

          if (toolDelta.function) {
            if (toolDelta.function.name) {
              toolState.name = toolDelta.function.name
            }
            if (toolDelta.function.arguments) {
              toolState.argumentsBuffer += toolDelta.function.arguments
              outputTokenCount += estimateTokenCount(toolDelta.function.arguments)
            }
          }

          // Send content_block_start if we have enough info and haven't sent it yet
          if (
            !sentToolBlockStarts.has(currentAnthropicToolBlockIdx) &&
            toolState.id &&
            !toolState.id.startsWith("tool_ph_") &&
            toolState.name
          ) {
            const startToolEvent: AnthropicContentBlockStartEvent = {
              type: "content_block_start",
              index: currentAnthropicToolBlockIdx,
              content_block: {
                type: "tool_use",
                id: toolState.id,
                name: toolState.name,
                input: {}
              }
            }
            yield `event: content_block_start\ndata: ${JSON.stringify(startToolEvent)}\n\n`
            sentToolBlockStarts.add(currentAnthropicToolBlockIdx)
          }

          // Send delta if we have arguments and have started the block
          if (
            toolDelta.function?.arguments &&
            sentToolBlockStarts.has(currentAnthropicToolBlockIdx)
          ) {
            const argsDeltaEvent: AnthropicContentBlockDeltaEvent = {
              type: "content_block_delta",
              index: currentAnthropicToolBlockIdx,
              delta: {
                type: "input_json_delta",
                partial_json: toolDelta.function.arguments
              }
            }
            yield `event: content_block_delta\ndata: ${JSON.stringify(argsDeltaEvent)}\n\n`
          }
        }
      }

      // Handle finish reason
      if (openaiFinishReason) {
        finalAnthropicStopReason = openaiToAnthropicStopReasonMap[openaiFinishReason] || "end_turn"
        if (openaiFinishReason === "tool_calls") {
          finalAnthropicStopReason = "tool_use"
        }
        break
      }
    }

    // Send content_block_stop events
    if (textBlockAnthropicIdx !== null) {
      const stopEvent: AnthropicContentBlockStopEvent = {
        type: "content_block_stop",
        index: textBlockAnthropicIdx
      }
      yield `event: content_block_stop\ndata: ${JSON.stringify(stopEvent)}\n\n`
    }

    for (const anthropicToolIdx of sentToolBlockStarts) {
      const toolState = toolStates.get(anthropicToolIdx)
      if (toolState) {
        try {
          JSON.parse(toolState.argumentsBuffer)
        } catch {
          console.warn(`Invalid JSON in tool arguments for ${toolState.name}`)
        }
      }
      
      const stopEvent: AnthropicContentBlockStopEvent = {
        type: "content_block_stop", 
        index: anthropicToolIdx
      }
      yield `event: content_block_stop\ndata: ${JSON.stringify(stopEvent)}\n\n`
    }

    // Send message_delta event
    const messageDeltaEvent: AnthropicMessageDeltaEvent = {
      type: "message_delta",
      delta: {
        stop_reason: finalAnthropicStopReason,
        stop_sequence: undefined
      },
      usage: { output_tokens: outputTokenCount }
    }
    yield `event: message_delta\ndata: ${JSON.stringify(messageDeltaEvent)}\n\n`

    // Send message_stop event
    const messageStopEvent: AnthropicMessageStopEvent = {
      type: "message_stop"
    }
    yield `event: message_stop\ndata: ${JSON.stringify(messageStopEvent)}\n\n`

  } catch (error) {
    console.error("Error in stream conversion:", error)
    
    const errorEvent: AnthropicErrorEvent = {
      type: "error",
      error: {
        type: "api_error",
        message: error instanceof Error ? error.message : "An unexpected error occurred"
      }
    }
    yield `event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`
  }
}

function estimateTokenCount(text: string): number {
  // Simple token estimation - roughly 4 characters per token
  return Math.ceil(text.length / 4)
}