import consola from "consola"
import fs from "node:fs/promises"

import { PATHS } from "~/lib/paths"
import { getCopilotToken } from "~/services/github/get-copilot-token"
import { getDeviceCode } from "~/services/github/get-device-code"
import { getGitHubUser } from "~/services/github/get-user"
import { pollAccessToken } from "~/services/github/poll-access-token"

import { HTTPError } from "./http-error"
import { state } from "./state"

const readGithubToken = () => fs.readFile(PATHS.GITHUB_TOKEN_PATH, "utf8")

const writeGithubToken = (token: string) =>
  fs.writeFile(PATHS.GITHUB_TOKEN_PATH, token)

// Utility function to format timestamp as "2001-01-01 13:00:00"
const formatTimestamp = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

// Track the refresh interval to prevent multiple intervals
let refreshIntervalId: NodeJS.Timeout | null = null
let refreshFailureCount = 0
const MAX_REFRESH_FAILURES = 3

export const setupCopilotToken = async () => {
  // Clear any existing interval
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId)
    refreshIntervalId = null
  }

  const { token, refresh_in } = await getCopilotToken()
  state.copilotToken = token
  refreshFailureCount = 0 // Reset failure count on successful setup

  const refreshInterval = (refresh_in - 60) * 1000
  consola.info(`[${formatTimestamp()}] Copilot token will refresh in ${Math.round(refreshInterval / 1000)} seconds`)

  refreshIntervalId = setInterval(async () => {
    consola.start(`[${formatTimestamp()}] Refreshing Copilot token`)
    try {
      const { token, refresh_in: newRefreshIn } = await getCopilotToken()
      state.copilotToken = token
      refreshFailureCount = 0 // Reset failure count on success
      consola.success(`[${formatTimestamp()}] Copilot token refreshed successfully`)
      consola.debug(`[${formatTimestamp()}] Next refresh in ${newRefreshIn - 60} seconds`)
    } catch (error) {
      refreshFailureCount++
      consola.error(`[${formatTimestamp()}] Failed to refresh Copilot token (attempt ${refreshFailureCount}/${MAX_REFRESH_FAILURES}):`, error)
      
      // If we've failed too many times, check if GitHub token is still valid
      if (refreshFailureCount >= MAX_REFRESH_FAILURES) {
        consola.error(`[${formatTimestamp()}] Multiple refresh failures detected. This might indicate an expired GitHub token.`)
        consola.info(`[${formatTimestamp()}] Consider running the 'auth' command to refresh your GitHub token`)
        refreshFailureCount = 0 // Reset to prevent spam
      }
      
      // Don't throw the error - this would stop the interval
      // Instead, log the error and let the interval continue
      // The next refresh attempt will try again
    }
  }, refreshInterval)
}

interface SetupGitHubTokenOptions {
  force?: boolean
}

export async function setupGitHubToken(
  options?: SetupGitHubTokenOptions,
): Promise<void> {
  try {
    const githubToken = await readGithubToken()

    if (githubToken && !options?.force) {
      state.githubToken = githubToken
      await logUser()

      return
    }

    consola.info("Not logged in, getting new access token")
    const response = await getDeviceCode()
    consola.debug("Device code response:", response)

    consola.info(
      `Please enter the code "${response.user_code}" in ${response.verification_uri}`,
    )

    const token = await pollAccessToken(response)
    await writeGithubToken(token)
    state.githubToken = token

    await logUser()
  } catch (error) {
    if (error instanceof HTTPError) {
      consola.error("Failed to get GitHub token:", await error.response.json())
      throw error
    }

    consola.error("Failed to get GitHub token:", error)
    throw error
  }
}

async function logUser() {
  const user = await getGitHubUser()
  consola.info(`Logged in as ${user.login}`)
}
