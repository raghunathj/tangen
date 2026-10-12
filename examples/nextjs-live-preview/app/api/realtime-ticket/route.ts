/**
 * File Name: route.ts
 * Purpose: Mints a realtime connection ticket for the browser with the
 *          site's server-only API key, so the key never reaches the page.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Realtime R4 (docs/realtime.md "For a site"). A ticket
 *          is single-use and lives 60 seconds; the identity behind the
 *          connection is the key, so what the browser may subscribe to is
 *          exactly what the key may read (a read key hears
 *          `object.published`, a key with `objects:read_draft` also hears
 *          `object.updated`). No ?env= is needed: the key is bound to one
 *          environment. This route is Next-specific only in its export
 *          shape; the fetch is plain REST.
 */
import { NextResponse } from 'next/server'
import { API_URL } from '@/lib/tangen'

export const dynamic = 'force-dynamic'

export async function POST() {
  const apiKey = process.env.TANGEN_API_KEY ?? ''
  if (!apiKey) return NextResponse.json({ error: 'TANGEN_API_KEY is not set' }, { status: 503 })
  const res = await fetch(`${API_URL}/api/v1/realtime/ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: 'no-store',
  })
  if (!res.ok) return NextResponse.json({ error: `ticket mint failed (${res.status})` }, { status: 502 })
  const body = await res.json() as { data: { ticket: string; expiresIn: number } }
  return NextResponse.json({ ticket: body.data.ticket })
}
