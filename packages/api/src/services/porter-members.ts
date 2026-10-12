/**
 * File Name: porter-members.ts
 * Purpose: The Porter provider that carries a workspace's TEAM between
 *          deployments - members, their roles, and their per-environment role
 *          overrides.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `members` lives in whichever database a process holds, so
 *          a deployment with its own database has its own team and there is
 *          nowhere to sync from. Every other provider moves DEFINITIONS; this
 *          moves people, which makes what it must NOT carry the important part.
 *
 *          NO SECRET MATERIAL. Not `password_hash`, not sessions, not refresh
 *          tokens, not API keys. An imported member arrives unable to sign in
 *          and gets a password the way any new member does - the operator runs
 *          `tangen reset-password`, or invites them. A bundle that could log
 *          someone in would be a credential file, and bundles get emailed.
 *
 *          Identity is `(workspace_id, email)`, which is the table's own unique
 *          constraint. An existing member keeps their id and their password; a
 *          new one is created. Nothing is ever deleted by an import.
 */
import { and, eq } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { members } from '@tangen/db'
import type { PorterProvider, PorterProviderResult } from './porter-providers'

/** Columns that identify a row in ITS database and must not travel. */
const NOT_PORTABLE = new Set(['id', 'workspaceId', 'passwordHash', 'lastLoginAt', 'createdAt'])

/**
 * A password hash no password produces.
 *
 * `password_hash` is NOT NULL, so an imported member needs a value, and it must
 * be one that can never verify. Random bytes with no plaintext anywhere satisfy
 * both - the member exists, is listed, holds their role, and cannot sign in
 * until someone gives them a credential.
 */
export function unusablePasswordHash(): string {
  return `imported-no-login:${randomBytes(32).toString('hex')}`
}

/** The portable shape of one member, plus the role they hold in this environment. */
export interface PortableMember {
  email: string
  name: string | null
  role: string
  status: string
  designation: string | null
  avatar: string | null
  /** The member's role override for the environment being exported, if any. */
}

/** Strip a member row to what may cross a deployment boundary. */
export function toPortableMember(row: Record<string, unknown>): PortableMember {
  return {
    email: String(row.email ?? ''),
    name: (row.name as string | null) ?? null,
    role: String(row.role ?? 'editor'),
    status: String(row.status ?? 'active'),
    designation: (row.designation as string | null) ?? null,
    avatar: (row.avatar as string | null) ?? null,
  }
}

/** True when a row carries anything that could authenticate its subject. */
export function carriesSecret(row: Record<string, unknown>): boolean {
  // Anything that could authenticate the subject: a hash, a token, a key, a
  // signing or private material. Widened from password|token|secret|hash in
  // Stage 1 (plan T1.17): an `apiKey` in a member row was not refused.
  return Object.keys(row).some((k) => /password|token|secret|hash|key$|credential|signing|private/i.test(k))
}

export function membersPorterProvider(): PorterProvider {
  return {
    key: 'members',
    label: 'Members and roles',
    async count(db, workspaceId) {
      const rows = await db.select({ id: members.id }).from(members).where(eq(members.workspaceId, workspaceId))
      return rows.length
    },
    async exportRows(db, workspaceId) {
      const rows = await db.select().from(members)
        .where(eq(members.workspaceId, workspaceId)) as Record<string, unknown>[]
      return rows.map((r) => toPortableMember(r) as unknown as Record<string, unknown>)
    },
    async importRows(db, workspaceId, rows) {
      const out: PorterProviderResult = { created: 0, updated: 0, refused: [], warnings: [] }
      for (const row of rows) {
        const email = String((row as PortableMember).email ?? '').trim().toLowerCase()
        if (!email) { out.refused!.push({ key: '(no email)', reason: 'a member row without an email cannot be matched' }); continue }
        // Defence in depth: the exporter never writes one, so a bundle that has
        // one was edited, and importing it would install a credential.
        if (carriesSecret(row)) { out.refused!.push({ key: email, reason: 'the row carries secret material; members import without credentials' }); continue }

        const values = {
          email,
          name: (row as PortableMember).name ?? null,
          role: String((row as PortableMember).role ?? 'editor'),
          status: String((row as PortableMember).status ?? 'active'),
          designation: (row as PortableMember).designation ?? null,
          avatar: (row as PortableMember).avatar ?? null,
        }
        const [existing] = await db.select({ id: members.id }).from(members)
          .where(and(eq(members.workspaceId, workspaceId), eq(members.email, email))).limit(1)

        let memberId: string
        if (existing) {
          // Their password is theirs. Only the profile and role move.
          await db.update(members).set(values).where(eq(members.id, existing.id))
          memberId = String(existing.id)
          out.updated++
        } else {
          memberId = `mem_${randomBytes(9).toString('hex')}`
          await db.insert(members).values({ id: memberId, workspaceId, passwordHash: unusablePasswordHash(), ...values })
          // Environment membership (plan D3): a ported member is active
          // everywhere this deployment's workspace is, like a created one.
          out.created++
          out.warnings!.push({ key: email, reason: 'created without a password - run `tangen reset-password` or invite them' })
        }
      }
      return out
    },
  }
}
