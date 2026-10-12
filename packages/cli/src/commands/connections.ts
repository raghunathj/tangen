/**
 * File Name: connections.ts
 * Purpose: `tangen connections rotate-key` (Extension Kernel K6.3,
 *          tasks/plan-extension-kernel.md). Re-seals every connection row of
 *          this deployment's database under the CURRENT connections key,
 *          opening each with the PREVIOUS one. The previous key comes only
 *          from TANGEN_CONNECTIONS_KEY_PREVIOUS - never from argv, which
 *          lands in shell history and process lists. The current key
 *          resolves the way boot resolves it: the deployment's
 *          `connections.encryptionKey`, else TANGEN_CONNECTIONS_KEY, else the
 *          member session secret (JWT_SECRET, or the development secret
 *          file). Rows neither key opens are named, never dropped; Doctor
 *          reports them as CONNECTION_UNREADABLE.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveProjectDeployment, envSecretProvider, type TangenConfig } from '@tangen/types'
import { deriveConnectionsKey, rotateConnectionsKey } from '@tangen/db'
import { resolveDeploymentDatabase, describeDatabaseError, deploymentRole } from '../deployment-database'
import { c, sym } from '../ui'

export interface ConnectionsKeyMaterial {
  material: string
  /** `explicit`: the deployment named a key; `derived`: the member session secret stands in (development). */
  source: 'explicit' | 'derived'
}

/** The same precedence boot uses for the connections key; null when nothing at all is available. */
export function resolveConnectionsKeyMaterial(input: {
  deploymentSecret?: string
  env: Record<string, string | undefined>
  /** The development session secret file (`.tangen/dev-jwt-secret`), read lazily. */
  devSecretFile: () => string | null
}): ConnectionsKeyMaterial | null {
  const explicit = input.deploymentSecret || input.env.TANGEN_CONNECTIONS_KEY
  if (explicit) return { material: explicit, source: 'explicit' }
  const jwt = input.env.JWT_SECRET
  if (jwt) return { material: jwt, source: 'derived' }
  const dev = input.devSecretFile()
  return dev ? { material: dev, source: 'derived' } : null
}

/** What `lib/jwt-secret.ts` writes for development: one line of material. */
export function readDevSecretFile(cwd: string, env: Record<string, string | undefined> = process.env): string | null {
  const p = resolve(cwd, env.TANGEN_DEV_SECRET_FILE ?? '.tangen/dev-jwt-secret')
  if (!existsSync(p)) return null
  const v = readFileSync(p, 'utf8').trim()
  return v || null
}

export interface RotateKeyOptions { json?: boolean }

/** Loads the deployment, resolves both keys, re-seals, prints. Exit 0 done, 1 when rows stay unreadable, 2 when it could not run. */
export async function runConnectionsRotateKeyCommand(cwd: string, opts: RotateKeyOptions = {}): Promise<{ resealed: number; unreadable: string[] } | null> {
  const fail = (message: string): null => {
    if (opts.json) console.log(JSON.stringify({ ok: false, exitCode: 2, error: message }, null, 2))
    else console.error(`  ${sym.cross}  ${c.red(message)}`)
    process.exitCode = 2
    return null
  }
  // Read through the secret provider, the one reader of configuration variables; never argv.
  const previous = envSecretProvider().read('TANGEN_CONNECTIONS_KEY_PREVIOUS')
  if (!previous) return fail('Set TANGEN_CONNECTIONS_KEY_PREVIOUS to the key the rows are sealed under today (the value is never taken from the command line)')

  let config: TangenConfig & Record<string, unknown>
  try {
    const { resolveEffectiveConfig } = await import('./push-config')
    const mod = await import(`${resolve(cwd, 'tangen.config.ts')}?t=${Date.now()}`)
    config = await resolveEffectiveConfig(cwd, mod.default as TangenConfig) as TangenConfig & Record<string, unknown>
  } catch (e) {
    return fail(`Could not load tangen.config.ts from ${cwd}: ${e instanceof Error ? e.message : String(e)}`)
  }
  const workspaceId = (config.workspaceId as string | undefined) ?? 'wsp_local_dev'
  const deployment = resolveProjectDeployment({
    project: { workspaceId, config: config as never, siteConfig: config.siteConfig, integrations: config.integrations as never },
    role: deploymentRole(),
  })
  const current = resolveConnectionsKeyMaterial({
    deploymentSecret: deployment.secrets.get('connections.encryptionKey'),
    env: process.env, devSecretFile: () => readDevSecretFile(cwd),
  })
  if (!current) return fail('No connections key is available: set TANGEN_CONNECTIONS_KEY (or connections.encryptionKey) for this deployment')

  let url: string
  try { url = resolveDeploymentDatabase().url } catch (e) { return fail(describeDatabaseError(e)) }
  const { createDb } = await import('@tangen/db')
  const db: any = createDb(url)
  const raw = (text: string, params: unknown[] = []) => (db.$rawClient ?? db.session?.client).unsafe(text, params as never) as Promise<Array<Record<string, unknown>>>
  try { await raw('SELECT 1') } catch (e) { return fail(`Could not connect to the database: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`) }

  let result: { resealed: number; unreadable: string[] }
  try {
    result = await rotateConnectionsKey(raw, { from: deriveConnectionsKey(previous), to: deriveConnectionsKey(current.material) })
  } catch (e) {
    return fail(`Rotation failed: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    await (db.$rawClient ?? db.session?.client)?.end?.().catch(() => {})
  }
  process.exitCode = result.unreadable.length ? 1 : 0
  if (opts.json) {
    console.log(JSON.stringify({ ok: result.unreadable.length === 0, exitCode: process.exitCode, keySource: current.source, ...result }, null, 2))
  } else {
    console.log(`  ${sym.tick}  Re-sealed ${result.resealed} connection${result.resealed === 1 ? '' : 's'} under the current key (${current.source})`)
    if (result.unreadable.length) {
      console.log(`  ${sym.cross}  ${c.red(`${result.unreadable.length} connection${result.unreadable.length === 1 ? '' : 's'} neither key opens:`)} ${result.unreadable.join(', ')}`)
      console.log(`     Reconnect them in Settings → Connections, or rotate again with the key they were sealed under.`)
    }
  }
  return result
}
