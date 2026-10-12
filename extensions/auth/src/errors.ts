/**
 * File Name: errors.ts
 * Purpose: The extension's request error: a RouteError carrying the code and
 *          field errors the platform envelope lifts (`error.code`,
 *          `error.fieldErrors`) on both mounts.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { RouteError } from '@tangen/cms'

export class RequestError extends RouteError {
  readonly code: string
  readonly statusCode: number
  readonly fieldErrors?: Record<string, string>
  constructor(code: string, message: string, statusCode: number, fieldErrors?: Record<string, string>) {
    super(statusCode, message, { code, ...(fieldErrors ? { fieldErrors } : {}) })
    this.code = code
    this.statusCode = statusCode
    this.fieldErrors = fieldErrors
  }
}

export const unauthorized = (message: string) => new RequestError('UNAUTHORIZED', message, 401)
export const forbidden = (message: string) => new RequestError('FORBIDDEN', message, 403)
export const invalid = (message: string, fieldErrors?: Record<string, string>) => new RequestError('VALIDATION_ERROR', message, 422, fieldErrors)
