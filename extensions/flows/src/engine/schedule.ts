/**
 * File Name: schedule.ts
 * Purpose: The schedule trigger's recurrence model + next-run calculator.
 *          Structured (frequency + time + days + IANA timezone) rather than
 *          raw cron - friendlier for the builder and lets us compute the next
 *          fire timezone-correctly via Intl (incl. DST), which the platform's
 *          server-time cron pass can't. Pure + deterministic: no Date.now()
 *          inside - the caller passes `from`.
 *
 * Author: Raghunath J
 * License: MIT
 */

export interface FlowSchedule {
  frequency: 'hourly' | 'daily' | 'weekly'
  /** Minute of the hour, 0–59 (default 0). */
  minute?: number
  /** Hour of the day, 0–23 (daily/weekly; default 9). */
  hour?: number
  /** Days to run (0=Sun…6=Sat) for 'weekly'; empty/omitted = every day. */
  daysOfWeek?: number[]
  /** IANA timezone, e.g. 'Asia/Kolkata'. Default 'UTC'. */
  timezone?: string
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const clampMinute = (m?: number) => Math.min(59, Math.max(0, Math.floor(m ?? 0)))
const clampHour = (h?: number) => Math.min(23, Math.max(0, Math.floor(h ?? 9)))

function partsInTz(date: Date, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(date)) if (part.type !== 'literal') p[part.type] = part.value
  return {
    y: +p.year, mo: +p.month - 1, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second,
    weekday: WEEKDAYS.indexOf(p.weekday),
  }
}

/** The tz's UTC offset (ms) at a given instant - wall clock minus UTC. */
function tzOffsetMs(date: Date, tz: string): number {
  const p = partsInTz(date, tz)
  return Date.UTC(p.y, p.mo, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000
}

/** The UTC instant for a wall-clock time in `tz` (DST-corrected, one step). */
function zonedToUtc(y: number, mo0: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo0, d, h, mi, 0)
  const offset = tzOffsetMs(new Date(guess), tz)
  return new Date(guess - offset)
}

/**
 * The next fire time strictly after `from`, per the recurrence, in its timezone.
 * Deterministic - `from` is supplied, nothing reads the clock here.
 */
export function nextRun(schedule: FlowSchedule, from: Date): Date {
  const tz = schedule.timezone || 'UTC'
  const minute = clampMinute(schedule.minute)

  if (schedule.frequency === 'hourly') {
    let t = Math.floor(from.getTime() / 3_600_000) * 3_600_000 + minute * 60_000
    while (t <= from.getTime()) t += 3_600_000
    return new Date(t)
  }

  const hour = clampHour(schedule.hour)
  const days = (schedule.frequency === 'weekly' && schedule.daysOfWeek?.length)
    ? [...new Set(schedule.daysOfWeek.map((x) => ((Math.floor(x) % 7) + 7) % 7))]
    : [0, 1, 2, 3, 4, 5, 6]   // daily = every day
  // Walk day-by-day in the target tz (up to 8 days covers any weekly gap + DST).
  const start = partsInTz(from, tz)
  for (let add = 0; add <= 8; add++) {
    const cand = zonedToUtc(start.y, start.mo, start.d + add, hour, minute, tz)
    if (cand <= from) continue
    if (days.includes(partsInTz(cand, tz).weekday)) return cand
  }
  return new Date(from.getTime() + 86_400_000)   // unreachable safety net
}

/** A human summary for the builder/run log, e.g. "Weekdays at 09:00 (Asia/Kolkata)". */
export function describeSchedule(schedule: FlowSchedule): string {
  const tz = schedule.timezone || 'UTC'
  const hh = String(clampHour(schedule.hour)).padStart(2, '0')
  const mm = String(clampMinute(schedule.minute)).padStart(2, '0')
  if (schedule.frequency === 'hourly') return `Every hour at :${mm} (${tz})`
  if (schedule.frequency === 'daily') return `Every day at ${hh}:${mm} (${tz})`
  const dw = schedule.daysOfWeek?.length ? schedule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6]
  const set = new Set(dw.map((x) => ((Math.floor(x) % 7) + 7) % 7))
  const label = [1, 2, 3, 4, 5].every((d) => set.has(d)) && set.size === 5
    ? 'Weekdays'
    : [...set].sort().map((d) => WEEKDAYS[d]).join(', ')
  return `${label} at ${hh}:${mm} (${tz})`
}
