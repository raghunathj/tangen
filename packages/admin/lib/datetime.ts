/**
 * File Name: datetime.ts
 * Purpose: Round-trip between a `datetime-local`-style wall-clock string
 *          ('YYYY-MM-DDTHH:mm', in the browser's LOCAL timezone) and the UTC
 *          ISO string we persist and compare on the server.
 *
 *          The admin lets an author pick a schedule in their own local time,
 *          but the API stores/compares instants in UTC (`formAvailability`
 *          compares `new Date(opensAt)` against server `new Date()`). These
 *          helpers make that conversion explicit and reversible so the value
 *          shown in the picker is the same wall-clock the author entered.
 *
 * Author: Raghunath J
 * License: MIT
 */

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * UTC ISO ('2026-07-12T04:30:00.000Z') → local wall-clock for a picker input
 * ('2026-07-12T10:00' in +05:30). Returns undefined for empty/invalid input.
 */
export function utcIsoToLocalInput(iso: string | undefined | null): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return undefined
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Local wall-clock from a picker input ('2026-07-12T10:00') → UTC ISO.
 * A datetime string without an offset is parsed as LOCAL time, then serialized
 * to UTC. Returns undefined for empty/invalid input.
 */
export function localInputToUtcIso(local: string | undefined | null): string | undefined {
  if (!local) return undefined
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString()
}

/** The browser's IANA timezone name (e.g. 'Asia/Kolkata'), for labeling. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'
  } catch {
    return 'local time'
  }
}
