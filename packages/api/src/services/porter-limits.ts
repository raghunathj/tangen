/**
 * File Name: porter-limits.ts
 * Purpose: S20a - transfer limits enforced BEFORE movement, with a byte
 *   inventory ("412 assets, 2.3 GB") instead of a failure at 96%. Defaults
 *   are sized for a small box (user decision 2026-08-08): 2 GB per run,
 *   500 MB per asset, 10,000 items - every instance can override via env.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: refusals are plain strings the routes wrap in a 422;
 *   both local runs and the Arc R receiver preflight use the same check.
 */
import { eq, and, inArray, sql } from 'drizzle-orm'
import { mediaAssets } from '@tangen/db'

export interface PorterLimits {
  maxRunBytes: number
  maxAssetBytes: number
  maxItems: number
}

export const DEFAULT_LIMITS: PorterLimits = {
  maxRunBytes: 2 * 1024 * 1024 * 1024,      // 2 GB
  maxAssetBytes: 500 * 1024 * 1024,         // 500 MB
  maxItems: 10_000,
}

/** Env overrides: TANGEN_PORTER_MAX_RUN_BYTES / MAX_ASSET_BYTES / MAX_ITEMS. */
export function resolvePorterLimits(env: Record<string, string | undefined> = process.env): PorterLimits {
  const num = (key: string, fallback: number): number => {
    const raw = env[key]
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return {
    maxRunBytes: num('TANGEN_PORTER_MAX_RUN_BYTES', DEFAULT_LIMITS.maxRunBytes),
    maxAssetBytes: num('TANGEN_PORTER_MAX_ASSET_BYTES', DEFAULT_LIMITS.maxAssetBytes),
    maxItems: num('TANGEN_PORTER_MAX_ITEMS', DEFAULT_LIMITS.maxItems),
  }
}

export interface RunInventory {
  items: number
  mediaCount: number
  mediaBytes: number
  largestAssetBytes: number
}

export function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${n} B`
}

/** Human-readable refusals; empty array = within limits. */
export function checkLimits(inv: RunInventory, limits: PorterLimits): string[] {
  const out: string[] = []
  if (inv.items > limits.maxItems) {
    out.push(`${inv.items.toLocaleString()} items exceeds the limit of ${limits.maxItems.toLocaleString()} per run`)
  }
  if (inv.mediaBytes > limits.maxRunBytes) {
    out.push(`${inv.mediaCount.toLocaleString()} media assets totalling ${fmtBytes(inv.mediaBytes)} exceed the ${fmtBytes(limits.maxRunBytes)} per-run limit`)
  }
  if (inv.largestAssetBytes > limits.maxAssetBytes) {
    out.push(`largest asset is ${fmtBytes(inv.largestAssetBytes)}, over the ${fmtBytes(limits.maxAssetBytes)} per-asset limit`)
  }
  return out
}

/**
 * Byte inventory for a media scope: specific asset ids, or the whole env
 * ('all'). One aggregate query.
 */
export async function computeMediaInventory(
  db: any,
  workspaceId: string,
  mediaIds: string[] | 'all',
): Promise<{ count: number; bytes: number; largest: number }> {
  if (Array.isArray(mediaIds) && mediaIds.length === 0) return { count: 0, bytes: 0, largest: 0 }
  const scope = [eq(mediaAssets.workspaceId, workspaceId)]
  if (Array.isArray(mediaIds)) scope.push(inArray(mediaAssets.id, mediaIds))
  const [row] = await db.select({
    count: sql<number>`COUNT(*)`,
    bytes: sql<number>`COALESCE(SUM(${mediaAssets.sizeBytes}), 0)`,
    largest: sql<number>`COALESCE(MAX(${mediaAssets.sizeBytes}), 0)`,
  }).from(mediaAssets).where(and(...scope))
  return { count: Number(row?.count ?? 0), bytes: Number(row?.bytes ?? 0), largest: Number(row?.largest ?? 0) }
}
