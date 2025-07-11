# Copilot API

⚠️ **EDUCATIONAL PURPOSE ONLY** ⚠️
This project is a reverse-engineered implementation of the GitHub Copilot API created for educational purposes only. It is not officially supported by GitHub and should not be used in production environments.

## API Endpoints

This project implements multiple API endpoints to provide compatibility with different AI tools and frameworks:

### OpenAI-Compatible Endpoints

These endpoints follow the OpenAI API specification and are compatible with tools that expect OpenAI's API format:

- **`POST /chat/completions`** - Chat completion endpoint for conversational AI
- **`POST /v1/chat/completions`** - Same as above with v1 prefix for tool compatibility
- **`GET /models`** - List available models from GitHub Copilot
- **`GET /v1/models`** - Same as above with v1 prefix
- **`POST /embeddings`** - Generate text embeddings
- **`POST /v1/embeddings`** - Same as above with v1 prefix

### Anthropic-Compatible Endpoints

These endpoints follow the Anthropic API specification and are compatible with tools that expect Claude's API format:

- **`POST /v1/messages`** - Main Anthropic messages endpoint for chat completion
- **`POST /v1/messages/count_tokens`** - Token counting endpoint for input estimation

### Server Status

- **`GET /`** - Server health check endpoint

All endpoints proxy requests to GitHub Copilot's API while maintaining compatibility with the respective API formats. The server automatically handles authentication, request/response translation, and model selection.

## Claude Code Integration

This fork includes Anthropic-compatible endpoints that make it work seamlessly with [Claude Code](https://claude.ai/code), Anthropic's official CLI for Claude. The server provides `/v1/messages` endpoints that translate between Anthropic's API format and GitHub Copilot's OpenAI-compatible interface.

### Using with Claude Code

1. Start the server:
   ```sh
   bun run dev start --port 4143 --business --verbose
   ```

2. Configure Claude Code environment variables:
   ```sh
   export ANTHROPIC_API_KEY="dummy-key"
   export ANTHROPIC_BASE_URL="http://localhost:4143"
   export ANTHROPIC_MODEL="claude-sonnet-4"
   set -e CLAUDE_CODE_USE_BEDROCK
   ```

3. Use Claude Code normally - it will route through GitHub Copilot while maintaining full compatibility with Anthropic's API format.

## Project Overview

A wrapper around GitHub Copilot API to make it OpenAI compatible, making it usable for other tools like AI assistants, local interfaces, and development utilities.

## Demo

https://github.com/user-attachments/assets/7654b383-669d-4eb9-b23c-06d7aefee8c5

## Prerequisites

- Bun (>= 1.2.x)
- GitHub account with Copilot subscription (Individual or Business)

## Installation

To install dependencies, run:

```sh
bun install
```

## Using with Docker

Build image

```sh
docker build -t copilot-api .
```

Run the container

```sh
docker run -p 4141:4141 copilot-api
```

## Command Structure

Copilot API now uses a subcommand structure with two main commands:

- `start`: Start the Copilot API server (default command). This command will also handle authentication if needed.
- `auth`: Run GitHub authentication flow without starting the server. This is typically used if you need to generate a token for use with the `--github-token` option, especially in non-interactive environments.

## Command Line Options

### Start Command Options

The following command line options are available for the `start` command:

| Option         | Description                                                                   | Default | Alias |
| -------------- | ----------------------------------------------------------------------------- | ------- | ----- |
| --port         | Port to listen on                                                             | 4141    | -p    |
| --verbose      | Enable verbose logging                                                        | false   | -v    |
| --business     | Use a business plan GitHub account                                            | false   | none  |
| --enterprise   | Use an enterprise plan GitHub account                                         | false   | none  |
| --manual       | Enable manual request approval                                                | false   | none  |
| --rate-limit   | Rate limit in seconds between requests                                        | none    | -r    |
| --wait         | Wait instead of error when rate limit is hit                                  | false   | -w    |
| --github-token | Provide GitHub token directly (must be generated using the `auth` subcommand) | none    | -g    |

### Auth Command Options

| Option    | Description            | Default | Alias |
| --------- | ---------------------- | ------- | ----- |
| --verbose | Enable verbose logging | false   | -v    |

## Example Usage

```sh
# Basic usage with start command
bun run dev start

# Run on custom port with verbose logging
bun run dev start --port 4143 --verbose

# Use with a business plan GitHub account
bun run dev start --business

# Use with an enterprise plan GitHub account
bun run dev start --enterprise

# Enable manual approval for each request
bun run dev start --manual

# Set rate limit to 30 seconds between requests
bun run dev start --rate-limit 30

# Wait instead of error when rate limit is hit
bun run dev start --rate-limit 30 --wait

# Provide GitHub token directly
bun run dev start --github-token ghp_YOUR_TOKEN_HERE

# Run only the auth flow
bun run dev auth

# Run auth flow with verbose logging
bun run dev auth --verbose
```

## Running from Source

The project can be run from source in several ways:

### Development Mode

```sh
bun run dev
```

### Production Mode

```sh
bun run start
```

## Usage Tips

- Consider using free models (e.g., Gemini, Mistral, Openrouter) as the `weak-model`
- Use architect mode sparingly
- Disable `yes-always` in your aider configuration
- Be mindful that Claude 3.7 thinking mode consumes more tokens
- Enable the `--manual` flag to review and approve each request before processing
- If you have a GitHub business or enterprise plan account with Copilot, use the `--business` or `--enterprise` flag respectively

### Manual Request Approval

When using the `--manual` flag, the server will prompt you to approve each incoming request:

```
? Accept incoming request? > (y/N)
```

This helps you control usage and monitor requests in real-time.
