/**
 * File Name: schedule-parser.ts
 * Purpose: Pure schedule evaluation for site-developer scheduled jobs —
 *          'every Nm|Nh|Nd' intervals and a 5-field cron subset
 *          (minute hour dom month dow; numbers, *, star-slash steps, lists).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: No dependencies (keeps site clones' lockfiles
 *          untouched). The scheduler ticks every 60s, so cron matching is
 *          minute-granular; isDue also guards on lastRun so a slow tick
 *          never double-fires an interval.
 */

const INTERVAL_RE = /^every\s+(\d+)\s*(m|h|d)$/i

/** Parses 'every 5m' | 'every 2h' | 'every 1d' → milliseconds, or null. */
export function parseInterval(schedule: string): number | null {
  const m = INTERVAL_RE.exec(schedule.trim())
  if (!m) return null
  const n = Number(m[1])
  if (n <= 0) return null
  const unit = m[2].toLowerCase()
  return n * (unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000)
}

/** One cron field: star, star-slash-n step, a single number, or a,b,c list. Null when invalid. */
function matchCronField(field: string, value: number, max: number): boolean | null {
  if (field === '*') return true
  const step = /^\*\/(\d+)$/.exec(field)
  if (step) {
    const n = Number(step[1])
    if (n <= 0) return null
    return value % n === 0
  }
  const parts = field.split(',')
  const nums: number[] = []
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    const n = Number(part)
    if (n > max) return null
    nums.push(n)
  }
  return nums.includes(value)
}

// ── IANA timezone support (Intl only — no dependencies) ──────────────────────

const _tzFormatters = new Map<string, Intl.DateTimeFormat>()

function tzFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = _tzFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      minute: 'numeric', hour: 'numeric', day: 'numeric', month: 'numeric', weekday: 'short',
    })
    _tzFormatters.set(timeZone, f)
  }
  return f
}

const WEEKDAY_NUM: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

interface WallClock { minute: number; hour: number; day: number; month: number; weekday: number }

/** The instant's wall-clock fields in an IANA zone. Throws on an invalid zone. */
function zonedParts(at: Date, timeZone: string): WallClock {
  const parts = tzFormatter(timeZone).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    minute: Number(get('minute')),
    hour: Number(get('hour')) % 24,        // some ICU builds emit '24' at midnight
    day: Number(get('day')),
    month: Number(get('month')),
    weekday: WEEKDAY_NUM[get('weekday')] ?? 0,
  }
}

/** True when the string names a real IANA timezone (e.g. 'Asia/Kolkata'). */
export function isValidTimezone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string') return false
  try {
    tzFormatter(timeZone)
    return true
  } catch {
    _tzFormatters.delete(timeZone)
    return false
  }
}

/**
 * Evaluates a 5-field cron expression against a Date (minute granularity).
 * With `timezone` (IANA name), fields are the wall clock IN THAT ZONE;
 * without it, the server's local time (the long-standing default).
 * Returns null for expressions outside the supported subset — and for an
 * invalid timezone, so a bad zone is never-due rather than wrong-time.
 */
export function matchesCron(schedule: string, at: Date, timezone?: string): boolean | null {
  const fields = schedule.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [min, hour, dom, month, dow] = fields

  let clock: WallClock
  if (timezone) {
    try {
      clock = zonedParts(at, timezone)
    } catch {
      return null
    }
  } else {
    clock = { minute: at.getMinutes(), hour: at.getHours(), day: at.getDate(), month: at.getMonth() + 1, weekday: at.getDay() }
  }

  const checks = [
    matchCronField(min, clock.minute, 59),
    matchCronField(hour, clock.hour, 23),
    matchCronField(dom, clock.day, 31),
    matchCronField(month, clock.month, 12),
    matchCronField(dow, clock.weekday, 6),
  ]
  if (checks.some((c) => c === null)) return null
  return checks.every((c) => c === true)
}

/** True when the schedule string parses as either syntax. */
export function isValidSchedule(schedule: string): boolean {
  return parseInterval(schedule) !== null || matchesCron(schedule, new Date(0)) !== null
}

/**
 * Decides whether a job is due at `now` given its last run.
 *
 * Intervals: due when now - lastRun >= interval (never run → due).
 * Cron: due when the current minute matches AND the job hasn't already run
 * in this minute (lastRun guard — the tick may fire twice within a minute
 * after clock drift or a slow previous tick).
 * Invalid schedules are never due.
 */
export function isDue(schedule: string, now: Date, lastRun: Date | null, timezone?: string): boolean {
  const interval = parseInterval(schedule)
  if (interval !== null) {
    if (!lastRun) return true
    return now.getTime() - lastRun.getTime() >= interval
  }
  const matches = matchesCron(schedule, now, timezone)
  if (matches === null || matches === false) return false
  if (!lastRun) return true
  const sameMinute =
    Math.floor(now.getTime() / 60_000) === Math.floor(lastRun.getTime() / 60_000)
  return !sameMinute
}
