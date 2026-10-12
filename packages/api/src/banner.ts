/**
 * File Name: banner.ts
 * Purpose: Renders the Tangen startup banner to stdout, displaying server URLs, active
 *          workspaces, enabled extensions, and running background workers.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Uses ANSI escape codes for terminal colour; colours are suppressed
 *                     when stdout is not a TTY or NO_COLOR is set.
 */
import type { WorkspaceProject } from '@tangen/types'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The API's published version, read from its own package.json - the banner and /api/health say the same thing. */
const PACKAGE_VERSION: string = (() => {
  try { return String(JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version ?? '0.0.0') } catch { return '0.0.0' }
})()

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR
const ansi = (code: string) => (s: string) => COLOR ? `\x1b[${code}m${s}\x1b[0m` : s

const c = {
  bold:    ansi('1'),
  dim:     ansi('2'),
  cyan:    ansi('36'),
  green:   ansi('32'),
  yellow:  ansi('33'),
  blue:    ansi('34'),
  white:   ansi('97'),
}

const LOGO = [
  '   __                             ',
  '  / /_____ _____  ____ ____  ____ ',
  ' / __/ __ `/ __ \\/ __ `/ _ \\/ __ \\',
  '/ /_/ /_/ / / / / /_/ /  __/ / / /',
  '\\__/\\__,_/_/ /_/\\__, /\\___/_/ /_/ ',
  '               /____/             ',
]

function detectExtensions(projects: WorkspaceProject[]): string[] {
  const exts = new Set<string>()
  for (const p of projects) {
    if (p.routes?.length) exts.add('Custom Routes')
    for (const entry of p.declaredExtensions ?? []) {
      const name = (entry as any)?.name ?? (entry as any)?.id
      if (name) exts.add(name)
    }
  }
  return [...exts]
}

/**
 * Prints the Tangen ASCII logo and a startup info table to stdout.
 * @param opts.port - API server port
 * @param opts.projects - Loaded workspace projects to display
 * @param opts.workers - Names of background workers that have been started
 * @param opts.version - Package version string (defaults to the package's own)
 */
export function printBanner(opts: {
  port: number
  projects: WorkspaceProject[]
  workers: string[]
  version?: string
}) {
  const { port, projects, workers, version = PACKAGE_VERSION } = opts
  const isProd = process.env.NODE_ENV === 'production'
  const mode = isProd ? 'production' : 'development'
  const adminPort = process.env.ADMIN_PORT ?? 3001
  const appUrl = `http://localhost:${adminPort}`
  const apiUrl = `http://localhost:${port}`

  const workspaceNames = projects.length
    ? projects.map(p => c.white(p.workspaceId)).join(c.dim(', '))
    : c.dim('none')

  const extensions = detectExtensions(projects)
  const extensionDisplay = extensions.length
    ? extensions.map(e => c.white(e)).join(c.dim('  ·  '))
    : c.dim('none')

  const workerDisplay = workers.length
    ? workers.map(w => c.dim(w)).join(c.dim('  ·  '))
    : c.dim('none')

  const divider = c.dim('  ' + '─'.repeat(58))

  console.log()
  for (const line of LOGO) {
    console.log('  ' + c.cyan(line))
  }
  console.log()
  console.log(`  ${c.dim('v' + version + '  ·  4Monks Consulting Product  ·  www.tangen.app')}`)
  console.log()
  console.log(divider)
  console.log()

  const rows: Array<[string, string]> = [
    ['mode',        isProd ? c.yellow(mode) : c.green(mode)],
    ['admin',       c.cyan(c.bold(appUrl))],
    ['api',         c.dim(apiUrl)],
    ...(projects.some((p) => (p as { config?: { mcp?: { enabled?: boolean } } }).config?.mcp?.enabled)
      ? [['mcp', `${c.dim(apiUrl + '/api/v1/mcp')}  ${c.dim('· connect an agent: tangen mcp')}`] as [string, string]]
      : []),
    ['workspaces',  workspaceNames],
    ['extensions',  extensionDisplay],
    ['workers',     workerDisplay],
  ]

  const labelW = Math.max(...rows.map(([k]) => k.length)) + 4

  for (const [label, value] of rows) {
    console.log(`  ${c.dim(label.padEnd(labelW))}${value}`)
  }

  console.log()
  console.log(divider)
  console.log()
}
