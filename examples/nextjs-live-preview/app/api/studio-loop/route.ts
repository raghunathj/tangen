/**
 * Resolves kit.loop queries for the preview surface.
 *
 * <StudioBlocks/> renders synchronously and the preview page is a CLIENT
 * component (it streams unsaved edits over postMessage), so the loop specs
 * cannot be awaited during render and the browser must never hold the API
 * key. This route is the server half: the client posts the spec collected by
 * collectLoopQueries(), and the key stays here.
 *
 * A published page (app/pages/[slug]) has no such constraint - it is a server
 * component and calls resolveStudioData() directly.
 */
import { NextResponse } from 'next/server'
import { API_URL } from '@/lib/tangen'

export const dynamic = 'force-dynamic'

/** The TangenQL body a loop spec becomes - see docs/tangenql.md. */
function toQueryBody(spec: {
  query?: Record<string, unknown>
  sort?: { field: string; direction: 'asc' | 'desc' }
  limit?: number
}) {
  return {
    status: 'published',
    ...(spec.query && Object.keys(spec.query).length > 0 ? { query: spec.query } : {}),
    ...(spec.sort ? { sort: spec.sort } : {}),
    limit: spec.limit ?? 10,
    depth: 1,
  }
}

export async function POST(req: Request) {
  const specs = (await req.json().catch(() => null)) as Array<{
    loopKey: string
    source: string
    query?: Record<string, unknown>
    sort?: { field: string; direction: 'asc' | 'desc' }
    limit?: number
  }> | null

  if (!Array.isArray(specs)) {
    return NextResponse.json({ error: 'expected an array of loop specs' }, { status: 400 })
  }

  const entries = await Promise.all(specs.map(async (spec) => {
    try {
      const res = await fetch(`${API_URL}/api/v1/objects/${encodeURIComponent(spec.source)}/query`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.TANGEN_API_KEY ?? ''}`,
        },
        body: JSON.stringify(toQueryBody(spec)),
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
      const json = await res.json()
      return [spec.loopKey, { data: json?.data ?? [], meta: { total: json?.meta?.total } }]
    } catch (err) {
      // One failing query degrades its own loop to the error slot; the rest
      // of the page still renders.
      console.error('[studio-loop]', spec.source, err)
      return [spec.loopKey, { data: [], error: true }]
    }
  }))

  return NextResponse.json(Object.fromEntries(entries))
}
