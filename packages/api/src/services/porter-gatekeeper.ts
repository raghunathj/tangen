/**
 * File Name: porter-gatekeeper.ts
 * Purpose: Arc R front door (R-T1). The RECEIVING admin generates a
 *   single-use code at that moment; the sender enters the receiver's URL +
 *   code and redeems it ONCE for a transfer token scoped to porter ingest
 *   endpoints and one run. No credential exchange, no file.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: S20b envelope - codes are >=50 bits grouped base32
 *   (80 here), TTL 15 min, hashed at rest, revocable, single-use via an
 *   atomic claim UPDATE; redemption is rate-limited per caller with
 *   lockout. Tokens are 256-bit, TTL 60 min, hashed at rest, directional
 *   (write-in only - nothing can be read out with one).
 */
import { eq, and, isNull, sql } from 'drizzle-orm'
import { createHash, randomBytes } from 'node:crypto'
import { porterTransferCodes, porterTransferTokens } from '@tangen/db'
import { attemptLimiter } from '../gateway/rate-limit/attempts'
import { memoryStore, setActiveRateLimitStore } from '../gateway/rate-limit/store'

const CODE_TTL_MS = 15 * 60 * 1000
const TOKEN_TTL_MS = 60 * 60 * 1000
/** Crockford base32 minus lookalikes - unambiguous to read over a call. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Uppercases and strips separators/spaces so dictation survives. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, '')
}

function mintCode(): string {
  const bytes = randomBytes(16)
  let out = ''
  for (let i = 0; i < 16; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`
}

export interface GeneratedCode {
  id: string
  /** Plaintext - shown ONCE on the receiver's screen, never stored. */
  code: string
  expiresAt: Date
}

export async function generateTransferCode(
  db: any,
  input: { workspaceId: string; createdBy: string },
): Promise<GeneratedCode> {
  const code = mintCode()
  const id = `ptc_${randomBytes(8).toString('hex')}`
  const expiresAt = new Date(Date.now() + CODE_TTL_MS)
  await db.insert(porterTransferCodes).values({
    id,
    workspaceId: input.workspaceId,
    codeHash: sha256(normalizeCode(code)),
    expiresAt,
    createdBy: input.createdBy,
  })
  return { id, code, expiresAt }
}

export async function listActiveCodes(db: any, workspaceId: string) {
  const rows = await db.select({
    id: porterTransferCodes.id,
    expiresAt: porterTransferCodes.expiresAt,
    createdAt: porterTransferCodes.createdAt,
    createdBy: porterTransferCodes.createdBy,
  }).from(porterTransferCodes)
    .where(and(
      eq(porterTransferCodes.workspaceId, workspaceId),
      isNull(porterTransferCodes.redeemedAt),
      isNull(porterTransferCodes.revokedAt),
      sql`${porterTransferCodes.expiresAt} > now()`,
    ))
  return rows
}

export async function revokeCode(db: any, workspaceId: string, id: string): Promise<boolean> {
  const rows = await db.update(porterTransferCodes)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(porterTransferCodes.id, id),
      eq(porterTransferCodes.workspaceId, workspaceId),
      isNull(porterTransferCodes.revokedAt),
    ))
    .returning({ id: porterTransferCodes.id })
  return rows.length > 0
}

// ── redemption (public endpoint - the code IS the credential) ────────────────

/**
 * Attempts per caller key; lockout after too many inside the window, and a
 * success forgets the key. The budget it always had (10 in 15 minutes),
 * counted in the Gateway's rate-limit store rather than an in-process Map
 * (plan-gateway section 15), so an attacker spread across processes meets
 * one lockout rather than one per process.
 */
const MAX_ATTEMPTS = 10
const redemptionAttempts = attemptLimiter({ id: 'porter-redeem', window: 15 * 60, limit: MAX_ATTEMPTS })

/** Test seam: a fresh in-process store, so one file's lockouts do not reach the next. */
export function __resetRedemptionAttempts(): void {
  setActiveRateLimitStore(memoryStore())
}

export interface RedeemedToken {
  token: string
  tokenId: string
  workspaceId: string
  expiresAt: Date
}

export class RedemptionError extends Error {
  constructor(message: string, public readonly locked = false) { super(message) }
}

/**
 * Redeems a code exactly once: the atomic claim UPDATE is the single-use
 * guarantee - two concurrent redemptions cannot both win.
 */
export async function redeemTransferCode(
  db: any,
  input: { code: string; callerKey: string; senderInfo?: Record<string, unknown> },
): Promise<RedeemedToken> {
  const now = Date.now()
  // Counted before the claim, forgotten on success: the eleventh attempt in
  // the window is the locked one, as before. A store failure counts nothing
  // and lets the attempt through (D-5, fail-open, logged).
  const attempt = await redemptionAttempts.hit(`caller=${input.callerKey}`)
  if (attempt?.over) {
    throw new RedemptionError('Too many attempts - locked out, try again later', true)
  }

  const hash = sha256(normalizeCode(input.code))
  const claimed = await db.update(porterTransferCodes)
    .set({ redeemedAt: new Date() })
    .where(and(
      eq(porterTransferCodes.codeHash, hash),
      isNull(porterTransferCodes.redeemedAt),
      isNull(porterTransferCodes.revokedAt),
      sql`${porterTransferCodes.expiresAt} > now()`,
    ))
    .returning({
      id: porterTransferCodes.id,
      workspaceId: porterTransferCodes.workspaceId,
    })

  if (claimed.length === 0) {
    throw new RedemptionError('Invalid or expired code')
  }
  await redemptionAttempts.forget(`caller=${input.callerKey}`)

  const token = randomBytes(32).toString('hex')
  const tokenId = `ptt_${randomBytes(8).toString('hex')}`
  const expiresAt = new Date(now + TOKEN_TTL_MS)
  await db.insert(porterTransferTokens).values({
    id: tokenId,
    workspaceId: claimed[0].workspaceId,
    tokenHash: sha256(token),
    codeId: claimed[0].id,
    expiresAt,
    senderInfo: input.senderInfo ?? {},
  })
  return { token, tokenId, workspaceId: claimed[0].workspaceId, expiresAt }
}

export interface TransferTokenRow {
  id: string
  workspaceId: string
  runId: string | null
}

/** Resolves a presented token to its scope; null when invalid/expired/revoked. */
export async function validateTransferToken(db: any, token: string): Promise<TransferTokenRow | null> {
  if (!token || token.length < 32) return null
  const [row] = await db.select({
    id: porterTransferTokens.id,
    workspaceId: porterTransferTokens.workspaceId,
    runId: porterTransferTokens.runId,
  }).from(porterTransferTokens)
    .where(and(
      eq(porterTransferTokens.tokenHash, sha256(token)),
      isNull(porterTransferTokens.revokedAt),
      sql`${porterTransferTokens.expiresAt} > now()`,
    ))
    .limit(1)
  return row ?? null
}

/** Binds the token to its ONE run (first transfer start wins). */
export async function bindTokenToRun(db: any, tokenId: string, runId: string): Promise<boolean> {
  const rows = await db.update(porterTransferTokens)
    .set({ runId })
    .where(and(eq(porterTransferTokens.id, tokenId), isNull(porterTransferTokens.runId)))
    .returning({ id: porterTransferTokens.id })
  return rows.length > 0
}

export async function revokeToken(db: any, tokenId: string): Promise<void> {
  await db.update(porterTransferTokens)
    .set({ revokedAt: new Date() })
    .where(eq(porterTransferTokens.id, tokenId))
}
