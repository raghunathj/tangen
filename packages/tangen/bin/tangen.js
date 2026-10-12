#!/usr/bin/env node
/**
 * File Name: tangen.js
 * Purpose: `npm i @tangen/cms` is all a backend project needs — the package
 *          carries the `tangen` bin and delegates to @tangen/cli (a regular
 *          dependency). One package to install, one CLI to run.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const cliPkgPath = require.resolve('@tangen/cli/package.json')
const cliPkg = require('@tangen/cli/package.json')
const binRel = typeof cliPkg.bin === 'string' ? cliPkg.bin : cliPkg.bin.tangen
const bin = join(dirname(cliPkgPath), binRel)

// The CLI always runs under bun: it imports TypeScript configs
// (tangen.config.ts), uses Bun APIs, and bun auto-loads the project's .env.
const probe = spawnSync('bun', ['--version'], { stdio: 'ignore' })
if (probe.error) {
  console.error('tangen: bun is required (https://bun.sh) — install it and re-run.')
  process.exit(1)
}
const res = spawnSync('bun', [bin, ...process.argv.slice(2)], { stdio: 'inherit' })
process.exit(res.status ?? 0)
