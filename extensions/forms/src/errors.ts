/**
 * File Name: errors.ts
 * Purpose: The error the Forms routes throw. Core's dispatchers translate a
 *          RouteError into the platform envelope and lift `code` and
 *          `fieldErrors` out of its details, so the embed runtime and the
 *          admin see the same shape they did when Forms lived in core
 *          (`error.code`, `error.fieldErrors`).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { RouteError } from '@tangen/cms'

export class RequestError extends RouteError {
  readonly code: string
  readonly statusCode: number
  readonly fieldErrors?: Record<string, string>
  constructor(code: string, message: string, statusCode: number, fieldErrors?: Record<string, string>, details?: unknown) {
    super(statusCode, message, { code, ...(fieldErrors ? { fieldErrors } : {}), ...(details !== undefined ? { details } : {}) })
    this.code = code
    this.statusCode = statusCode
    this.fieldErrors = fieldErrors
  }
}
