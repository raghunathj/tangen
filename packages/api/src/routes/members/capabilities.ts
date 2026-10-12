/**
 * File Name: capabilities.ts
 * Purpose: GET /api/v1/admin/capabilities — the roles editor's capability
 *          catalog: every core capability plus the capabilities declared by
 *          extensions installed in the caller's workspace (manifest
 *          `capabilities`, C3). The admin renders role capability pills from
 *          this response instead of a hardcoded client-side list.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: installed = workspace_installed_apps row OR
 *          config-resolved extension (same merged semantics as
 *          GET /extensions). Gated like GET /roles — the surface that
 *          consumes it.
 */
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { activeExtensionIdsDb } from '../../services/extension-install-state'
import { ALL_CAPABILITIES } from '@tangen/types'
import type { CoreCapability } from '@tangen/types'
import { requireAnyCapability } from '../../lib/member-access'
import { getExtensionCapabilities } from '../../hooks/app-hooks-registry'
import { assertMemberJwt } from './manage'

/** Labels for the core capability catalog (server-side source of truth). */
export const CORE_CAPABILITY_LABELS: Record<CoreCapability, string> = {
  'use:ai': 'Use AI (Gen AI, fills, image generation)',
  'manage:members': 'Manage members',
  'manage:roles': 'Manage roles',
  'manage:apiKeys': 'Manage API keys',
  'manage:webhooks': 'Manage webhooks',
  'manage:settings': 'Manage settings',
  'connections:use': 'Choose a connection for an automation (read-only)',
  'manage:aiSettings': 'Manage AI settings',
  'manage:cron': 'Manage jobs & cron',
  'schema:migrate': 'Migrate content & schema',
  'releases:review': 'Submit, withdraw and edit draft releases',
  'releases:approve': 'Approve releases (freezes the reviewed payload)',
  'releases:apply': 'Apply, schedule and retry approved releases',
}

export interface CapabilityCatalogEntry {
  id: string
  label: string
  description?: string
  /** Capabilities a holder of this one also gets (extension `implies`). */
  implies?: string[]
  source: 'core' | 'extension'
  /** Declaring extension (source 'extension' only). */
  extensionId?: string
  /** Resource this capability belongs to (permission-tree grouping). */
  resource?: string
  /** Action verb (permission-tree grouping / icon). */
  action?: string
  /** Reveals sensitive data (banner cue). */
  sensitive?: boolean
}

/** Core catalog + capabilities of the given installed extensions. */
export function buildCapabilityCatalog(installedIds: Set<string>): CapabilityCatalogEntry[] {
  const core: CapabilityCatalogEntry[] = ALL_CAPABILITIES.map((id) => ({
    id, label: CORE_CAPABILITY_LABELS[id], source: 'core',
  }))
  const ext: CapabilityCatalogEntry[] = getExtensionCapabilities()
    .filter((c) => installedIds.has(c.extensionId))
    .map((c) => ({
      id: c.id,
      label: c.label,
      ...(c.description ? { description: c.description } : {}),
      ...(c.implies?.length ? { implies: [...c.implies] } : {}),
      source: 'extension',
      extensionId: c.extensionId,
      ...(c.resource ? { resource: c.resource } : {}),
      ...(c.action ? { action: c.action } : {}),
      ...(c.sensitive ? { sensitive: true } : {}),
    }))
  return [...core, ...ext]
}

export const memberCapabilitiesRoute = (app: Elysia) =>
  app.get('/api/v1/admin/capabilities', async (ctx: any) => {
    const { db, workspaceId, memberId } = ctx
    assertMemberJwt(memberId)
    requireAnyCapability(
      { permissions: ctx.permissions, memberId, memberRole: ctx.memberRole },
      ['manage:members', 'manage:roles'],
    )

    // The per-environment row is the truth (Phase 4); a code-declared
    // extension has its row from boot adoption.
    const installed = new Set<string>(
      await activeExtensionIdsDb(db, { workspaceId }),
    )

    return { data: buildCapabilityCatalog(installed) }
  })
