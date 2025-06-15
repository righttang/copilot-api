import { randomUUID } from "node:crypto"
import type { 
  AnthropicMessage, 
  AnthropicTool, 
  AnthropicToolChoice, 
  ContentBlock,
  ContentBlockText,
  ContentBlockImage,
  ContentBlockToolUse,
  ContentBlockToolResult,
  SystemContent,
  AnthropicMessagesResponse,
  AnthropicUsage
} from "~/types/anthropic"
import type { 
  Message, 
  Tool, 
  ToolChoice, 
  ChatCompletionResponse,
  ContentPart,
  ToolCall
} from "~/services/copilot/create-chat-completions"

export function convertAnthropicToOpenAIMessages(
  anthropicMessages: Array<AnthropicMessage>,
  anthropicSystem?: string | Array<SystemContent>
): Array<Message> {
  const openaiMessages: Array<Message> = []

  // Handle system message
  let systemTextContent = ""
  if (typeof anthropicSystem === "string") {
    systemTextContent = anthropicSystem
  } else if (Array.isArray(anthropicSystem)) {
    const systemTexts = anthropicSystem
      .filter((block): block is SystemContent => block.type === "text")
      .map(block => block.text)
    systemTextContent = systemTexts.join("\n")
  }

  if (systemTextContent) {
    openaiMessages.push({
      role: "system",
      content: systemTextContent
    })
  }

  // Convert messages
  for (const msg of anthropicMessages) {
    const role = msg.role
    const content = msg.content

    if (typeof content === "string") {
      openaiMessages.push({
        role,
        content
      })
      continue
    }

    if (Array.isArray(content)) {
      const openaiPartsForUserMessage: Array<ContentPart> = []
      const assistantToolCalls: Array<ToolCall> = []
      const textContentForAssistant: Array<string> = []

      if (content.length === 0) {
        openaiMessages.push({ role, content: "" })
        continue
      }

      for (const block of content) {
        if (isContentBlockText(block)) {
          if (role === "user") {
            openaiPartsForUserMessage.push({
              type: "text",
              text: block.text
            })
          } else if (role === "assistant") {
            textContentForAssistant.push(block.text)
          }
        } else if (isContentBlockImage(block) && role === "user") {
          if (block.source.type === "base64") {
            openaiPartsForUserMessage.push({
              type: "image_url",
              image_url: `data:${block.source.media_type};base64,${block.source.data}`
            })
          }
        } else if (isContentBlockToolUse(block) && role === "assistant") {
          try {
            const argsStr = JSON.stringify(block.input)
            assistantToolCalls.push({
              id: block.id,
              type: "function",
              function: {
                name: block.name,
                arguments: argsStr
              }
            })
          } catch (e) {
            console.warn(`Failed to serialize tool input for ${block.name}:`, e)
            assistantToolCalls.push({
              id: block.id,
              type: "function",
              function: {
                name: block.name,
                arguments: "{}"
              }
            })
          }
        } else if (isContentBlockToolResult(block) && role === "user") {
          const serializedContent = serializeToolResultContent(block.content)
          openaiMessages.push({
            role: "tool",
            content: serializedContent,
            tool_call_id: block.tool_use_id
          })
        }
      }

      // Handle user message with multimodal content
      if (role === "user" && openaiPartsForUserMessage.length > 0) {
        const isMultimodal = openaiPartsForUserMessage.some(part => part.type === "image_url")
        if (isMultimodal || openaiPartsForUserMessage.length > 1) {
          openaiMessages.push({
            role: "user",
            content: openaiPartsForUserMessage
          })
        } else if (openaiPartsForUserMessage.length === 1 && openaiPartsForUserMessage[0].type === "text") {
          openaiMessages.push({
            role: "user", 
            content: openaiPartsForUserMessage[0].text || ""
          })
        }
      }

      // Handle assistant message with text and/or tool calls
      if (role === "assistant") {
        const assistantText = textContentForAssistant.filter(Boolean).join("\n")
        
        if (assistantText && assistantToolCalls.length > 0) {
          // Text and tool calls - need separate messages
          openaiMessages.push({
            role: "assistant",
            content: assistantText
          })
          openaiMessages.push({
            role: "assistant",
            content: null,
            tool_calls: assistantToolCalls
          })
        } else if (assistantText) {
          // Just text
          openaiMessages.push({
            role: "assistant",
            content: assistantText
          })
        } else if (assistantToolCalls.length > 0) {
          // Just tool calls
          openaiMessages.push({
            role: "assistant",
            content: null,
            tool_calls: assistantToolCalls
          })
        } else {
          // Empty message
          openaiMessages.push({
            role: "assistant",
            content: ""
          })
        }
      }
    }
  }

  return openaiMessages
}

export function convertAnthropicToolsToOpenAI(
  anthropicTools?: Array<AnthropicTool>
): Array<Tool> | undefined {
  if (!anthropicTools || anthropicTools.length === 0) {
    return undefined
  }

  return anthropicTools.map(tool => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description || "",
      parameters: tool.input_schema
    }
  }))
}

export function convertAnthropicToolChoiceToOpenAI(
  anthropicChoice?: AnthropicToolChoice
): "auto" | "none" | ToolChoice | undefined {
  if (!anthropicChoice) {
    return undefined
  }

  if (anthropicChoice.type === "auto") {
    return "auto"
  }
  if (anthropicChoice.type === "any") {
    // Map 'any' to 'auto' as closest equivalent
    return "auto"
  }
  if (anthropicChoice.type === "tool" && anthropicChoice.name) {
    return {
      type: "function",
      function: {
        name: anthropicChoice.name
      }
    }
  }

  return "auto"
}

export function convertOpenAIToAnthropicResponse(
  openaiResponse: ChatCompletionResponse,
  originalAnthropicModel: string,
  requestId?: string
): AnthropicMessagesResponse {
  const anthropicContent: Array<ContentBlock> = []
  let anthropicStopReason: AnthropicMessagesResponse["stop_reason"] = "end_turn"

  const stopReasonMap: Record<string, AnthropicMessagesResponse["stop_reason"]> = {
    "stop": "end_turn",
    "length": "max_tokens", 
    "tool_calls": "tool_use",
    "function_call": "tool_use",
    "content_filter": "stop_sequence"
  }

  if (openaiResponse.choices && openaiResponse.choices.length > 0) {
    const choice = openaiResponse.choices[0]
    const message = choice.message
    const finishReason = choice.finish_reason

    anthropicStopReason = stopReasonMap[finishReason] || "end_turn"

    if (message.content) {
      anthropicContent.push({
        type: "text",
        text: message.content
      })
    }

    if (message.tool_calls) {
      for (const call of message.tool_calls) {
        if (call.type === "function") {
          let toolInputDict: Record<string, any> = {}
          try {
            const parsedInput = JSON.parse(call.function.arguments)
            if (typeof parsedInput === "object" && parsedInput !== null) {
              toolInputDict = parsedInput
            } else {
              toolInputDict = { value: parsedInput }
            }
          } catch (e) {
            console.warn(`Failed to parse tool arguments for ${call.function.name}:`, e)
            toolInputDict = { error_parsing_arguments: call.function.arguments }
          }

          anthropicContent.push({
            type: "tool_use",
            id: call.id,
            name: call.function.name,
            input: toolInputDict
          })
        }
      }
      if (finishReason === "tool_calls") {
        anthropicStopReason = "tool_use"
      }
    }
  }

  if (anthropicContent.length === 0) {
    anthropicContent.push({
      type: "text",
      text: ""
    })
  }

  const usage: AnthropicUsage = {
    input_tokens: 0,
    output_tokens: 0
  }

  const responseId = openaiResponse.id ? 
    `msg_${openaiResponse.id}` : 
    `msg_${requestId || randomUUID()}_completed`

  return {
    id: responseId,
    type: "message",
    role: "assistant",
    model: originalAnthropicModel,
    content: anthropicContent,
    stop_reason: anthropicStopReason,
    usage
  }
}

function serializeToolResultContent(
  content: string | Array<Record<string, any>> | Array<any>
): string {
  if (typeof content === "string") {
    return content
  }

  if (Array.isArray(content)) {
    const processedParts: Array<string> = []
    for (const item of content) {
      if (typeof item === "object" && item !== null && item.type === "text" && "text" in item) {
        processedParts.push(String(item.text))
      } else {
        try {
          processedParts.push(JSON.stringify(item))
        } catch {
          processedParts.push(`<unserializable_item type='${typeof item}'>`)
        }
      }
    }
    return processedParts.join("\n")
  }

  try {
    return JSON.stringify(content)
  } catch {
    return JSON.stringify({
      error: "Serialization failed",
      original_type: typeof content
    })
  }
}

// Type guards
function isContentBlockText(block: ContentBlock): block is ContentBlockText {
  return block.type === "text"
}

function isContentBlockImage(block: ContentBlock): block is ContentBlockImage {
  return block.type === "image"
}

function isContentBlockToolUse(block: ContentBlock): block is ContentBlockToolUse {
  return block.type === "tool_use"
}

function isContentBlockToolResult(block: ContentBlock): block is ContentBlockToolResult {
  return block.type === "tool_result"
}