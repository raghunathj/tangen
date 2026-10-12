/**
 * File Name: doctor-connections.ts
 * Purpose: What Doctor says about an integration (plan-connectors F3). Every
 *          way a connection can be unusable, judged from what the DATABASE
 *          holds and what the installed manifests DECLARE - no runtime, no
 *          provider call, and never a credential.
 *
 *          Pure and separate from the command so each rule can be stated as a
 *          fact: a provider two packs claim, a row nothing offers any more, a
 *          pack switched off (which is usually WHY a row is dormant), a
 *          capability a consumer needs and the connection never got, and a
 *          health check that failed. The order is the order an operator should
 *          act in, which is also what makes one of them an error and the rest
 *          warnings: a conflict blocks every connection of its provider, the
 *          others block one thing each.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** One connection row, as the database holds it. No material, ever. */
export interface DoctorConnectionRow {
  id: string
  label: string
  workspaceId: string
  /** `ext:<extension>/<connector>`. */
  connectorId: string
  status: 'active' | 'pending' | 'revoked' | 'unreadable'
  /** `{ scope?, capabilities? }` - what it was authorized for, never a token. */
  meta?: Record<string, unknown> | null
  health?: { ok: boolean; checkedAt?: string; message?: string } | null
}

/** One installed extension, as its manifest and install row describe it. */
export interface DoctorExtension {
  extensionId: string
  name?: string
  installed: boolean
  enabled: boolean
  kind?: 'extension' | 'connector-pack'
  /** What it offers: the declared connectors. */
  connectors?: Array<{ id: string; provider: string; supersedes?: string[] }>
  /** Its effective grants, which is where a required capability comes from. */
  grants?: string[]
}

export interface DoctorConnectionFinding {
  severity: 'error' | 'warning'
  code:
    | 'CONNECTION_PROVIDER_CONFLICT'
    | 'CONNECTION_DORMANT'
    | 'CONNECTOR_PACK_DISABLED'
    | 'CONNECTION_NEEDS_CAPABILITY'
    | 'CONNECTION_HEALTH_FAILED'
    | 'CONNECTION_PENDING'
  message: string
  workspace?: string
}

const bare = (storedId: string): string => /^ext:[^/]+\/(.+)$/.exec(storedId)?.[1] ?? storedId
const providerOfStored = (storedId: string): string => bare(storedId).split('.')[0] ?? bare(storedId)

/** Every provider an extension offers, whether or not it is switched on. */
const providersOf = (e: DoctorExtension): string[] =>
  [...new Set((e.connectors ?? []).map((c) => c.provider))]

/** Does an extension's declaration own or ADOPT this row (F2)? */
function offers(e: DoctorExtension, row: DoctorConnectionRow): boolean {
  const id = bare(row.connectorId)
  return (e.connectors ?? []).some((c) =>
    c.id === id || (c.supersedes ?? []).some((s) => s === id || s === row.connectorId))
}

/**
 * The capabilities a provider's connections must cover here: the
 * capability-specific grants of OTHER active extensions
 * (`connections:google.sheets.append`). A provider-wide grant is permission,
 * not a requirement - it says "may use any capability of this provider" - so
 * it is deliberately not counted, exactly as the consent checklist does it.
 */
export function requiredCapabilities(extensions: readonly DoctorExtension[], provider: string, owner?: string): string[] {
  const prefix = `connections:${provider}.`
  const out = new Set<string>()
  for (const e of extensions) {
    if (!e.enabled || !e.installed || e.extensionId === owner) continue
    for (const g of e.grants ?? []) if (g.startsWith(prefix)) out.add(g.slice(prefix.length))
  }
  return [...out].sort()
}

/**
 * What Doctor reports about this deployment's integrations.
 *
 * Nothing here needs the extension runtime, so it answers on a machine that
 * only has the database and the project - which is the whole point of a
 * deployment check.
 */
export function connectionFindings(input: {
  rows: readonly DoctorConnectionRow[]
  extensions: readonly DoctorExtension[]
}): DoctorConnectionFinding[] {
  const findings: DoctorConnectionFinding[] = []
  const installed = input.extensions.filter((e) => e.installed)
  const active = installed.filter((e) => e.enabled)

  // 1. A provider two ACTIVE packs claim. The most actionable thing on the
  // list, and the only error: until one is disabled, no connection of that
  // provider can be used and none can be added.
  const claimants = new Map<string, string[]>()
  for (const e of active) for (const p of providersOf(e)) claimants.set(p, [...(claimants.get(p) ?? []), e.extensionId])
  for (const [provider, ids] of [...claimants].sort(([a], [b]) => a.localeCompare(b))) {
    if (ids.length < 2) continue
    findings.push({
      severity: 'error',
      code: 'CONNECTION_PROVIDER_CONFLICT',
      message: `${ids.sort().join(' and ')} both offer '${provider}', so none of its connections can be used and no new one can be added - disable one of them`,
    })
  }

  // 2. A pack installed and switched OFF. Usually the reason a row below is
  // dormant, so it is said once here rather than repeated per row.
  for (const e of installed.filter((x) => !x.enabled && x.kind === 'connector-pack')) {
    const rows = input.rows.filter((r) => offers(e, r)).length
    findings.push({
      severity: 'warning',
      code: 'CONNECTOR_PACK_DISABLED',
      message: `connector pack '${e.extensionId}' is installed but switched off${rows ? `, so ${rows} connection(s) of ${providersOf(e).join(', ') || 'its provider'} cannot be used` : ''} - enable it and they work again with no re-consent`,
    })
  }

  for (const row of [...input.rows].sort((a, b) => a.id.localeCompare(b.id))) {
    const provider = providerOfStored(row.connectorId)
    const owner = active.find((e) => offers(e, row))
    const conflicted = (claimants.get(provider) ?? []).length > 1

    // 3. Nothing active offers it. The credentials are kept, so this is a
    // warning with the pack to enable rather than a loss.
    if (!owner && !conflicted) {
      const pack = /^ext:([^/]+)\//.exec(row.connectorId)?.[1]
      findings.push({
        severity: 'warning',
        code: 'CONNECTION_DORMANT',
        message: `connection "${row.label}" (${row.id}) is dormant: nothing active offers '${bare(row.connectorId)}'${pack ? ` - install or enable '${pack}'` : ''}. Its credentials are kept`,
        workspace: row.workspaceId,
      })
      continue
    }

    // 4. Half-made: an authorization that was started and never finished.
    if (row.status === 'pending') {
      findings.push({
        severity: 'warning',
        code: 'CONNECTION_PENDING',
        message: `connection "${row.label}" (${row.id}) never finished authorizing - connect it again in Settings > Connections, or remove it`,
        workspace: row.workspaceId,
      })
      continue
    }
    if (row.status !== 'active') continue

    // 5. A capability a consumer needs and this connection never got. Read
    // from what the row RECORDS it was authorized for; a row from before
    // capability records says nothing, so nothing is claimed about it.
    const recorded = Array.isArray(row.meta?.capabilities)
      ? (row.meta!.capabilities as unknown[]).filter((c): c is string => typeof c === 'string')
      : null
    const required = requiredCapabilities(input.extensions, provider, owner?.extensionId)
    if (recorded && required.length > 0) {
      const missing = required.filter((c) => !recorded.includes(c))
      if (missing.length > 0) {
        findings.push({
          severity: 'warning',
          code: 'CONNECTION_NEEDS_CAPABILITY',
          message: `connection "${row.label}" (${row.id}) is not authorized for ${missing.map((m) => `'${provider}.${m}'`).join(', ')}, which an active extension requires - reconnect it and include ${missing.length === 1 ? 'that capability' : 'those capabilities'}`,
          workspace: row.workspaceId,
        })
      }
    }

    // 6. The last check failed. The provider's own words where there are any.
    if (row.health && row.health.ok === false) {
      findings.push({
        severity: 'warning',
        code: 'CONNECTION_HEALTH_FAILED',
        message: `connection "${row.label}" (${row.id}) failed its last health check${row.health.message ? `: ${row.health.message}` : ''}${row.health.checkedAt ? ` (${row.health.checkedAt})` : ''}`,
        workspace: row.workspaceId,
      })
    }
  }

  return findings
}
