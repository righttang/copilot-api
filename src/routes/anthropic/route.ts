import { Hono } from "hono"
import { handleAnthropicMessages, handleAnthropicTokenCount } from "./handler"

export const anthropicRoutes = new Hono()

// Main Anthropic messages endpoint
anthropicRoutes.post("/", handleAnthropicMessages)

// Token counting endpoint  
anthropicRoutes.post("/count_tokens", handleAnthropicTokenCount)