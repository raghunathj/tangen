/**
 * File Name: db.ts
 * Purpose: Creates the singleton Drizzle database client and exposes it as an Elysia
 *          plugin so that every route handler receives a typed `db` context property.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The URL comes from lib/process-database.ts: DATABASE_URL,
 *                     then a pinned process's own variable, then the per-role
 *                     variables a scaffold writes. The localhost default is for
 *                     a fresh laptop only; a deployed process refuses to start
 *                     without a URL (plan T1.5).
 */
import Elysia from 'elysia'
import { createDb } from '@tangen/db'
import { resolveProcessDatabaseUrl } from '../lib/process-database'

/**
 * The ONE database this process holds, exported so a request for an
 * environment bound to a different one can be refused instead of silently
 * answered from this one (lib/env-database.ts).
 */
export const databaseUrl = resolveProcessDatabaseUrl(process.env)

export const db = createDb(databaseUrl)

export const dbPlugin = new Elysia({ name: 'db' })
  .decorate('db', db)
