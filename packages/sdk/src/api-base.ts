/**
 * File Name: api-base.ts
 * Purpose: One meaning for the SDK's base URL, shared by every entry point.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `apiUrl` is the site's ORIGIN - the same thing you type
 *          into a browser. The SDK adds the API path itself.
 *
 *          This exists because it used to be ambiguous: the client
 *          concatenated paths onto the base and so silently required
 *          /api/v1, while fetchPreviewObject appended /api/v1 for you. Every
 *          documented example passed a bare origin, so the documented usage
 *          failed - and it failed as "Route not found", which reads like
 *          missing content rather than a misconfigured URL. Both entry points
 *          now resolve the base through here, so they cannot drift apart
 *          again.
 */

/** The API path this SDK speaks. */
const API_PATH = '/api/v1'

/**
 * Normalises a configured base URL to the API root.
 *
 * A bare origin gets the API path appended; a base that already names it is
 * returned unchanged, so callers who spelled it out keep working.
 */
export function resolveApiBase(apiUrl: string): string {
  const trimmed = apiUrl.replace(/\/+$/, '')
  return trimmed.endsWith(API_PATH) ? trimmed : `${trimmed}${API_PATH}`
}
