/**
 * File Name: stats.ts
 * Purpose: Admin dashboard route that aggregates stats across content, webhooks, media, API keys,
 *          members, and site users into a configurable, ordered list of widgets with Redis caching.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, Drizzle ORM, ioredis, @tangen/db (multiple tables), @tangen/types,
 *                     dashboard-cache service for per-widget TTL-based Redis caching
 */
import { Elysia } from 'elysia'
import { eq, and, count, sum, isNull, isNotNull, gte, lte, desc } from 'drizzle-orm'
import {
  workspaceActivity,
  webhooks,
  webhookDeliveries,
  mediaAssets,
  apiKeys,
  members,
  
} from '@tangen/db'
import { contentTables } from '@tangen/db/content-tables'
import type { DbClient } from '@tangen/db'
import type { Redis } from 'ioredis'
import type { SchemaDefinition, DashboardConfig, DashboardWidget, WorkspaceProject, Capability, AdminAccessRule } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { requireCapability, hasCapability } from '../../lib/member-access'
import { DASHBOARD_CACHE_KEY, DASHBOARD_CACHE_TTL, withDashboardCache } from '../../services/dashboard-cache'
import { extensionWiringDeps } from '../../services/extension-server'

// ─── Pure stat helpers (exported for testing) ─────────────────────────────────

export interface ApiKeyStats {
  active: number
  expiringIn7Days: number
  expired: number
  revoked: number
}

/**
 * Classifies a list of API key rows into active, expiring-soon, expired, and revoked buckets.
 * @param rows - Minimal API key rows containing id, revokedAt, and expiresAt
 * @returns An ApiKeyStats object with counts for each lifecycle state
 */
export function computeApiKeyStats(
  rows: Array<{ id: string; revokedAt: Date | null; expiresAt: Date | null }>,
): ApiKeyStats {
  const now = new Date()
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  let active = 0, expiringIn7Days = 0, expired = 0, revoked = 0

  for (const row of rows) {
    if (row.revokedAt) { revoked++; continue }
    if (row.expiresAt && row.expiresAt < now) { expired++; continue }
    active++
    if (row.expiresAt && row.expiresAt <= in7Days) expiringIn7Days++
  }

  return { active, expiringIn7Days, expired, revoked }
}

export interface MemberStats {
  total: number
  adminsAndOwners: number
  activeInLast7Days: number
}

/**
 * Computes member statistics including admin/owner count and recent login activity.
 * @param rows - Member rows with id, role, and lastLoginAt
 * @returns A MemberStats object with total, elevated-role count, and 7-day active count
 */
export function computeMemberStats(
  rows: Array<{ id: string; role: string; lastLoginAt: Date | null }>,
): MemberStats {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  return {
    total: rows.length,
    adminsAndOwners: rows.filter(r => r.role === 'admin' || r.role === 'owner').length,
    activeInLast7Days: rows.filter(r => r.lastLoginAt != null && r.lastLoginAt >= sevenDaysAgo).length,
  }
}

export interface QuickAction {
  label: string
  href: string
  icon?: string
  external?: boolean
}

/**
 * Builds the quick-actions list by combining auto-generated content-type links with operator-configured actions.
 * @param schema - The resolved workspace schema containing content type definitions
 * @param configured - Optional additional quick actions defined in the dashboard config
 * @returns An ordered array of QuickAction entries ready for the frontend widget
 */
export function buildQuickActions(
  schema: SchemaDefinition,
  configured: QuickAction[] = [],
): QuickAction[] {
  const actions: QuickAction[] = []

  for (const t of schema.types) {
    if (t.singleton) continue
    actions.push({ label: `New ${t.label}`, href: `/objects/${t.name}/new`, icon: 'RiAddLine' })
  }

  actions.push({ label: 'Upload Media', href: '/media', icon: 'RiImageAddLine' })
  actions.push({ label: 'API Keys', href: '/api-keys', icon: 'RiKeyLine' })

  for (const a of configured) {
    actions.push({ label: a.label, href: a.href, icon: a.icon, external: a.external })
  }

  return actions
}

// ─── Widget override + filtering (exported for testing) ──────────────────────

/**
 * Applies operator-defined widget overrides (hidden, renamed, reordered) to the built-in widget list.
 * @param widgets - The full list of assembled built-in widgets
 * @param overrides - Dashboard config overrides that may hide or mutate individual widgets
 * @returns A filtered and merged widget list with overrides applied
 */
export function applyWidgetOverrides(
  widgets: Record<string, unknown>[],
  overrides: DashboardWidget[],
): Record<string, unknown>[] {
  const overrideMap = new Map<string, DashboardWidget>()
  for (const o of overrides) {
    overrideMap.set(o.id, o)
  }

  const result: Record<string, unknown>[] = []
  for (const w of widgets) {
    const override = overrideMap.get(w.id as string)
    if (!override) { result.push(w); continue }

    // For built-in overrides: check hidden first
    if ((override as any).type === 'builtin' && (override as any).hidden === true) continue

    // Merge override properties (skip undefined)
    const merged: Record<string, unknown> = { ...w }
    for (const [k, v] of Object.entries(override)) {
      if (k === 'type' || k === 'id') continue
      if (v !== undefined) merged[k] = v
    }
    result.push(merged)
  }
  return result
}

// ─── Widget view gating (exported for testing) ───────────────────────────────

/** The actor facts a widget access rule is evaluated against - the same three
 *  inputs the Admin's `checkAdminAccess` uses, so server and client agree. */
export interface WidgetViewer {
  /** The member's effective role slug (built-in name or custom slug). */
  role: string | null | undefined
  /** Owner/admin (a full-access bundle) - always passes any rule. */
  isAdmin: boolean
  /** Whether the member holds a capability - injected so this stays pure. */
  hasCapability: (capability: string) => boolean
}

/**
 * Whether `viewer` may see a widget guarded by an access `rule` (`{ roles?,
 * capability? }`) - the SAME shape and semantics as a page's `access`: an empty
 * or absent rule means everyone; owner/admin always pass; a listed role passes;
 * a held capability passes. A member who fails still sees the widget as a
 * locked "No rights to view" placeholder rather than not at all.
 */
export function canViewWidget(viewer: WidgetViewer, rule: AdminAccessRule | undefined): boolean {
  if (!rule || (!rule.roles?.length && !rule.capability)) return true
  if (viewer.isAdmin) return true
  if (rule.roles && viewer.role && rule.roles.includes(viewer.role as never)) return true
  if (rule.capability && viewer.hasCapability(rule.capability)) return true
  return false
}

/**
 * Capability each built-in widget requires to appear at all. A member lacking
 * it simply does not get the widget - these deep-link to areas the same
 * capability protects, so a locked placeholder would only be a dead door.
 */
export const BUILTIN_WIDGET_CAPABILITY: Record<string, Capability> = {
  'webhook-health': 'manage:webhooks',
  'api-keys': 'manage:apiKeys',
  'members': 'manage:members',
}

// ─── Data fetchers ────────────────────────────────────────────────────────────

async function fetchContentOverview(db: DbClient, schema: SchemaDefinition, workspaceId: string) {
  const tables = contentTables as Record<string, any>
  const typeSummaries: Array<{ name: string; label: string; counts: Record<string, number>; total: number }> = []

  await Promise.all(
    schema.types.map(async (t) => {
      const table = tables[t.name]
      if (!table) return
      const rows = await db
        .select({ status: table.status, count: count() })
        .from(table)
        .where(and(eq(table.workspaceId, workspaceId)))
        .groupBy(table.status)
      const counts: Record<string, number> = {}
      let total = 0
      for (const r of rows) {
        counts[r.status] = Number(r.count)
        total += Number(r.count)
      }
      typeSummaries.push({ name: t.name, label: t.label, counts, total })
    })
  )

  const totals = { total: 0, published: 0, draft: 0, scheduled: 0, archived: 0 }
  for (const ts of typeSummaries) {
    totals.total += ts.total
    for (const [status, n] of Object.entries(ts.counts)) {
      if (status in totals) (totals as any)[status] += n
    }
  }

  return { types: typeSummaries, totals }
}

async function fetchRecentActivity(db: DbClient, workspaceId: string) {
  const rows = await db
    .select()
    .from(workspaceActivity)
    .where(and(
      eq(workspaceActivity.workspaceId, workspaceId),
      ))
    .orderBy(desc(workspaceActivity.createdAt))
    .limit(10)
  return rows
}

async function fetchWebhookHealth(db: DbClient, workspaceId: string) {
  const allHooks = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.workspaceId, workspaceId)))

  const total = allHooks.length
  const healthy = allHooks.filter(w => !w.pausedReason && w.consecutiveFailures === 0).length
  const paused = allHooks.filter(w => !!w.pausedReason).length

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [failRow] = await db
    .select({ count: count() })
    .from(webhookDeliveries)
    .where(and(
      eq(webhookDeliveries.workspaceId, workspaceId),
      eq(webhookDeliveries.success, false),
      gte(webhookDeliveries.createdAt, since24h),
    ))

  return { total, healthy, paused, failuresIn24h: Number(failRow?.count ?? 0) }
}

async function fetchMediaSnapshot(db: DbClient, workspaceId: string) {
  const [totals] = await db
    .select({ total: count(), totalSize: sum(mediaAssets.sizeBytes) })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.workspaceId, workspaceId)))

  const [missingAltRow] = await db
    .select({ count: count() })
    .from(mediaAssets)
    .where(and(
      eq(mediaAssets.workspaceId, workspaceId),
      isNull(mediaAssets.altText),
    ))

  const since7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const [recentRow] = await db
    .select({ count: count() })
    .from(mediaAssets)
    .where(and(
      eq(mediaAssets.workspaceId, workspaceId),
      gte(mediaAssets.createdAt, since7Days),
    ))

  return {
    total: Number(totals?.total ?? 0),
    totalSizeBytes: Number(totals?.totalSize ?? 0),
    missingAltText: Number(missingAltRow?.count ?? 0),
    uploadedLast7Days: Number(recentRow?.count ?? 0),
  }
}

async function fetchApiKeyStats(db: DbClient, workspaceId: string) {
  const rows = await db
    .select({ id: apiKeys.id, revokedAt: apiKeys.revokedAt, expiresAt: apiKeys.expiresAt })
    .from(apiKeys)
    .where(and(eq(apiKeys.workspaceId, workspaceId)))
  return computeApiKeyStats(rows)
}

async function fetchMemberStats(db: DbClient, workspaceId: string) {
  const rows = await db
    .select({ id: members.id, role: members.role, lastLoginAt: members.lastLoginAt })
    .from(members)
    .where(eq(members.workspaceId, workspaceId))
  return computeMemberStats(rows)
}

// ─── Widget assembly ──────────────────────────────────────────────────────────

const DEFAULT_ORDER = [
  'quick-actions',
  'content-overview',
  'recent-activity',
  'webhook-health',
  'media-snapshot',
  'api-keys',
  'members',
]

function sortWidgets(
  widgets: Record<string, unknown>[],
  order: string[] | undefined,
): Record<string, unknown>[] {
  const orderList = order ?? DEFAULT_ORDER
  const orderMap = new Map(orderList.map((id, i) => [id, i]))
  return [...widgets].sort((a, b) => {
    const ai = orderMap.get(a.id as string) ?? orderList.length
    const bi = orderMap.get(b.id as string) ?? orderList.length
    return ai - bi
  })
}

// ─── Route ───────────────────────────────────────────────────────────────────

/**
 * Elysia plugin factory that registers GET /api/v1/admin/dashboard; fetches and assembles all widgets with caching.
 * @param projects - All workspace project configs used to detect enabled features and custom widgets
 * @returns An Elysia plugin function that mounts the dashboard route
 */
export const dashboardRoute = (projects: WorkspaceProject[]) => (app: Elysia) =>
  app.get('/api/v1/admin/dashboard', async (ctx: any) => {
    const { db, redis, schema, workspaceId, permissions } = ctx
    const memberRole = (ctx as { memberRole?: string | null }).memberRole
    const memberId = (ctx as { memberId?: string | null }).memberId
    // One viewer, evaluated against widget access rules with the same semantics
    // the Admin uses for page `access` (checkAdminAccess).
    const viewer: WidgetViewer = {
      role: memberRole,
      isAdmin: !!permissions?.admin,
      hasCapability: (cap) => hasCapability({ permissions, memberId } as never, cap as never),
    }

    // Any workspace member sees the dashboard - it is the home screen, not an
    // admin-only report. Per-widget gating below hides privileged built-ins
    // (members/API keys/webhooks) from members who lack the capability, and
    // renders `viewPermission`-restricted extension widgets as locked cards.
    // Admin API keys (the playground) carry `permissions.admin` without a
    // member id, so they still pass.
    if (!memberId && !permissions?.admin) {
      throw new RequestError('FORBIDDEN', 'Sign in to view the dashboard', 403)
    }
    if (!workspaceId) {
      throw new RequestError('VALIDATION_ERROR', 'workspaceId is required', 400)
    }

    const project = projects.find((p: WorkspaceProject) => p.workspaceId === workspaceId)
    const dashConfig: DashboardConfig = (project?.config?.dashboard) ?? {}
    const activityConfig = dashConfig.activity ?? {}

    // Resolve retention days (max 90)
    const retentionDays = Math.min(activityConfig.retentionDays ?? 7, 90)

    // Fetch all built-in widget data in parallel with per-widget Redis cache
    const cacheKey = (id: string) => DASHBOARD_CACHE_KEY(id, workspaceId)
    const ttl = DASHBOARD_CACHE_TTL

    const [
      contentOverview,
      recentActivity,
      webhookHealth,
      mediaSnapshot,
      apiKeyStats,
      memberStats,
    ] = await Promise.all([
      withDashboardCache(redis, cacheKey('content-overview'), ttl['content-overview'], () =>
        fetchContentOverview(db, schema, workspaceId)),
      withDashboardCache(redis, cacheKey('recent-activity'), ttl['recent-activity'], () =>
        fetchRecentActivity(db, workspaceId)),
      withDashboardCache(redis, cacheKey('webhook-health'), ttl['webhook-health'], () =>
        fetchWebhookHealth(db, workspaceId)),
      withDashboardCache(redis, cacheKey('media-snapshot'), ttl['media-snapshot'], () =>
        fetchMediaSnapshot(db, workspaceId)),
      withDashboardCache(redis, cacheKey('api-keys'), ttl['api-keys'], () =>
        fetchApiKeyStats(db, workspaceId)),
      withDashboardCache(redis, cacheKey('members'), ttl['members'], () =>
        fetchMemberStats(db, workspaceId)),
    ])

    // ── Build widget list ─────────────────────────────────────────────────────
    const widgets: Record<string, unknown>[] = [
      {
        id: 'quick-actions',
        type: 'links',
        title: 'Quick Actions',
        icon: 'IconSparkles',
        actions: buildQuickActions(schema, dashConfig.quickActions),
      },
      {
        id: 'content-overview',
        type: 'content-overview',
        title: 'Content Overview',
        icon: 'IconFileText',
        data: contentOverview,
      },
      {
        id: 'recent-activity',
        type: 'activity',
        title: 'Recent Activity',
        icon: 'IconHistory',
        items: recentActivity,
        retentionDays,
      },
      {
        id: 'webhook-health',
        type: 'stat-group',
        title: 'Webhooks',
        icon: 'IconWebhook',
        stats: [
          { label: 'Total', value: webhookHealth.total },
          { label: 'Healthy', value: webhookHealth.healthy, tone: webhookHealth.healthy > 0 ? 'success' : 'neutral' },
          { label: 'Paused', value: webhookHealth.paused, tone: webhookHealth.paused > 0 ? 'warning' : 'neutral' },
          { label: 'Failures (24h)', value: webhookHealth.failuresIn24h, tone: webhookHealth.failuresIn24h > 0 ? 'danger' : 'neutral' },
        ],
      },
      {
        id: 'media-snapshot',
        type: 'stat-group',
        title: 'Media',
        icon: 'IconImage',
        stats: [
          { label: 'Files', value: mediaSnapshot.total, href: '/media' },
          { label: 'Size', value: mediaSnapshot.totalSizeBytes, unit: 'bytes' },
          { label: 'Missing Alt Text', value: mediaSnapshot.missingAltText, tone: mediaSnapshot.missingAltText > 0 ? 'warning' : 'neutral', href: '/media?missingAlt=1' },
          { label: 'Last 7 Days', value: mediaSnapshot.uploadedLast7Days },
        ],
      },
      {
        id: 'api-keys',
        type: 'stat-group',
        title: 'API Keys',
        icon: 'IconKey',
        stats: [
          { label: 'Active', value: apiKeyStats.active, href: '/settings/api-keys?status=Active' },
          { label: 'Expiring Soon', value: apiKeyStats.expiringIn7Days, tone: apiKeyStats.expiringIn7Days > 0 ? 'warning' : 'neutral', href: '/settings/api-keys?expiring=7d' },
          { label: 'Expired', value: apiKeyStats.expired, tone: apiKeyStats.expired > 0 ? 'danger' : 'neutral', href: '/settings/api-keys?status=Expired' },
          { label: 'Revoked', value: apiKeyStats.revoked, href: '/settings/api-keys?status=Revoked' },
        ],
      },
      {
        id: 'members',
        type: 'stat-group',
        title: 'Members',
        icon: 'IconUsers',
        stats: [
          { label: 'Total', value: memberStats.total, href: '/settings/members' },
          { label: 'Admins & Owners', value: memberStats.adminsAndOwners },
          { label: 'Active (7d)', value: memberStats.activeInLast7Days },
        ],
      },
    ]


    // Custom content widgets from dashboard.ts
    const customWidgets = dashConfig.widgets?.filter(
      (w) => w.type === 'stat' || w.type === 'table'
    ) ?? []
    for (const w of customWidgets) {
      const tables = contentTables as Record<string, any>
      const table = tables[(w as any).source?.contentType]
      if (!table) continue

      const cacheId = `custom:${w.id}`
      const data = await withDashboardCache(redis, cacheKey(cacheId), 60, async () => {
        if (w.type === 'stat') {
          const conditions = [
            eq(table.workspaceId, workspaceId),
            ]
          if ((w as any).source?.status) {
            conditions.push(eq(table.status, (w as any).source.status))
          }
          const [row] = await db.select({ count: count() }).from(table).where(and(...conditions))
          return { value: Number(row?.count ?? 0) }
        } else {
          // table widget
          const rows = await db
            .select()
            .from(table)
            .where(and(eq(table.workspaceId, workspaceId)))
            .limit((w as any).source?.limit ?? 10)
            .orderBy(desc(table.createdAt))
          return { rows: rows.map((r: Record<string, unknown>) => {
            const cols: Record<string, unknown> = {}
            for (const col of (w as any).columns ?? []) {
              cols[col.key] = r[col.key]
            }
            return cols
          })}
        }
      })

      widgets.push({
        id: w.id,
        type: w.type,
        title: (w as any).title,
        description: (w as any).description,
        href: (w as any).href,
        ...(w.type === 'stat' ? { value: (data as any).value, icon: (w as any).icon } : { columns: (w as any).columns, rows: (data as any).rows }),
      })
    }

    // Extension widgets — metadata only, frontend fetches data. Two sources:
    // inline plugin objects (legacy) and resolved manifests from `extensions:`
    // config entries (project.extensions[].manifest.dashboardWidgets).
    const activeExtensions = new Set(await (extensionWiringDeps()?.activeIds?.(workspaceId) ?? Promise.resolve([] as string[])))
    const extensionWidgets = [
      ...(project?.declaredExtensions?.flatMap((ext: any) => (ext as any).dashboardWidgets ?? []) ?? []),
      // Only the widgets of extensions active in this environment (Phase 4).
      ...(project?.extensions?.filter((ext: any) => activeExtensions.has(ext.id)).flatMap((ext: any) => ext.manifest?.dashboardWidgets ?? []) ?? []),
    ]
    for (const ew of extensionWidgets) {
      // Capability-gated widgets are dropped for members who lack it - the
      // widget usually deep-links to pages the same capability protects.
      if (ew.capability) {
        try { requireCapability({ permissions, memberId }, ew.capability as never) }
        catch { continue }
      }
      // `viewPermission` (an access rule, same shape as page `access`) keeps
      // the widget on every dashboard but shows it as a locked "No rights to
      // view" card, with no data fetched, for members who fail the rule.
      const restricted = !canViewWidget(viewer, ew.viewPermission)
      widgets.push({
        id: ew.id,
        type: 'extension',
        // The widget's own render shape (stat | stat-group | table) - the
        // frontend picks its card layout from this, defaulting to 'stat'.
        widgetType: ew.type ?? 'stat',
        title: ew.title,
        description: ew.description,
        icon: ew.icon,
        href: ew.href,
        // Omit the data path when restricted so the client never fetches it.
        ...(restricted ? { restricted: true } : { dataPath: ew.dataPath }),
      })
    }

    // Drop privileged built-ins (members / API keys / webhooks) for members who
    // lack the capability they deep-link into. Admin keys satisfy every gate.
    const capabilityGated = widgets.filter((w) => {
      const cap = BUILTIN_WIDGET_CAPABILITY[w.id as string]
      if (!cap) return true
      return hasCapability({ permissions, memberId } as never, cap)
    })

    // Apply overrides from dashboard.ts (hide, rename, etc.)
    const builtinOverrides = dashConfig.widgets?.filter(w => w.type === 'builtin') ?? []
    const visibleWidgets = applyWidgetOverrides(capabilityGated, builtinOverrides as any)

    // Apply ordering
    const ordered = sortWidgets(visibleWidgets, dashConfig.order)

    return { data: { widgets: ordered } }
  })

// ── Workspace overview (Settings > General, 2026-09-08) ───────────────────────

export interface WorkspaceOverview {
  contentTypes: number
  objects: { total: number; published: number; draft: number }
  media: { total: number; sizeBytes: number }
  members: number
  apiKeys: { active: number }
  webhooks: number
  forms: number
}

/** What this workspace holds, in numbers - the same reads the dashboard makes, without its widgets. */
export async function fetchWorkspaceOverview(db: DbClient, schema: SchemaDefinition, workspaceId: string): Promise<WorkspaceOverview> {
  const [content, media, keys, memberStats, hooks, forms] = await Promise.all([
    fetchContentOverview(db, schema, workspaceId),
    fetchMediaSnapshot(db, workspaceId),
    fetchApiKeyStats(db, workspaceId),
    fetchMemberStats(db, workspaceId),
    fetchWebhookHealth(db, workspaceId),
  ])
  return {
    contentTypes: schema.types.length,
    objects: { total: content.totals.total, published: content.totals.published, draft: content.totals.draft },
    media: { total: media.total, sizeBytes: media.totalSizeBytes },
    members: memberStats.total,
    apiKeys: { active: keys.active },
    webhooks: hooks.total,
  }
}

export const workspaceOverviewRoute = (app: Elysia) =>
  app.get('/api/v1/admin/workspace-overview', async (ctx: any) => {
    const { db, schema, workspaceId } = ctx
    if (!workspaceId) throw new RequestError('VALIDATION_ERROR', 'workspaceId is required', 400)
    return { data: await fetchWorkspaceOverview(db, schema, workspaceId) }
  })
