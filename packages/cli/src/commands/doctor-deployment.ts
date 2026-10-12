/**
 * File Name: doctor-deployment.ts
 * Purpose: `tangen doctor --deployment`. Explains THIS deployment the way
 *          boot sees it, from the SAME primitives boot uses -
 *          resolveProjectDeployment, validateProjectDeployment, the
 *          provenance projection - plus what only a command with a database
 *          connection can add: extension activation, the desired-membership
 *          plan, and the LIVE identity of the database (what the server says
 *          it is, not what the URL says). Never prints a secret value:
 *          references and resolved yes/no only.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Exit 0 clean, 1 on an ERROR finding, 2 unreachable.
 *          The report is built by a pure function over gathered inputs so
 *          the rendering and the verdict are testable without a database.
 *          One deployment, one database, one role
 *          (tasks/remove-environments-programme.md): there is nothing to
 *          select, so the command takes no target.
 */
import { resolve } from 'node:path'
import {
  resolveProjectDeployment, validateProjectDeployment, databaseIdentity, planMemberReconciliation,
  findDanglingGrants, ALL_CAPABILITIES, compileExtensionPermissions, findCoarseCapabilities,
  type ResolvedDeployment, type DeploymentFinding, type Provenance, type TangenConfig, type ActivationMap, type MembersDesiredState, type DeploymentRole,
} from '@tangen/types'
import { resolveDeploymentDatabase, describeDatabaseError, deploymentRole, type DeploymentDatabase } from '../deployment-database'
import { c, sym } from '../ui'
import { connectionFindings, type DoctorConnectionFinding } from './doctor-connections'

export interface LiveDatabaseIdentity {
  /** The static identity (host, port, database name) URLs compare by. */
  staticIdentity: string
  /** What the server said: `cluster@<start>/db#<oid>` - null when unreachable. */
  live: string | null
  error?: string
}

export interface DeploymentReportInput {
  role: DeploymentRole
  workspaceId: string
  config: TangenConfig & Record<string, unknown>
  deployment: ResolvedDeployment
  findings: DeploymentFinding[]
  /** The activation of every known extension in this workspace; null when it could not be read. */
  activation: ActivationMap | null
  identity: LiveDatabaseIdentity
  membersDesired?: MembersDesiredState
  existingMembers?: Parameters<typeof planMemberReconciliation>[1]
  /** Stored per-member grants in this deployment, checked for dangling references. */
  memberGrants?: Array<{ memberId: string; capabilities: string[]; extensions: string[] }>
  /** Each active extension's declared/compiled capabilities, checked for a missing read/write split. */
  extensionCapabilities?: Array<{ extensionId: string; capabilities: Array<{ id: string }> }>
  replicas: number
  /** Where the database URL came from. */
  databaseSource: DeploymentDatabase['source']
  /** The connections table under this deployment's key (Extension Kernel K6.3); absent when it could not be read. */
  connections?: { total: number; keySource: 'explicit' | 'derived'; unreadable: Array<{ id: string; label: string; workspaceId: string }> }
  /**
   * The integration findings (plan-connectors F3): a provider two packs claim,
   * a dormant row, a pack switched off, a capability a consumer needs, a
   * failed check. Computed by `connectionFindings` from rows and manifests, so
   * Doctor needs no extension runtime and reads no credential.
   */
  connectionFindings?: DoctorConnectionFinding[]
}

export interface DeploymentReport {
  version: 2
  role: DeploymentRole
  database: { identity: string | null; source: DeploymentDatabase['source'] }
  urls: { server: string | null; admin: string | null; frontend: string | null; preview: string | null }
  redis: 'enabled' | 'unset' | 'disabled'
  storage: { adapter: string; mediaDir: string | null }
  replicas: number
  findings: DeploymentFinding[]
  /** Every key of the deployment: value for diagnostic keys, references and resolved yes/no for secrets, never material. */
  keys: Provenance[]
  extensions: Array<{ id: string; state: string; reason: string | null }>
  integrations: Array<{ name: string; ready: boolean; credentials: Array<{ key: string; secretRef: string; resolved: boolean }> }>
  members: { desired: number; steps: number; toCreate: number } | null
  connections?: { total: number; unreadable: number; keySource: 'explicit' | 'derived' }
  liveIdentity: LiveDatabaseIdentity
  exitCode: 0 | 1
}

/** The report, pure: the verdict is the findings' worst severity; nothing here reads a database or the process. */
export function buildDeploymentReport(input: DeploymentReportInput): DeploymentReport {
  const selected = input.deployment
  const findings = [...input.findings]
  if (input.databaseSource === 'local-default') {
    findings.push({ severity: 'info', code: 'LOCAL_DEFAULT_DATABASE', message: 'DATABASE_URL is not set: this development process uses the local default database', workspace: input.workspaceId })
  }

  const extensions: DeploymentReport['extensions'] = []
  if (input.activation) {
    for (const [id, r] of Object.entries(input.activation)) extensions.push({ id, state: r.state, reason: r.reason })
  }

  const integrations: DeploymentReport['integrations'] = []
  const names = new Set<string>()
  for (const spec of selected.registry.specs.values()) { const m = /^integration\.([^.]+)\./.exec(spec.key); if (m) names.add(m[1]!) }
  for (const name of [...names].sort()) {
    const it = selected.integration(name)!
    const credentials = selected.registry.under(`integration.${name}`).filter((s) => s.secret).map((s) => {
      const p = selected.explain(s.key)
      return { key: s.key, secretRef: p?.secret?.secretRef ?? s.secretRef ?? '?', resolved: p?.secret?.resolved === true }
    })
    integrations.push({ name, ready: it.ready, credentials })
  }

  let members: DeploymentReport['members'] = null
  if (input.membersDesired?.length && input.existingMembers) {
    const plan = planMemberReconciliation(input.membersDesired, input.existingMembers)
    members = { desired: input.membersDesired.length, steps: plan.steps.length, toCreate: plan.toCreate.length }
  }

  // Dangling grants: a granted capability or extension nothing installed declares
  // (an extension was uninstalled, or a typo in a declared grant). A warning.
  if (input.memberGrants?.length) {
    const installedExtensionIds = input.activation ? Object.keys(input.activation) : []
    for (const d of findDanglingGrants(input.memberGrants, { coreCapabilities: ALL_CAPABILITIES as unknown as string[], installedExtensionIds })) {
      const refs = [...d.unknownCapabilities, ...d.unknownExtensions.map((e) => `extension "${e}"`)]
      findings.push({ severity: 'warning', code: 'DANGLING_GRANT', message: `member ${d.memberId} is granted ${refs.join(', ')}, which nothing installed here declares`, workspace: input.workspaceId })
    }
  }

  // Coarse capabilities: an extension with a write/manage/delete verb but no
  // read on the same resource can't be granted read-only. An INFO nudge.
  for (const ext of input.extensionCapabilities ?? []) {
    const coarse = findCoarseCapabilities(ext.capabilities)
    if (coarse.length) findings.push({ severity: 'info', code: 'COARSE_CAPABILITY', message: `extension "${ext.extensionId}" exposes ${coarse.map((s) => `${s} (write, no read)`).join(', ')} - declare read:<resource> so a role can be read-only`, workspace: input.workspaceId })
  }
  // Connections (Extension Kernel K6.3): a row sealed under another key is
  // intact but unusable here - an ERROR with the way out; a production
  // deployment holding connections under a key derived from the session
  // secret is a WARNING, because rotating that secret silently locks them.
  // F3: what an integration's state is, in the order an operator should act.
  for (const f of input.connectionFindings ?? []) {
    findings.push({ severity: f.severity, code: f.code, message: f.message, ...(f.workspace ? { workspace: f.workspace } : {}) })
  }
  if (input.connections) {
    for (const u of input.connections.unreadable) {
      findings.push({ severity: 'error', code: 'CONNECTION_UNREADABLE', message: `connection "${u.label}" (${u.id}) cannot be opened under this deployment's connections key - set TANGEN_CONNECTIONS_KEY_PREVIOUS to the key it was sealed under and run tangen connections rotate-key, or reconnect it in Settings → Connections`, workspace: u.workspaceId })
    }
    if (input.connections.keySource === 'derived' && input.connections.total > 0 && input.role === 'production') {
      findings.push({ severity: 'warning', code: 'CONNECTIONS_KEY_DERIVED', message: `${input.connections.total} connection(s) are sealed under a key derived from the session secret: set TANGEN_CONNECTIONS_KEY (connections.encryptionKey) so rotating JWT_SECRET does not lock them, then run tangen connections rotate-key`, workspace: input.workspaceId })
    }
  }

  const seen = new Set<string>()
  const dedup = findings.filter((f) => { const k = `${f.code}|${f.message}`; if (seen.has(k)) return false; seen.add(k); return true })
  const adapter = (selected.get<string | null>('storage.adapter') ?? 'local') || 'local'
  return {
    version: 2,
    role: input.role,
    database: { identity: input.identity.staticIdentity || null, source: input.databaseSource },
    urls: { server: selected.get<string>('server.url') ?? null, admin: selected.get<string>('admin.url') ?? null, frontend: selected.get<string>('frontend.url') ?? null, preview: selected.get<string>('frontend.previewUrl') ?? null },
    redis: selected.get<boolean>('redis.enabled') === false ? 'disabled' : (selected.values['redis.url'] as { resolved?: boolean } | undefined)?.resolved ? 'enabled' : 'unset',
    storage: { adapter, mediaDir: selected.get<string>('storage.mediaDir') ?? null },
    replicas: input.replicas,
    findings: dedup,
    keys: selected.diagnostics(),
    extensions,
    integrations,
    members,
    connections: input.connections ? { total: input.connections.total, unreadable: input.connections.unreadable.length, keySource: input.connections.keySource } : undefined,
    liveIdentity: input.identity,
    exitCode: dedup.some((f) => f.severity === 'error') ? 1 : 0,
  }
}

/** The text a terminal gets. Secret references and yes/no only. */
export function renderDeploymentReport(r: DeploymentReport): string[] {
  const lines: string[] = []
  const mark = (s: DeploymentFinding['severity']) => s === 'error' ? c.red('ERROR  ') : s === 'warning' ? c.yellow('WARN   ') : c.dim('INFO   ')
  lines.push('', `  ${c.bold('Deployment')}  role: ${r.role}  replicas: ${r.replicas}`)
  lines.push(`  database    ${r.database.identity ?? c.red('unresolved')}  ${c.dim(`(${r.database.source})`)}`)
  lines.push(`  live        ${r.liveIdentity.live ? c.dim(r.liveIdentity.live) : c.yellow(`unreachable${r.liveIdentity.error ? ` (${r.liveIdentity.error})` : ''}`)}`)
  lines.push(`  urls        api: ${r.urls.server ?? '-'}  admin: ${r.urls.admin ?? '-'}  frontend: ${r.urls.frontend ?? '-'}`)
  lines.push(`  redis       ${r.redis}`)
  lines.push(`  storage     ${r.storage.adapter}${r.storage.mediaDir ? `  ${c.dim(r.storage.mediaDir)}` : ''}`)
  if (r.extensions.length) {
    lines.push('', `  ${c.bold('Extensions')}`)
    for (const e of r.extensions) lines.push(`  ${e.id.padEnd(24)} ${e.state === 'active' ? c.green('active') : c.dim(e.state)}${e.reason ? c.dim(`  ${e.reason}`) : ''}`)
  }
  if (r.integrations.length) {
    lines.push('', `  ${c.bold('Integrations')}`)
    for (const i of r.integrations) lines.push(`  ${i.name.padEnd(12)} ${i.ready ? c.green('ready') : c.yellow('not ready')}  ${i.credentials.map((cr) => `${cr.key.split('.').pop()} → ${cr.secretRef} ${cr.resolved ? c.green('resolved') : c.yellow('unresolved')}`).join(', ')}`)
  }
  if (r.members) lines.push('', `  ${c.bold('Members')}     desired: ${r.members.desired}  pending steps: ${r.members.steps}${r.members.toCreate ? `  (${r.members.toCreate} to create without a credential)` : ''}`)
  if (r.connections) lines.push('', `  ${c.bold('Connections')} ${r.connections.total}  key: ${r.connections.keySource}${r.connections.unreadable ? `  ${c.red(`${r.connections.unreadable} unreadable`)}` : ''}`)
  lines.push('', `  ${c.bold('Configuration')}  ${r.keys.length} keys`)
  for (const k of r.keys) {
    const where = `${k.state}${k.source ? ` · ${k.source}` : ''}`
    const what = k.secret ? `→ ${k.secret.secretRef} ${k.secret.resolved ? c.green('resolved') : c.yellow('unresolved')}` : k.value !== undefined ? c.dim(JSON.stringify(k.value)) : ''
    lines.push(`  ${k.key.padEnd(34)} ${where.padEnd(34)} ${what}`)
  }
  lines.push('', `  ${c.bold('Findings')}`)
  if (r.findings.length === 0) lines.push(`  ${sym.tick}  none`)
  for (const f of r.findings) lines.push(`  ${mark(f.severity)} ${f.message}`)
  lines.push('', r.exitCode === 0 ? `  ${sym.tick}  deployment is consistent` : `  ${sym.cross}  ${c.red('deployment has errors - boot would refuse')}`, '')
  return lines
}

/** `SELECT` the server's own identity of the database a URL reaches: the cluster and the database oid. */
export const LIVE_IDENTITY_SQL = `SELECT (SELECT oid FROM pg_database WHERE datname = current_database())::text AS oid, pg_postmaster_start_time()::text AS started, current_database() AS db`

export async function readLiveIdentity(url: string, connect: (url: string) => Promise<{ query: (sql: string) => Promise<Array<Record<string, unknown>>>; end: () => Promise<void> }>): Promise<{ live: string | null; error?: string }> {
  let conn: Awaited<ReturnType<typeof connect>> | null = null
  try {
    conn = await connect(url)
    const rows = await conn.query(LIVE_IDENTITY_SQL)
    const r = rows[0] ?? {}
    // A cluster is identified by when it started (one instant per cluster), a database by its oid within it.
    return { live: `cluster@${String(r.started)}/db#${String(r.oid)}` }
  } catch (e) {
    return { live: null, error: e instanceof Error ? e.message.split('\n')[0] : String(e) }
  } finally {
    await conn?.end().catch(() => {})
  }
}

export interface DoctorDeploymentOptions { json?: boolean; replicas?: number }

/** Loads, connects, gathers, builds, prints. Sets process.exitCode. */
export async function runDoctorDeploymentCommand(cwd: string, opts: DoctorDeploymentOptions = {}): Promise<DeploymentReport | null> {
  const fail = (message: string): null => {
    if (opts.json) console.log(JSON.stringify({ version: 2, ok: false, exitCode: 2, error: message }, null, 2))
    else console.error(`  ${sym.cross}  ${c.red(message)}`)
    process.exitCode = 2
    return null
  }
  let config: TangenConfig & Record<string, unknown>
  try {
    const { resolveEffectiveConfig } = await import('./push-config')
    const mod = await import(`${resolve(cwd, 'tangen.config.ts')}?t=${Date.now()}`)
    config = await resolveEffectiveConfig(cwd, mod.default as TangenConfig) as TangenConfig & Record<string, unknown>
  } catch (e) {
    return fail(`Could not load tangen.config.ts from ${cwd}: ${e instanceof Error ? e.message : String(e)}`)
  }
  let database: DeploymentDatabase
  try { database = resolveDeploymentDatabase() } catch (e) { return fail(describeDatabaseError(e)) }
  const role = deploymentRole()
  const workspaceId = (config.workspaceId as string | undefined) ?? 'wsp_local_dev'

  const { createDb } = await import('@tangen/db')
  const db: any = createDb(database.url)
  const raw = (text: string, params: unknown[] = []) => (db.$rawClient ?? db.session?.client).unsafe(text, params as never) as Promise<Array<Record<string, unknown>>>
  try { await raw('SELECT 1') } catch (e) { return fail(`Could not connect to the database: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`) }

  const { loadConfigExtensions } = await import('./extension-install')
  const { configuredExtensions } = await import('@tangen/types')
  const available = await loadConfigExtensions(config as never, cwd)
  const manifestOf = (id: string) => available.find((m) => m.id === id)
  const declared = (configuredExtensions(config as never).entries as Array<{ resolve?: string; options?: Record<string, unknown> }>)
  const { scopeActivation } = await import('./extension-lifecycle')
  const { listInstalls, installExecFromDb } = await import('@tangen/db')
  const exec = installExecFromDb(db)

  let installedOptions: Record<string, Record<string, unknown>> = {}
  let activeExtensions: string[] = []
  let activation: ActivationMap | null = null
  try {
    for (const row of await listInstalls(exec, { workspaceId })) installedOptions[String(row.extensionId)] = (row.options ?? {}) as Record<string, unknown>
    const a = await scopeActivation({ db, workspaceId, available: available as never, role })
    activation = a.activation
    activeExtensions = Object.entries(a.activation).filter(([, r]) => r.active).map(([id]) => id)
  } catch { activation = null }
  const deployment = resolveProjectDeployment({
    project: { workspaceId, config: config as never, siteConfig: config.siteConfig, integrations: config.integrations as never, declaredExtensions: declared },
    role, manifestOf: manifestOf as never, installedOptions, activeExtensions,
  })
  const replicas = opts.replicas ?? Number(process.env.TANGEN_REPLICAS ?? 1)
  const findings = validateProjectDeployment({ project: { workspaceId, slug: String(config.project ?? workspaceId) }, deployment, replicas })

  // Live identity of the database (Stage 4 B): what the server says it is.
  const connect = async (url: string) => {
    const client = createDb(url) as any
    const rc = client.$rawClient ?? client.session?.client
    return { query: (q: string) => rc.unsafe(q) as Promise<Array<Record<string, unknown>>>, end: async () => { await rc.end?.().catch(() => {}) } }
  }
  const live = await readLiveIdentity(database.url, connect)
  const identity: LiveDatabaseIdentity = { staticIdentity: databaseIdentity(database.url) ?? '?', live: live.live, ...(live.error ? { error: live.error } : {}) }

  let existingMembers: DeploymentReportInput['existingMembers']
  const membersDesired = config.membersDesired as MembersDesiredState | undefined
  if (membersDesired?.length) {
    try {
      const rows = await raw(`SELECT id, email, role FROM members WHERE workspace_id = $1`, [workspaceId])
      existingMembers = rows.map((m) => ({ id: String(m.id), email: String(m.email), role: String(m.role) }))
    } catch { existingMembers = undefined }
  }

  // Per-member grants (best-effort): checked for dangling capability/extension refs.
  let memberGrants: DeploymentReportInput['memberGrants']
  try {
    const rows = await raw(`SELECT member_id, capabilities, extensions FROM member_grants WHERE workspace_id = $1`, [workspaceId])
    const asArr = (v: unknown) => Array.isArray(v) ? v.map(String) : (typeof v === 'string' ? (JSON.parse(v) as unknown[]).map(String) : [])
    memberGrants = rows.map((g) => ({ memberId: String(g.member_id), capabilities: asArr(g.capabilities), extensions: asArr(g.extensions) }))
  } catch { memberGrants = undefined }

  // Each active extension's capabilities (compiled from permissions.resources +
  // raw), for the read/write-split nudge.
  const extensionCapabilities = activeExtensions
    .map((id) => { const m = manifestOf(id); return { extensionId: id, capabilities: compileExtensionPermissions(m?.permissions, (m?.capabilities ?? []) as never) } })
    .filter((e) => e.capabilities.length)

  // Connections (Extension Kernel K6.3): every row under the key boot would
  // use; a row the key cannot open is a finding, a key derived from the
  // session secret on production is one too. Never prints material.
  let connections: DeploymentReportInput['connections']
  try {
    const { resolveConnectionsKeyMaterial, readDevSecretFile } = await import('./connections')
    const { deriveConnectionsKey, unreadableConnections } = await import('@tangen/db')
    const material = resolveConnectionsKeyMaterial({ deploymentSecret: deployment.secrets.get('connections.encryptionKey'), env: process.env, devSecretFile: () => readDevSecretFile(cwd) })
    const total = Number((await raw(`SELECT count(*)::int AS n FROM connections`))[0]?.n ?? 0)
    if (material) {
      const unreadable = total ? await unreadableConnections(raw, deriveConnectionsKey(material.material)) : []
      connections = { total, keySource: material.source, unreadable: unreadable.map((u) => ({ id: u.id, label: u.label, workspaceId: u.workspaceId })) }
    }
  } catch { connections = undefined }

  // F3: the integration findings, from the rows and the installed manifests.
  let integrationFindings: DoctorConnectionFinding[] = []
  try {
    const rows = await raw(`SELECT id, label, workspace_id, connector_id, status, meta, health FROM connections`) as Array<Record<string, unknown>>
    const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) as Record<string, unknown> : (v as Record<string, unknown> | null))
    const installRows = await raw(`SELECT app_id, state, enabled, granted_grants FROM workspace_installed_apps WHERE workspace_id = '${workspaceId.replace(/'/g, "''")}'`) as Array<Record<string, unknown>>
    integrationFindings = connectionFindings({
      rows: rows.map((r) => ({
        id: String(r.id), label: String(r.label), workspaceId: String(r.workspace_id),
        connectorId: String(r.connector_id), status: String(r.status) as 'active',
        meta: json(r.meta), health: json(r.health) as never,
      })),
      extensions: installRows.map((r) => {
        const id = String(r.app_id)
        const m = manifestOf(id) as { name?: string; kind?: 'extension' | 'connector-pack'; connectors?: Array<{ id: string; provider: string; supersedes?: string[] }> } | undefined
        const granted = json(r.granted_grants) as unknown
        return {
          extensionId: id,
          ...(m?.name ? { name: m.name } : {}),
          installed: String(r.state) === 'installed',
          enabled: r.enabled === true,
          ...(m?.kind ? { kind: m.kind } : {}),
          ...(m?.connectors ? { connectors: m.connectors } : {}),
          // What this installation RECORDED it was granted. A row with none
          // has not been reviewed, and claiming the manifest's wishes as
          // grants would report a requirement nobody approved.
          grants: Array.isArray(granted) ? (granted as string[]) : [],
        }
      }),
    })
  } catch { integrationFindings = [] }

  const report = buildDeploymentReport({ role, workspaceId, config, deployment, findings, activation, identity, membersDesired, existingMembers, memberGrants, extensionCapabilities, replicas, databaseSource: database.source, connections, connectionFindings: integrationFindings })
  if (opts.json) console.log(JSON.stringify(report, null, 2))
  else for (const line of renderDeploymentReport(report)) console.log(line)
  process.exitCode = report.exitCode
  try { await (db.$rawClient ?? db.session?.client).end?.() } catch { /* closing */ }
  return report
}
