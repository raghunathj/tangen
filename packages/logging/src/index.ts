/**
 * File Name: index.ts
 * Purpose: Configures and exposes the Tangen structured logger built on LogTape, switching between pretty console output in dev and JSON-lines for production log aggregators.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Uses @logtape/logtape for sink configuration; re-exports TangenLogger from @tangen/types.
 *          Every message and property passes through redact.ts before a sink
 *          sees it (credential keys, bearer tokens, Tangen keys, JWTs,
 *          connection-string passwords), and the installed log context (the
 *          request id, from the API's Gateway) rides every record.
 */
import {
  configureSync,
  resetSync,
  getLogger as logtapeGetLogger,
  getConsoleSink,
} from '@logtape/logtape'
import type { TangenLogger } from '@tangen/types'

export type { TangenLogger }
export { redactMeta, redactString, redactValue, isSecretKey, REDACTED } from './redact'
import { redactMeta, redactString } from './redact'

/** Properties every record carries while a context is open (the API installs the request id). */
type LogContextProvider = () => Record<string, unknown> | undefined

let _context: LogContextProvider | null = null

/**
 * Installs the provider whose properties ride every record: the API's Gateway
 * hands the current request id here, so any log line written while a request
 * runs is correlatable with the response the client saw. Idempotent by
 * replacement; `null` removes it.
 */
export function setLogContext(provider: LogContextProvider | null): void {
  _context = provider
}

/** The properties the installed context would add to a record right now. */
export function getLogContext(): Record<string, unknown> {
  return _context ? (_context() ?? {}) : {}
}

function withContext(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  return { ...getLogContext(), ...redactMeta(meta) }
}

type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'fatal'

let _configured = false

/** Reset internal state — only for use in tests (via resetLogging). */
function _reset() { _configured = false }

/**
 * Call once at server startup. Dev gets a pretty coloured sink; prod gets
 * JSON-lines to stdout parseable by Datadog, Grafana Loki, etc.
 */
export function configureTangenLogging(options?: { level?: LogLevel }): void {
  if (_configured) return
  _configured = true

  const isProd = process.env.NODE_ENV === 'production'
  // TANGEN_LOG_LEVEL turns a chatty development boot down (`warn`) or a
  // production process up (`debug`) without touching code.
  const fromEnv = (process.env.TANGEN_LOG_LEVEL ?? '').trim().toLowerCase()
  const envLevel = (['debug', 'info', 'warning', 'error', 'fatal'] as const).find((l) => l === fromEnv || (l === 'warning' && fromEnv === 'warn'))
  const level: LogLevel = options?.level ?? envLevel ?? (isProd ? 'info' : 'debug')

  if (isProd) {
    const jsonSink = (record: any) => {
      process.stdout.write(
        JSON.stringify({
          level: record.level,
          category: (record.category as string[]).join('.'),
          message: record.rawMessage,
          timestamp: new Date(record.timestamp as number).toISOString(),
          ...record.properties,
        }) + '\n',
      )
    }

    configureSync({
      sinks: { json: jsonSink },
      loggers: [
        { category: ['logtape', 'meta'], lowestLevel: 'warning', sinks: [] },
        { category: ['tangen'], lowestLevel: level, sinks: ['json'] },
      ],
    })
  } else {
    // Colored dev output: WRN amber, ERR/FTL red, INF green, DBG dim — so
    // problems stand out in the tangen dev stream instead of plain white.
    const COLORS: Record<string, string> = { debug: '2', info: '32;1', warning: '33;1', error: '31;1', fatal: '41;97;1' }
    const TAGS: Record<string, string> = { debug: 'DBG', info: 'INF', warning: 'WRN', error: 'ERR', fatal: 'FTL' }
    const tty = process.stdout.isTTY && !process.env.NO_COLOR
    const paint = (code: string, text: string) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text)
    const coloredFormatter = (record: { level: string; category: readonly string[]; message: readonly unknown[]; timestamp: number }) => {
      const ts = paint('2', new Date(record.timestamp).toISOString().replace('T', ' ').slice(0, 23))
      const lvl = paint(COLORS[record.level] ?? '0', TAGS[record.level] ?? record.level.toUpperCase().slice(0, 3))
      const cat = paint('1', record.category.join(paint('2', '·')))
      const msg = record.message.map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join('')
      const line = `${ts} ${lvl} ${cat} ${record.level === 'error' || record.level === 'fatal' ? paint('31', msg) : record.level === 'warning' ? paint('33', msg) : msg}`
      return line + '\n'
    }
    configureSync({
      sinks: { console: getConsoleSink({ formatter: coloredFormatter as never }) },
      loggers: [
        { category: ['logtape', 'meta'], lowestLevel: 'warning', sinks: [] },
        { category: ['tangen'], lowestLevel: level, sinks: ['console'] },
      ],
    })
  }
}

/**
 * Get a structured logger for the given category path.
 * Category convention: ['tangen', 'api', 'hooks'] etc.
 */
export function getLogger(category: string[]): TangenLogger {
  const inner = logtapeGetLogger(category)
  return {
    debug(message, meta?) {
      inner.debug(redactString(message), withContext(meta))
    },
    info(message, meta?) {
      inner.info(redactString(message), withContext(meta))
    },
    warn(message, meta?) {
      inner.warn(redactString(message), withContext(meta))
    },
    error(message, errorOrMeta?) {
      if (errorOrMeta instanceof Error) {
        inner.error(redactString(message), withContext({
          errorMessage: errorOrMeta.message,
          errorStack: errorOrMeta.stack,
        }))
      } else {
        inner.error(redactString(message), withContext(errorOrMeta))
      }
    },
  }
}

/** Reset all LogTape state AND the configured flag — for use in tests only. */
export function resetLogging(): void {
  resetSync()
  _reset()
  _context = null
}
