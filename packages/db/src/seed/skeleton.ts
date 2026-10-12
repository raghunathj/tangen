/**
 * File Name: skeleton.ts
 * Purpose: Seeds the minimum set of records required to run the platform locally —
 *   a workspace, an admin member, and a full-access API key.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires Bun runtime for password hashing (Bun.password.hash with
 *   argon2id). Run directly with `bun packages/db/src/seed/skeleton.ts` or import
 *   `seedSkeleton` programmatically. DATABASE_URL must be set in the environment.
 */
import { createHash } from 'node:crypto'
import { createDb } from '../client'
import { workspaces, members, apiKeys } from '../schema'

/** Stable ID for the local-dev workspace inserted by this seed. */
export const SEED_WORKSPACE_ID = 'wsp_local_dev'
/** Email address of the seeded admin member; password is "password". */
export const SEED_ADMIN_EMAIL = 'admin@example.com'
/** Stable member ID for the seeded admin user. */
export const SEED_ADMIN_MEMBER_ID = 'mem_seed_admin_001'
/** Stable API key record ID for the seeded full-access key. */
export const SEED_API_KEY_ID = 'key_seed_admin_001'
/** Raw (unhashed) value of the local-dev API key — never use in production. */
export const SEED_RAW_API_KEY = 'tgn_dev_seed_local_dev_0000001'
/** First 12 characters of the raw key, stored in the DB for display purposes. */
export const SEED_API_KEY_PREFIX = SEED_RAW_API_KEY.slice(0, 12)

/**
 * Inserts the minimal skeleton records needed to run the platform locally.
 * All inserts use `onConflictDoNothing` so the function is safe to call repeatedly.
 * @param db - Drizzle database client returned by `createDb`
 */
export async function seedSkeleton(db: ReturnType<typeof createDb>) {
  await db.insert(workspaces).values({
    id: SEED_WORKSPACE_ID,
    name: 'Local Dev',
    slug: 'local-dev',
  }).onConflictDoNothing()
  console.log(`✓ workspace    ${SEED_WORKSPACE_ID}`)

  const passwordHash = await Bun.password.hash('password', {
    algorithm: 'argon2id',
    memoryCost: 19456,
    timeCost: 2,
  })
  await db.insert(members).values({
    id: SEED_ADMIN_MEMBER_ID,
    workspaceId: SEED_WORKSPACE_ID,
    email: SEED_ADMIN_EMAIL,
    name: 'Admin',
    passwordHash,
    role: 'admin',
  }).onConflictDoNothing()
  console.log(`✓ member       ${SEED_ADMIN_EMAIL}  role=admin  password=password`)

  const keyHash = createHash('sha256').update(SEED_RAW_API_KEY).digest('hex')
  await db.insert(apiKeys).values({
    id: SEED_API_KEY_ID,
    workspaceId: SEED_WORKSPACE_ID,
    label: 'Local dev seed key (full-access)',
    keyPrefix: SEED_API_KEY_PREFIX,
    keyHash,
    permissions: { admin: true },
  }).onConflictDoNothing()
  console.log(`✓ api_key      ${SEED_API_KEY_PREFIX}...  (full-access)`)
  console.log(`  raw key: ${SEED_RAW_API_KEY}`)
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const db = createDb(url)
  await seedSkeleton(db)
  process.exit(0)
}
