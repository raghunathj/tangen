/**
 * File Name: coverage.ts
 * Purpose: Which content types the review gate covers. An ADMIN-SAVED
 *          workflow (store row __workflow__ with configured: true) is the
 *          source of truth for coveredTypes; until one exists, coverage
 *          falls back to the code option (`requireReviewFor?: string[]`;
 *          absent or empty = every type). Content hooks do not receive
 *          options, so this module remembers them from every server surface
 *          that does (admin routes, events, tasks) and mirrors them into
 *          the store so the gate stays correct across process restarts.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: When options were never observed (fresh process, no
 *          route/event has run yet) the gate falls back to the DEFAULT
 *          semantics - all types covered - which matches absent options.
 *          The editor panel's state fetch runs on every editor load, so in
 *          practice options are remembered before any admin publish.
 */
import type { ContentHookCtx, ExtensionServerCtx } from '@tangen/types'
import { SETTINGS_LEGACY_KEY, SETTINGS_STORE_KEY } from '@tangen/types'
import {
  WORKFLOWS_KEY, applyOptionCoverage, migrateWorkflowSet, resolveWorkflowForType,
  type ReviewWorkflow, type WorkflowSet,
} from './workflows'
import { EXTENSION_ID, OPTIONS_KEY, WORKFLOW_KEY } from './state'

export interface CoverageOptions {
  /** Type names the gate covers; null = all types (the default). */
  requireReviewFor: string[] | null
}

/** Whoever can answer `settings.get()`: the server ctx, or the ctx the kernel hands a content hook (E.7). */
type SettingsReader = { settings?: { get<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<T> } }

function normalize(values: Record<string, unknown> | undefined): CoverageOptions {
  const raw = values?.requireReviewFor
  const list = Array.isArray(raw) ? raw.map(String).filter(Boolean) : null
  return { requireReviewFor: list && list.length > 0 ? list : null }
}

/**
 * The `requireReviewFor` setting as the gate reads it: the manifest setting
 * through `ctx.settings.get()`. A ctx without the accessor (a host that
 * declares no settings wiring) covers every type, the default.
 */
export async function coverageSettings(ctx: SettingsReader): Promise<CoverageOptions> {
  if (!ctx.settings) return { requireReviewFor: null }
  try { return normalize(await ctx.settings.get()) } catch { return { requireReviewFor: null } }
}

/**
 * E.7 migration, run once at START: the old install option was mirrored into
 * the store under OPTIONS_KEY for the hooks' sake. Carry that value into the
 * settings seed (SETTINGS_LEGACY_KEY, which the kernel folds into the settings
 * entry on the first read) unless a settings entry already exists, then drop
 * the mirror. Returns whether a mirror was found.
 */
export async function migrateOptionMirror(ctx: Pick<ExtensionServerCtx, 'store'>): Promise<boolean> {
  const mirror = await ctx.store.get(OPTIONS_KEY).catch(() => undefined)
  if (!mirror) return false
  const current = await ctx.store.get(SETTINGS_STORE_KEY).catch(() => undefined)
  if (!current) await ctx.store.put(SETTINGS_LEGACY_KEY, { requireReviewFor: normalize(mirror).requireReviewFor ?? [] })
  await ctx.store.remove(OPTIONS_KEY)
  return true
}

export function isTypeCovered(typeName: string, options: CoverageOptions): boolean {
  return options.requireReviewFor === null || options.requireReviewFor.includes(typeName)
}

export function isTypeInList(typeName: string, coveredTypes: string[] | null): boolean {
  return coveredTypes === null || coveredTypes.includes(typeName)
}

type HookCoverageCtx = Pick<ContentHookCtx, 'workspaceId' | 'extensionData' | 'settings'>

export async function readWorkflowSetForHook(ctx: HookCoverageCtx): Promise<WorkflowSet> {
  let rawSet: Record<string, unknown> | undefined
  let rawLegacy: Record<string, unknown> | undefined
  try { rawSet = await ctx.extensionData.get(EXTENSION_ID, WORKFLOWS_KEY) } catch { /* seed below */ }
  if (!Array.isArray(rawSet?.workflows) || (rawSet!.workflows as unknown[]).length === 0) {
    try { rawLegacy = await ctx.extensionData.get(EXTENSION_ID, WORKFLOW_KEY) } catch { /* seed below */ }
  }
  const { set } = migrateWorkflowSet(rawSet, rawLegacy)
  const options = await coverageSettings(ctx)
  return applyOptionCoverage(set, options.requireReviewFor)
}

export async function governingWorkflowForHook(
  ctx: HookCoverageCtx & Pick<ContentHookCtx, 'typeName'>,
): Promise<{ set: WorkflowSet; governing: ReviewWorkflow | null }> {
  const set = await readWorkflowSetForHook(ctx)
  return { set, governing: resolveWorkflowForType(set, ctx.typeName) }
}

export async function isCoveredForHook(ctx: HookCoverageCtx & Pick<ContentHookCtx, 'typeName'>): Promise<boolean> {
  const { governing } = await governingWorkflowForHook(ctx)
  return governing !== null
}
