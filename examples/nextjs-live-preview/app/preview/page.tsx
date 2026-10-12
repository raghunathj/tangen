import { Suspense } from 'react'
import { LivePreviewClient } from '@/components/LivePreviewClient'

// This is the route the admin's Preview button opens (frontend.previewUrl points here).
export const dynamic = 'force-dynamic'

export default function PreviewPage() {
  return (
    <Suspense fallback={<p className="empty">Loading preview…</p>}>
      <LivePreviewClient />
    </Suspense>
  )
}
