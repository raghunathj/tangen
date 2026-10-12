'use client'
/**
 * Renders a Builder Kit block tree with @tangen/studio-react, resolving any
 * kit.loop queries through the server route (the key never reaches the
 * browser). Used by the PREVIEW surface, which is necessarily a client
 * component; a published server-rendered page awaits resolveStudioData()
 * directly instead.
 */
import { useEffect, useState } from 'react'
import { StudioBlocks, collectLoopQueries, type BlockNode, type LoopData } from '@tangen/studio-react'
import '@tangen/studio-react/styles.css'
import { studioStylesUrl } from '../lib/studio-styles'

export function StudioSections({ blocks }: { blocks: BlockNode[] }) {
  const [loopData, setLoopData] = useState<LoopData>({})

  // Re-resolve whenever a loop's query changes - that is what makes the
  // Query Builder feel live: edit a filter in the admin, the listing here
  // refetches and re-renders.
  const specs = collectLoopQueries(blocks)
  const key = JSON.stringify(specs)

  useEffect(() => {
    if (specs.length === 0) { setLoopData({}); return }
    let alive = true
    fetch('/api/studio-loop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: key,
    })
      .then((r) => r.json())
      .then((d) => { if (alive) setLoopData(d as LoopData) })
      .catch(() => { if (alive) setLoopData(Object.fromEntries(specs.map((s) => [s.loopKey, { data: [], error: true }]))) })
    return () => { alive = false }
  }, [key])

  // The kit's own stylesheet ships with the package (imported above); THIS
  // one is generated per environment from the classes designers create in
  // Studio, which is why publishing styling needs no rebuild here.
  return (
    <>
      <link rel="stylesheet" data-tangen-published-styles="" href={studioStylesUrl()} />
      <StudioBlocks blocks={blocks} loopData={loopData} unknown="placeholder" />
    </>
  )
}
