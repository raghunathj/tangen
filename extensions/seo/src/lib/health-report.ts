/**
 * File Name: health-report.ts
 * Purpose: The SEO Manager's Dashboard numbers (plan-seo-manager-v2 V1),
 *          pure: one published object scored with the same checks the panel
 *          shows the editor (title length, description length over what is
 *          LIVE), the workspace summarised into a score, counts, coverage per
 *          type and the objects that need attention. Real data or nothing:
 *          an empty workspace has no score, not a fake one.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { analyzeTitleLength, analyzeMetaDescLength, computeOverallScore, type SeoScore } from './seo-analysis'
import type { SeoMetadata } from '../contract'

/** Whether the object carries metadata at all, and how much of it. */
export type CoverageState = 'optimised' | 'missing-description' | 'no-metadata'

export interface ScoredObject {
  id: string
  type: string
  title: string
  score: SeoScore
  state: CoverageState
  /** The checks that are not good, in the panel's words. */
  issues: string[]
}

export interface TypeCoverage {
  type: string
  total: number
  optimised: number
  missingDescription: number
  noMetadata: number
}

export interface HealthServices {
  sitemap: { entries: number; pageCount: number; truncated: boolean }
  robots: { served: boolean }
  llmsTxt: { enabled: boolean }
  searchConsole: { connected: boolean }
}

export interface HealthReport {
  generatedAt: string
  scanned: number
  /** 0..100 over the scanned objects; null when nothing was scanned. */
  score: number | null
  counts: Record<SeoScore, number>
  coverage: TypeCoverage[]
  services: HealthServices
}

export const HEALTH_REPORT_KEY = 'health-report'
const POINTS: Record<SeoScore, number> = { good: 100, ok: 60, poor: 0 }

/** One published object under the panel's own checks, over its LIVE metadata (the published snapshot, never a draft). */
export function scoreObject(input: { id: string; type: string; title: string | null; metadata: Pick<SeoMetadata, 'title' | 'description'> | null }): ScoredObject {
  const seoTitle = input.metadata?.title?.trim() ?? ''
  const description = input.metadata?.description?.trim() ?? ''
  const title = seoTitle || (input.title ?? '').trim()
  const checks = [analyzeTitleLength(title), analyzeMetaDescLength(description)]
  const state: CoverageState = !seoTitle && !description ? 'no-metadata' : !description ? 'missing-description' : 'optimised'
  return {
    id: input.id, type: input.type, title: title || input.id,
    score: computeOverallScore(checks), state,
    issues: checks.filter((c) => c.score !== 'good').map((c) => c.message),
  }
}

/** The workspace over its scored objects. */
export function summarizeHealth(objects: readonly ScoredObject[]): Pick<HealthReport, 'scanned' | 'score' | 'counts' | 'coverage'> {
  const counts: Record<SeoScore, number> = { good: 0, ok: 0, poor: 0 }
  const byType = new Map<string, TypeCoverage>()
  for (const o of objects) {
    counts[o.score] += 1
    const c = byType.get(o.type) ?? { type: o.type, total: 0, optimised: 0, missingDescription: 0, noMetadata: 0 }
    c.total += 1
    if (o.state === 'optimised') c.optimised += 1
    else if (o.state === 'missing-description') c.missingDescription += 1
    else c.noMetadata += 1
    byType.set(o.type, c)
  }
  const scanned = objects.length
  const score = scanned ? Math.round(objects.reduce((sum, o) => sum + POINTS[o.score], 0) / scanned) : null
  return { scanned, score, counts, coverage: [...byType.values()].sort((a, b) => b.total - a.total) }
}

/** The tone a score reads in, the panel's own thresholds. */
export function scoreTone(score: number | null): SeoScore | null {
  if (score === null) return null
  return score >= 80 ? 'good' : score >= 50 ? 'ok' : 'poor'
}
