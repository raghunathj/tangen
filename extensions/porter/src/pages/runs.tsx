/**
 * Porter - Runs page. Every movement run (sync, export, import) with live
 * progress, cancel, failure viewer and report/bundle downloads.
 */

import { useParams } from 'react-router-dom'
import { AdminPage } from '@/kit'
import { PorterRuns } from '@/components/porter-runs'

export function PorterRunsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  return (
    <AdminPage
      breadcrumbs={[{ label: 'Porter', href: `/${workspaceId}/extensions/porter` }, { label: 'Runs' }]}
      description="Background data movements: live progress, per-item results, CSV/JSONL reports and bundle downloads."
    >
      <div className="max-w-4xl">
        <PorterRuns />
      </div>
    </AdminPage>
  )
}
