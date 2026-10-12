/**
 * File Name: errors.ts
 * Purpose: Defines the RequestError class used throughout the API to signal structured,
 *          HTTP-status-aware errors that the error middleware serialises into JSON responses.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None
 */
export class RequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 422,
    public readonly fieldErrors?: Record<string, string>,
    /** Arbitrary structured payload surfaced to the client (e.g. a cascade plan). */
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'RequestError'
  }
}
