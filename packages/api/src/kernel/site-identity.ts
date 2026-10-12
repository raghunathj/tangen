/**
 * File Name: site-identity.ts
 * Purpose: The registry of site identity providers (tasks/plan-core-slimming.md
 *          S1) and the one place core resolves an end user: `resolveSiteUser`.
 *          A registration serves a workspace or not (an extension only where
 *          it is active; Tangen Auth only where it is configured); exactly one
 *          may serve a workspace. Core never reads a site token here - the
 *          provider does.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `SiteIdentityError` codes map to HTTP statuses in
 *          @tangen/types; callers translate them to their own error shape
 *          (`RouteError`, `RequestError`, `errorResponse`).
 */
import { SiteIdentityError, type SiteIdentityProvider, type SiteIdentityRequest, type SiteUser } from '@tangen/types'

export interface SiteIdentityRegistration {
  /** The provider's id, for diagnostics and the Admin. */
  id: string
  /** The extension contributing it, or null for a built-in. */
  extensionId: string | null
  /** The provider for one workspace, or null when this registration does not serve it. */
  forWorkspace: (workspaceId: string) => Promise<SiteIdentityProvider | null> | SiteIdentityProvider | null
}

const _registrations: SiteIdentityRegistration[] = []

/**
 * Registers a provider; returns the function that removes it again. A
 * registration's `id` is unique: registering the same id again replaces the
 * earlier one (a re-composed server re-registers Tangen Auth) instead of
 * making the workspace ambiguous.
 */
export function registerSiteIdentity(registration: SiteIdentityRegistration): () => void {
  const prev = _registrations.findIndex((r) => r.id === registration.id)
  if (prev >= 0) _registrations.splice(prev, 1)
  _registrations.push(registration)
  return () => {
    const i = _registrations.indexOf(registration)
    if (i >= 0) _registrations.splice(i, 1)
  }
}

/** Test helper - forgets every registration. */
export function resetSiteIdentity(): void {
  _registrations.splice(0)
}

/** The registrations as declared, for diagnostics. */
export function listSiteIdentityRegistrations(): ReadonlyArray<Pick<SiteIdentityRegistration, 'id' | 'extensionId'>> {
  return _registrations.map(({ id, extensionId }) => ({ id, extensionId }))
}

/**
 * The provider serving one workspace, or null when none does. Two providers
 * serving the same workspace is a deployment mistake, refused loudly rather
 * than resolved by order.
 */
export async function siteIdentityFor(workspaceId: string): Promise<SiteIdentityProvider | null> {
  const found: SiteIdentityProvider[] = []
  for (const r of _registrations) {
    const p = await r.forWorkspace(workspaceId)
    if (p) found.push(p)
  }
  if (found.length > 1) throw new SiteIdentityError('ambiguous', `Two site identity providers are active for this workspace (${found.map((p) => p.id).join(', ')})`)
  return found[0] ?? null
}

/**
 * The end user behind a request in one workspace: null when no credential
 * was presented; throws `SiteIdentityError` for a refused credential, and
 * `no_provider` when no provider serves the workspace and a credential was
 * presented (with none presented there is nothing to judge).
 */
export async function resolveSiteUser(input: SiteIdentityRequest): Promise<SiteUser | null> {
  const provider = await siteIdentityFor(input.workspaceId)
  if (!provider) {
    if (input.token === null) return null
    throw new SiteIdentityError('no_provider')
  }
  const user = await provider.authenticate(input)
  if (!user) return null
  if (user.workspaceId !== input.workspaceId) throw new SiteIdentityError('wrong_workspace')
  return { ...user, provider: user.provider ?? provider.id }
}

/**
 * For a request that names no workspace (the short-form custom route): the
 * first workspace whose provider accepts the credential. A provider that
 * refuses the credential is not an error here - the credential belongs to
 * another workspace - so refusals are swallowed; `null` means no candidate
 * accepted it.
 */
export async function resolveSiteUserAcross(
  workspaceIds: readonly string[],
  input: Omit<SiteIdentityRequest, 'workspaceId'>,
): Promise<{ workspaceId: string; user: SiteUser } | null> {
  for (const workspaceId of workspaceIds) {
    try {
      const user = await resolveSiteUser({ ...input, workspaceId })
      if (user) return { workspaceId, user }
    } catch (err) {
      if (err instanceof SiteIdentityError && err.code !== 'ambiguous') continue
      throw err
    }
  }
  return null
}

/** The Bearer credential of a request, or null; a platform key (`tgn_`) is never a site credential. */
export function siteTokenOf(headers: { get(name: string): string | null }): string | null {
  const auth = headers.get('authorization') ?? headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token || token.startsWith('tgn_')) return null
  return token
}
