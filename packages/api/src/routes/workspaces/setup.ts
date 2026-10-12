import { Elysia } from 'elysia'
import { eq, and, count } from 'drizzle-orm'
import { SignJWT } from 'jose'
import { members, workspaces } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { dbPlugin } from '../../plugins/db'
import { getJwtKey, verifyMemberToken } from '../../lib/jwt-secret'
import { attemptLimiter } from '../../gateway/rate-limit/attempts'

const ACCESS_TOKEN_TTL = 15 * 60

// ── Setup attempts: 3 per workspace per minute ───────────────────────────────
// The same budget it always had, counted in the Gateway's rate-limit store
// rather than an in-process Map (plan-gateway section 15), so a second
// process does not hand out a fresh three.

const setupAttempts = attemptLimiter({ id: 'setup', window: 60, limit: 3 })

/** Counts one setup attempt for the workspace; the fourth inside a minute is refused. */
export async function checkRateLimit(workspaceId: string): Promise<void> {
  await setupAttempts.check(`workspace=${workspaceId}`, 'Too many setup attempts')
}

/** Forgets the workspace's attempts (tests). */
export async function clearRateLimitEntry(workspaceId: string): Promise<void> {
  await setupAttempts.forget(`workspace=${workspaceId}`)
}

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

export interface SetupPostBody {
  email: string
  // Exactly one of these must be present:
  name?: string         // new account: create with name + password
  password?: string     // existing account: verify password from another workspace
  sessionToken?: string // existing session: verify JWT as proof of identity (no password re-entry)
}

export function validateSetupBody(body: unknown): SetupPostBody {
  if (!body || typeof body !== 'object') {
    throw new RequestError('VALIDATION_ERROR', 'Request body is required', 400)
  }
  const b = body as Record<string, unknown>
  // A mailbox at a named domain: `someone@4monks` passed the old `includes('@')` and became the owner account.
  if (typeof b.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.email.trim())) {
    throw new RequestError('VALIDATION_ERROR', 'email must be a valid email address', 400)
  }
  const email = (b.email as string).trim().toLowerCase()

  // Scenario 1: existing session — JWT proves identity
  if (typeof b.sessionToken === 'string' && b.sessionToken) {
    return { email, sessionToken: b.sessionToken }
  }

  // password is required for scenarios 2 and 3
  if (typeof b.password !== 'string' || b.password.length < 8) {
    throw new RequestError('VALIDATION_ERROR', 'password must be at least 8 characters', 400)
  }

  // Scenario 3: new account — name is required
  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim()) {
      throw new RequestError('VALIDATION_ERROR', 'name must be a non-empty string', 400)
    }
    return { email, name: (b.name as string).trim(), password: b.password as string }
  }

  // Scenario 2: existing account from another workspace — verify password
  return { email, password: b.password as string }
}

export function buildNeedsSetupResponse(memberCount: number): { needsSetup: boolean; gone?: true } {
  if (memberCount > 0) return { needsSetup: false, gone: true }
  return { needsSetup: true }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export const workspaceSetupRoute = new Elysia()
  .use(dbPlugin)

  // First-run discovery: which registered workspaces still have zero members?
  // Lets the login page steer a fresh install straight to /setup. Returns
  // nothing once every workspace has at least one member.
  .get('/api/v1/setup', async ({ db }) => {
    const rows = await db
      .select({ workspaceId: workspaces.id, name: workspaces.name, memberCount: count(members.id) })
      .from(workspaces)
      // Set up means an OWNER exists: members that desired state created without a credential do not count.
      .leftJoin(members, and(eq(members.workspaceId, workspaces.id), eq(members.role, 'owner')))
      .groupBy(workspaces.id, workspaces.name)
    return { needsSetup: rows.filter((r) => Number(r.memberCount) === 0).map(({ workspaceId, name }) => ({ workspaceId, name })) }
  })

  .get('/api/v1/setup/:workspaceId', async ({ params, db }) => {
    const [[countRow], [wsRow]] = await Promise.all([
      db.select({ total: count() }).from(members).where(and(eq(members.workspaceId, params.workspaceId), eq(members.role, 'owner'))),
      db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, params.workspaceId)).limit(1),
    ])
    const base = buildNeedsSetupResponse(Number(countRow.total))
    return { ...base, workspaceName: wsRow?.name ?? null }
  })

  // Check whether an email already exists in any workspace (cross-workspace account lookup)
  .get('/api/v1/setup/:workspaceId/check-email', async ({ params, query, db }: any) => {
    const email = (query?.email ?? '').trim().toLowerCase()
    if (!email || !email.includes('@')) {
      throw new RequestError('VALIDATION_ERROR', 'email query param is required', 400)
    }
    const [existing] = await db
      .select({ name: members.name })
      .from(members)
      .where(eq(members.email, email))
      .limit(1)
    return { exists: !!existing, name: existing?.name ?? null }
  })

  .post('/api/v1/setup/:workspaceId', async ({ params, body, db }) => {
    await checkRateLimit(params.workspaceId)
    const payload = validateSetupBody(body)

    // Guard: the workspace must actually exist — otherwise a mistyped URL
    // mints an orphan member no workspace will ever list.
    const [wsRow] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, params.workspaceId))
      .limit(1)
    if (!wsRow) {
      throw new RequestError('NOT_FOUND', 'Workspace not found', 404)
    }

    // Guard: the workspace already has an OWNER — 410 Gone (endpoint is permanently
    // retired). Members desired state created without a credential do not count.
    const [row] = await db
      .select({ total: count() })
      .from(members)
      .where(and(eq(members.workspaceId, params.workspaceId), eq(members.role, 'owner')))
    if (Number(row.total) > 0) {
      throw new RequestError('SETUP_COMPLETE', 'This workspace is already set up', 410)
    }

    let ownerName: string
    let passwordHash: string

    if (payload.name && payload.password) {
      // Scenario 3: brand-new account
      ownerName = payload.name
      passwordHash = await Bun.password.hash(payload.password)
    } else if (payload.sessionToken) {
      // Scenario 1: already logged in — verify JWT proves the email identity
      let jwtPayload: any
      try {
        jwtPayload = await verifyMemberToken(payload.sessionToken)
      } catch {
        throw new RequestError('UNAUTHORIZED', 'Session token is invalid or expired', 401)
      }
      if (jwtPayload.email !== payload.email) {
        throw new RequestError('UNAUTHORIZED', 'Session token does not match the provided email', 401)
      }
      // Fetch existing member record for the name and password hash
      const [existing] = await db
        .select({ name: members.name, passwordHash: members.passwordHash })
        .from(members)
        .where(eq(members.email, payload.email))
        .limit(1)
      if (!existing) {
        throw new RequestError('NOT_FOUND', 'No account found with that email', 404)
      }
      ownerName = existing.name
      passwordHash = existing.passwordHash
    } else if (payload.password) {
      // Scenario 2: existing account in another workspace — verify password
      const [existing] = await db
        .select({ name: members.name, passwordHash: members.passwordHash })
        .from(members)
        .where(eq(members.email, payload.email))
        .limit(1)
      if (!existing) {
        throw new RequestError('NOT_FOUND', 'No account found with that email', 404)
      }
      const valid = await Bun.password.verify(payload.password, existing.passwordHash)
      if (!valid) {
        throw new RequestError('UNAUTHORIZED', 'Incorrect password', 401)
      }
      ownerName = existing.name
      passwordHash = existing.passwordHash
    } else {
      throw new RequestError('VALIDATION_ERROR', 'Invalid request body', 400)
    }

    // First-run owner: claim every registered workspace that still has no
    // members (not just the one in the URL) — a fresh multi-workspace project
    // gets one owner across the board instead of stranded setup pages.
    const orphanWorkspaces = (
      await db
        .select({ workspaceId: workspaces.id, memberCount: count(members.id) })
        .from(workspaces)
        .leftJoin(members, and(eq(members.workspaceId, workspaces.id), eq(members.role, 'owner')))
        .groupBy(workspaces.id)
    ).filter((w) => Number(w.memberCount) === 0 && w.workspaceId !== params.workspaceId)

    const memberId = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const ownerRows = [
      {
        id: memberId,
        workspaceId: params.workspaceId as string,
        name: ownerName,
        email: payload.email,
        passwordHash,
        role: 'owner' as const,
      },
      ...orphanWorkspaces.map((w, i) => ({
        id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${i}`,
        workspaceId: w.workspaceId as string,
        name: ownerName,
        email: payload.email,
        passwordHash,
        role: 'owner' as const,
      })),
    ]
    // Desired membership may already have created this person without a
    // credential: the owner adopts that row (its id, its environment rows)
    // instead of colliding with it.
    await db.insert(members).values(ownerRows)
      .onConflictDoUpdate({ target: [members.workspaceId, members.email], set: { passwordHash, role: 'owner', name: ownerName } })
    // Environment membership (plan D3): the owner is active in every
    // environment this workspace has, here and in each adopted orphan.

    const token = await new SignJWT({
      workspaceId: params.workspaceId,
      role: 'owner',
      email: payload.email,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(memberId)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL}s`)
      .sign(getJwtKey())

    return setupSessionResponse(token, { id: memberId, name: ownerName, email: payload.email, role: 'owner' })
  })

/**
 * Setup's session envelope. `accessToken` matches what POST /api/auth/login
 * answers with - one concept, one name; `token` is the historical key
 * (finding #2: the mismatch produced a 401 that read like an auth bug).
 */
export function setupSessionResponse<M>(
  token: string,
  member: M,
): { token: string; accessToken: string; expiresIn: number; expiresAt: string; member: M } {
  return {
    token,
    accessToken: token,
    // Same deadline the login route reports (finding #11).
    expiresIn: ACCESS_TOKEN_TTL,
    expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL * 1000).toISOString(),
    member,
  }
}
