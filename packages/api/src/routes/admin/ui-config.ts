/**
 * File Name: ui-config.ts
 * Purpose: GET /api/v1/admin/ui-config - the Admin's bootstrap read for one
 *          workspace x environment: the sidebar's presentation flags, the
 *          environment-role rules, and (closure plan Phase 8A) the
 *          CAPABILITY DESCRIPTORS, so Admin stops assembling capability
 *          truth from four endpoints and three client caches.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The descriptor is added HERE rather than on a new
 *          route because this is already the Admin bootstrap contract - the
 *          HTTP surface does not grow. Capability state is computed per
 *          request from the runtime registry and one bounded read of this
 *          scope's extension rows; it is not cached here, because a stale
 *          capability answer is exactly the failure this phase exists to
 *          remove. `recents` and `schemaWritable` stay what they were: a
 *          presentation preference and an environment-role rule, neither of
 *          which is a capability.
 */
import { resolvedFor } from '../../config/state'
import { deploymentRole } from '../../lib/deployment-role'
import { Elysia } from 'elysia'
import { graphqlEnabledFor } from '../graphql'
import { qmEnabled } from '../../lib/query-monitor'
import { getSchemaWritable } from '../../lib/schema-writable'
import { runtimeRegistry } from '../../runtime/registry'
import { extensionStates } from '../../runtime/extensions'
import { extensionWiringDeps } from '../../services/extension-server'
import { getExtensionManifest, listRegisteredExtensionIds } from '../../hooks/app-hooks-registry'
import { capabilityDescriptors, type CapabilityDescriptor } from '../../services/capability-descriptor'

/**
 * The capabilities of one workspace x environment. Never throws: a scope
 * whose extension rows cannot be read still reports its core capabilities,
 * because a descriptor failure must not blank the Admin.
 */
async function capabilitiesFor(workspaceId: string): Promise<CapabilityDescriptor[]> {
  // Availability is evaluated at START and cached on the state. A process
  // that has not started its registry yet (a test, a boot still in flight)
  // would otherwise report an unevaluated capability as fine, so ask - the
  // registry answers from its cache after the first time.
  await Promise.all(
    runtimeRegistry.snapshot()
      .filter((s) => s.availability === null && !s.id.startsWith('ext:'))
      .map((s) => runtimeRegistry.availabilityOf(s.id).catch(() => null)),
  )
  const deps = extensionWiringDeps()
  let extensions: Awaited<ReturnType<typeof extensionStates>> = []
  if (deps?.exec) {
    extensions = await extensionStates(
      deps.exec as never,
      runtimeRegistry,
      { workspaceId },
      { ids: listRegisteredExtensionIds, manifest: getExtensionManifest, gate: (deps as { gate?: never }).gate },
    ).catch(() => [])
  }
  return capabilityDescriptors({ registry: runtimeRegistry.snapshot(), extensions })
}

/** Read admin.nav from the loaded workspace project, tolerating both shapes. */
function readNav(project: any): { recents?: boolean; links?: unknown; content?: boolean } {
  return (project?.config?.admin?.nav ?? project?.admin?.nav ?? {}) as { recents?: boolean; links?: unknown; content?: boolean }
}

/** admin.nav.content: shown unless explicitly set to `false`. */
export function contentNavVisible(nav: { content?: unknown } | null | undefined): boolean {
  return nav?.content !== false
}

export interface NavLinks { support?: string; docs?: string }

/**
 * The links the Settings tree shows under "Other": only http(s) URLs pass,
 * so a typo or a javascript: value never becomes a link in the Admin.
 */
export function navLinksOf(nav: { links?: unknown } | null | undefined): NavLinks {
  const raw = nav?.links
  if (!raw || typeof raw !== 'object') return {}
  const out: NavLinks = {}
  for (const key of ['support', 'docs'] as const) {
    const v = (raw as Record<string, unknown>)[key]
    if (typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim())) out[key] = v.trim()
  }
  return out
}

export const adminUiConfigRoute = (app: Elysia) =>
  app.get('/api/v1/admin/ui-config', async (ctx: any) => {
    const { workspaceProjects, workspaceId, db } = ctx
    const project = (workspaceProjects as any[])?.find((p) => p.workspaceId === workspaceId)
    const nav = readNav(project)
    return {
      data: {
        recents: nav.recents === true, // default OFF
        // The Settings tree's "Other" links (Help & Support, Documentation).
        links: navLinksOf(nav),
        // The generic Content nav section - default ON, opt-out for a
        // project whose every type is admin-managed through custom pages.
        content: contentNavVisible(nav),
        // Whether the Content Object / Globals Builder may write schema files
        // (dev runtime + writable app source). Read-only otherwise.
        // (Phase 5A: development role only - the Admin's dev mode follows it.)
        schemaWritable: getSchemaWritable(),
        // The role of this deployment (TANGEN_DEPLOYMENT_ROLE): information the
        // Admin shows, never a selector - a process serves one database.
        deploymentRole: deploymentRole(),
        queryMonitorEnabled: qmEnabled(),
        // Whether POST /api/v1/graphql answers for this env - the Devspace
        // nav gates on it without probing the route.
        graphqlEnabled: await graphqlEnabledFor(project),
        // Phase 8A: one server-owned answer for this workspace x environment.
        capabilities: await capabilitiesFor(String(workspaceId ?? '')),
        // Stage 2 (plan-config-resolver section 10): the keys declared
        // clientSafe, by key, and nothing else of the resolved deployment.
        config: resolvedFor(String(workspaceId ?? ''))?.clientSafe() ?? {},
      },
    }
  })
