/**
 * File Name: page.tsx
 * Purpose: A published page, rendered from the Delivery Layer.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This is the cutover. Delivery is asked FIRST, so the
 *          production visitor path reads an immutable versioned artifact from
 *          a platform route and never touches the authoring API - which is
 *          what lets a designer publish without this app being rebuilt, and
 *          what keeps the page up when Studio is disabled.
 *
 *          The CMS read stays as a fallback rather than being deleted. Pages
 *          published before the cutover have no artifact yet, and a demo that
 *          404'd on them would look like the delivery layer had lost them.
 *          The fallback also covers the honest case where a site publishes
 *          content through the API without Studio involved at all.
 *
 *          The stylesheet is linked through this site's own proxy, so the
 *          workspace id never reaches page source.
 */
import { notFound } from 'next/navigation'
import { StudioPage } from '@tangen/studio-react'
import '@tangen/studio-react/styles.css'
import { getPublishedBySlug } from '@/lib/tangen'
import { publishedPage, DELIVERY_PROXY } from '@/lib/studio-delivery'
import { EntryView } from '@/components/EntryView'

export const dynamic = 'force-dynamic'

export default async function PageBySlug({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const route = `/${decodeURIComponent(slug)}`

  const delivered = await publishedPage(route)
  if (delivered) {
    // baseUrl is empty and the mount is this site's proxy: the browser fetches
    // the stylesheet same-origin, and the workspace stays server-side.
    return <StudioPage page={delivered} baseUrl="" mount={DELIVERY_PROXY} unknown="placeholder" />
  }

  const entry = await getPublishedBySlug('page', decodeURIComponent(slug))
  if (!entry) notFound()
  return <EntryView entry={entry} />
}
