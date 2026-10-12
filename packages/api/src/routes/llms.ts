/**
 * File Name: llms.ts
 * Purpose: Serve the generated AI-context bundles at stable, public URLs —
 *   GET /llms.txt (curated index) and GET /llms-full.txt (full doc bundle) — so
 *   an AI coding tool pointed at a running Tangen can load its conventions.
 *   Files are produced by scripts/build-llms.ts from docs/. Part of Layer 1
 *   (tasks/plan-ai-native-dx.md, L1-1).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, Bun.file (async, no sync fs on the request path).
 *   Public — registered before authMiddleware. Missing file → 404 with a hint
 *   to run the generator.
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Elysia } from 'elysia'

// packages/api/src/routes → repo root is four levels up.
const DOCS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../..', 'docs')

/** Stream a docs/ text file as text/plain, or 404 if it hasn't been generated. */
async function serveDoc(name: 'llms.txt' | 'llms-full.txt'): Promise<Response> {
  const file = Bun.file(join(DOCS_DIR, name))
  if (!(await file.exists())) {
    return new Response(
      `${name} has not been generated. Run: bun scripts/build-llms.ts`,
      { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    )
  }
  return new Response(await file.text(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

/** Registers GET /llms.txt and GET /llms-full.txt (public AI-context bundles). */
export const llmsRoute = (app: Elysia) =>
  app
    .get('/llms.txt', () => serveDoc('llms.txt'))
    .get('/llms-full.txt', () => serveDoc('llms-full.txt'))
