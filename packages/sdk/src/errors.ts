/**
 * File Name: errors.ts
 * Purpose: Defines TangenError — the typed error class thrown by SDK methods when the Tangen API returns a non-2xx response.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None
 */

/**
 * Error thrown by the Tangen SDK when an API request fails with a non-2xx status.
 */
export class TangenError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    /**
     * One reason per field path, when the API refused the input
     * (`VALIDATION_ERROR`): `{ "sort.direction": "Expected required
     * property" }`. The reason describes the schema, never the value that
     * was sent. Absent on every other kind of error.
     */
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message)
    this.name = 'TangenError'
  }
}
