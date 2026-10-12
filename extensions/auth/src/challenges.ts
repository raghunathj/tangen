/**
 * File Name: challenges.ts
 * Purpose: Short-lived secrets on the auth_challenges table: one-time codes,
 *          password reset tokens, SSO state. Stored hashed, expiring,
 *          consumed once; a sweep drops what expired. Nothing here needs
 *          Redis, so the extension works on the Postgres-only install.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { and, count, eq, gte, lt, sql } from 'drizzle-orm'
import type { ExtensionServerCtx } from '@tangen/cms'
import { authChallenges } from './tables'
import { dbOf } from './context'

export type ChallengeKind = 'otp' | 'password_reset' | 'sso_state'

export const OTP_TTL_SECONDS = 600
export const RESET_TTL_SECONDS = 3600
export const SSO_STATE_TTL_SECONDS = 600
/** Wrong guesses a code survives before it is thrown away. */
export const MAX_OTP_ATTEMPTS = 5

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/**
 * Constant-time comparison of two stored hashes.
 *
 * `!==` leaks where two hashes first differ. For the subject-less kinds
 * (password_reset, sso_state) the lookup is BY hash, so no comparison timing
 * is observable. For `otp` it is: the stored hash covers a SIX-DIGIT code, and
 * sha256 is unsalted, so an attacker who learns the stored hash brute-forces
 * 10^6 candidates offline in moments - which is the whole of MAX_OTP_ATTEMPTS
 * bypassed, without ever submitting a wrong guess.
 *
 * The channel is narrow through a request that also makes a database round
 * trip, so this is hardening rather than a demonstrated break. It is also the
 * pattern this codebase already uses where it matters - see
 * verifyWebhookToken in extensions/flows/src/server.ts - so the inconsistency
 * was the only reason not to.
 */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  // Length is not secret (both are fixed-width sha256 hex) and timingSafeEqual
  // throws on a mismatch, so it is checked first.
  return left.length === right.length && timingSafeEqual(left, right)
}

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex')
}

/** Stores a challenge; earlier live ones of the same kind and subject are replaced. */
export async function issueChallenge(ctx: ExtensionServerCtx, input: { kind: ChallengeKind; subject: string; secret: string; ttlSeconds: number; payload?: Record<string, unknown> }): Promise<void> {
  const db = dbOf(ctx)
  await db.delete(authChallenges).where(and(eq(authChallenges.workspaceId, ctx.workspaceId), eq(authChallenges.kind, input.kind), eq(authChallenges.subject, input.subject)))
  await db.insert(authChallenges).values({
    id: `ch_${randomBytes(8).toString('hex')}`,
    workspaceId: ctx.workspaceId,
    kind: input.kind,
    subject: input.subject,
    secretHash: hashSecret(input.secret),
    payload: input.payload ?? null,
    expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
  })
}

export type ConsumeResult =
  | { ok: true; payload: Record<string, unknown> | null }
  | { ok: false; reason: 'missing' | 'expired' | 'mismatch' | 'too_many_attempts' }

/**
 * Takes a challenge back. With a subject, the live challenge for it is the
 * candidate and a wrong secret counts an attempt (a code is guessable);
 * without one, the secret itself is the lookup (a reset token, an SSO
 * state) and a miss is simply a miss. A consumed challenge is deleted.
 */
export async function consumeChallenge(ctx: ExtensionServerCtx, input: { kind: ChallengeKind; subject?: string; secret: string }): Promise<ConsumeResult> {
  const db = dbOf(ctx)
  const where = input.subject !== undefined
    ? and(eq(authChallenges.workspaceId, ctx.workspaceId), eq(authChallenges.kind, input.kind), eq(authChallenges.subject, input.subject))
    : and(eq(authChallenges.workspaceId, ctx.workspaceId), eq(authChallenges.kind, input.kind), eq(authChallenges.secretHash, hashSecret(input.secret)))
  const [row] = await db.select().from(authChallenges).where(where).limit(1) as Array<typeof authChallenges.$inferSelect>
  if (!row) return { ok: false, reason: 'missing' }
  if (new Date(row.expiresAt) < new Date()) {
    await db.delete(authChallenges).where(eq(authChallenges.id, row.id))
    return { ok: false, reason: 'expired' }
  }
  if (!hashesMatch(row.secretHash, hashSecret(input.secret))) {
    const attempts = Number(row.attempts ?? '0') + 1
    if (attempts >= MAX_OTP_ATTEMPTS) {
      await db.delete(authChallenges).where(eq(authChallenges.id, row.id))
      return { ok: false, reason: 'too_many_attempts' }
    }
    await db.update(authChallenges).set({ attempts: String(attempts) }).where(eq(authChallenges.id, row.id))
    return { ok: false, reason: 'mismatch' }
  }
  await db.delete(authChallenges).where(eq(authChallenges.id, row.id))
  return { ok: true, payload: (row.payload as Record<string, unknown> | null) ?? null }
}

/** How many challenges of a kind were issued for a subject in the last `windowSeconds`. */
export async function recentChallengeCount(ctx: ExtensionServerCtx, kind: ChallengeKind, subject: string, windowSeconds: number): Promise<number> {
  const since = new Date(Date.now() - windowSeconds * 1000)
  const [row] = await dbOf(ctx).select({ n: count() }).from(authChallenges)
    .where(and(eq(authChallenges.workspaceId, ctx.workspaceId), eq(authChallenges.kind, kind), eq(authChallenges.subject, subject), gte(authChallenges.createdAt, since)))
  return Number(row?.n ?? 0)
}

export async function sweepExpiredChallenges(ctx: ExtensionServerCtx, now = new Date()): Promise<void> {
  await dbOf(ctx).delete(authChallenges).where(lt(authChallenges.expiresAt, now))
}

/** Test seam: the SQL fragment type re-exported so a fake db can recognise it. */
export const _sql = sql
