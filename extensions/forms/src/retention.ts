/**
 * File Name: form-retention.ts
 * Purpose: Personal-data retention — deletes form submissions older than a
 *   form's configured retentionDays. Runs on the scheduler tick (throttled to
 *   roughly once a day per process).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: purges ONLY forms whose settings.personalData
 *   .retentionDays is a positive number; everything else keeps data forever.
 */
import { and, eq, lt } from 'drizzle-orm'
import { forms, formSubmissions } from './tables'


/** UTC cutoff — submissions created before this are past retention. */
export function retentionCutoff(retentionDays: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)
}

/** Forms that opted into retention (positive retentionDays). */
export function formsWithRetention<T extends { settings: unknown }>(rows: T[]): T[] {
  return rows.filter((r) => {
    const days = (r.settings as any)?.personalData?.retentionDays
    return typeof days === 'number' && days > 0
  })
}

let lastRunAt = 0
const RUN_EVERY_MS = 24 * 60 * 60 * 1000

/**
 * Purges expired submissions for every retention-enabled form. Returns the
 * number of forms purged; throttles itself to one run per day.
 */
export async function purgeExpiredSubmissions(db: any, now: Date = new Date(), log: (message: string) => void = () => {}): Promise<number> {
  if (now.getTime() - lastRunAt < RUN_EVERY_MS) return 0
  lastRunAt = now.getTime()

  const rows = await db.select({ id: forms.id, settings: forms.settings }).from(forms)
  const targets = formsWithRetention(rows as Array<{ id: string; settings: unknown }>)
  for (const form of targets) {
    const days = (form.settings as any).personalData.retentionDays as number
    const cutoff = retentionCutoff(days, now)
    await db.delete(formSubmissions).where(and(
      eq(formSubmissions.formId, (form as any).id),
      lt(formSubmissions.createdAt, cutoff),
    ))
    log(`retention purge: form ${(form as any).id}, ${days} days`)
  }
  return targets.length
}
