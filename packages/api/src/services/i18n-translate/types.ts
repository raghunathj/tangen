/**
 * File Name: types.ts
 * Purpose: One interface for machine-translation engines — Google Translate
 *          and the AI providers implement the same batch contract.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: order matters — engines return exactly one translation
 *          per input text, in input order.
 */
import type { AIUsage } from '../ai/types'

export interface TranslateOptions {
  /** Source locale code; omit to let the engine detect. */
  source?: string
  /** Target locale code — required. */
  target: string
}

export interface TranslateEngine {
  readonly name: string
  /** Token usage of the last call (AI engines only). */
  usage?: AIUsage
  translate(texts: string[], opts: TranslateOptions): Promise<string[]>
}
