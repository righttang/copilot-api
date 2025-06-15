// Anthropic API types based on the Python implementation

export interface ContentBlockText {
  type: "text"
  text: string
}

export interface ContentBlockImageSource {
  type: string
  media_type: string
  data: string
}

export interface ContentBlockImage {
  type: "image"
  source: ContentBlockImageSource
}

export interface ContentBlockToolUse {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, any>
}

export interface ContentBlockToolResult {
  type: "tool_result"
  tool_use_id: string
  content: string | Array<Record<string, any>> | Array<any>
  is_error?: boolean
}

export type ContentBlock = 
  | ContentBlockText 
  | ContentBlockImage 
  | ContentBlockToolUse 
  | ContentBlockToolResult

export interface SystemContent {
  type: "text"
  text: string
}

export interface AnthropicMessage {
  role: "user" | "assistant"
  content: string | Array<ContentBlock>
}

export interface AnthropicTool {
  name: string
  description?: string
  input_schema: Record<string, any>
}

export interface AnthropicToolChoice {
  type: "auto" | "any" | "tool"
  name?: string
}

export interface AnthropicMessagesRequest {
  model: string
  max_tokens: number
  messages: Array<AnthropicMessage>
  system?: string | Array<SystemContent>
  stop_sequences?: Array<string>
  stream?: boolean
  temperature?: number
  top_p?: number
  top_k?: number
  metadata?: Record<string, any>
  tools?: Array<AnthropicTool>
  tool_choice?: AnthropicToolChoice
}

export interface AnthropicUsage {
  input_tokens: number
  output_tokens: number
}

export interface AnthropicMessagesResponse {
  id: string
  type: "message"
  role: "assistant"
  model: string
  content: Array<ContentBlock>
  stop_reason?: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "error"
  stop_sequence?: string
  usage: AnthropicUsage
}

export interface AnthropicTokenCountRequest {
  model: string
  messages: Array<AnthropicMessage>
  system?: string | Array<SystemContent>
  tools?: Array<AnthropicTool>
}

export interface AnthropicTokenCountResponse {
  input_tokens: number
}

export interface AnthropicErrorDetail {
  type: "invalid_request_error" | "authentication_error" | "permission_error" | 
        "not_found_error" | "rate_limit_error" | "api_error" | "overloaded_error" | 
        "request_too_large_error"
  message: string
  provider?: string
  provider_message?: string
  provider_code?: string | number
}

export interface AnthropicErrorResponse {
  type: "error"
  error: AnthropicErrorDetail
}

// Streaming event types
export interface AnthropicStreamEvent {
  type: string
  [key: string]: any
}

export interface AnthropicMessageStartEvent extends AnthropicStreamEvent {
  type: "message_start"
  message: {
    id: string
    type: "message"
    role: "assistant"
    model: string
    content: Array<any>
    stop_reason: null
    stop_sequence: null
    usage: { input_tokens: number; output_tokens: number }
  }
}

export interface AnthropicContentBlockStartEvent extends AnthropicStreamEvent {
  type: "content_block_start"
  index: number
  content_block: {
    type: "text" | "tool_use"
    text?: string
    id?: string
    name?: string
    input?: Record<string, any>
  }
}

export interface AnthropicContentBlockDeltaEvent extends AnthropicStreamEvent {
  type: "content_block_delta"
  index: number
  delta: {
    type: "text_delta" | "input_json_delta"
    text?: string
    partial_json?: string
  }
}

export interface AnthropicContentBlockStopEvent extends AnthropicStreamEvent {
  type: "content_block_stop"
  index: number
}

export interface AnthropicMessageDeltaEvent extends AnthropicStreamEvent {
  type: "message_delta"
  delta: {
    stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "error"
    stop_sequence?: string
  }
  usage: { output_tokens: number }
}

export interface AnthropicMessageStopEvent extends AnthropicStreamEvent {
  type: "message_stop"
}

export interface AnthropicPingEvent extends AnthropicStreamEvent {
  type: "ping"
}

export interface AnthropicErrorEvent extends AnthropicStreamEvent {
  type: "error"
  error: AnthropicErrorDetail
}