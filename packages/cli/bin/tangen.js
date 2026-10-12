#!/usr/bin/env node
/**
 * File Name: tangen.js
 * Purpose: npm executes package bins with node, but the Tangen CLI must run
 *          under bun — it imports TypeScript configs (tangen.config.ts), uses
 *          Bun APIs, and relies on bun auto-loading the project's .env. This
 *          shim re-launches the real entry under bun.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts')

const probe = spawnSync('bun', ['--version'], { stdio: 'ignore' })
if (probe.error) {
  console.error('tangen: bun is required (https://bun.sh) — install it and re-run.')
  process.exit(1)
}
const res = spawnSync('bun', [entry, ...process.argv.slice(2)], { stdio: 'inherit' })
process.exit(res.status ?? 0)
