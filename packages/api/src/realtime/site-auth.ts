/**
 * File Name: site-auth.ts
 * Purpose: The identity a site-auth member presents to the ticket route -
 *          the site key (X-Tangen-Key) that scopes the site, plus the site
 *          session JWT that names the person - resolved into the derive's
 *          shape so `claimsFromContext` can mint a `site-key` ticket.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Realtime R5 of tasks/plan-realtime.md, closing R4's
 *          change request ("site-auth members cannot mint tickets: the
 *          route reads Bearer credentials only"). The rule is the one the
 *          site-auth mount and custom routes with `auth: 'user'` already
 *          apply: the key must be live and hold the `auth` permission, the
 *          workspace's auth config must be on, the JWT must verify and name
 *          the key's workspace and environment, and a session id in it must
 *          still be valid. What the member may then SUBSCRIBE to is what the
 *          key may read - a site reads content through its key, so the
 *          ticket carries the key's grants (`apiKeyId`) and the member's id
 *          (`siteUserId`), never the member's email. The auth derive calls
 *          this for the `realtime-ticket` policy row only (middleware/
 *          auth.ts), so a site session is not a platform credential
 *          anywhere else.
 */
import { createHash } from 'node:crypto'
import { eq, and, isNull } from 'drizzle-orm'
import { apiKeys } from '@tangen/db'
import type { ApiKeyPermissions, WorkspaceProject } from '@tangen/types'
import { RequestError } from '../lib/errors'
import { checkExtensionPermission } from '../lib/api-key-auth'
import { SiteIdentityError } from '@tangen/types'
import { resolveSiteUser } from '../kernel/site-identity'
import { getSchema } from '../services/schema-cache'

/** What the derive attaches for a site-auth member on the ticket route. */
export type SiteAuthTicketIdentity = {
  workspaceId: string
  permissions: ApiKeyPermissions
  apiKeyId: string
  memberId: null
  memberRole: null
  /** The site member (auth_users.id) behind the session; the ticket records it. */
  siteUserId: string
  schema: unknown
}

const unauthorized = (message: string) => new RequestError('UNAUTHORIZED', message, 401)

/**
 * Resolves the site key and the site session into one identity, or throws
 * the refusal the site-auth mount would give.
 * @param input.keyHeader - The raw X-Tangen-Key value.
 * @param input.token - The Bearer token (a site session JWT, never a `tgn_` key).
 */
export async function resolveSiteAuthTicketIdentity(input: {
  db: any
  redis: any
  projects: WorkspaceProject[]
  keyHeader: string
  token: string
  /** The request headers, for providers that are not Bearer based. */
  headers?: Headers
}): Promise<SiteAuthTicketIdentity> {
  const { db, redis, keyHeader, token } = input
  if (!keyHeader.startsWith('tgn_')) throw unauthorized('X-Tangen-Key header required')
  const prefix = keyHeader.slice(0, 12)
  const keyHash = createHash('sha256').update(keyHeader).digest('hex')
  const [key] = await db.select().from(apiKeys)
    .where(and(eq(apiKeys.keyPrefix, prefix), eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .limit(1)
  if (!key) throw unauthorized('Invalid or revoked API key')
  if (key.expiresAt && new Date(key.expiresAt) < new Date()) throw unauthorized('API key has expired')
  const permissions = (key.permissions ?? {}) as ApiKeyPermissions
  // The site key carries the identity extension's grant (`permissions.extensions.auth.sessions`), never a core flag.
  if (!checkExtensionPermission(permissions, 'auth', 'sessions')) throw new RequestError('FORBIDDEN', 'API key cannot sign site users in', 403)

  const workspaceId = String(key.workspaceId)

  // The workspace's site identity provider names the person (tasks/plan-core-slimming.md S1).
  let siteUserId = ''
  try {
    const user = await resolveSiteUser({ workspaceId, token, headers: input.headers ?? new Headers() })
    siteUserId = user?.id ?? ''
  } catch (err) {
    if (err instanceof SiteIdentityError) throw new RequestError(err.status === 403 ? 'FORBIDDEN' : 'UNAUTHORIZED', err.message, err.status)
    throw err
  }
  if (!siteUserId) throw unauthorized('Invalid or expired token')

  return {
    workspaceId,
    permissions,
    apiKeyId: String(key.id),
    memberId: null,
    memberRole: null,
    siteUserId,
    schema: await getSchema(db, redis),
  }
}
