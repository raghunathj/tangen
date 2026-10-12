/**
 * File Name: runtime-extension-page.tsx
 * Purpose: The route an installed extension's pages mount on at runtime
 *          (Extension Kernel K7.3): `extensions/:extensionId/*` resolves the
 *          page from the merged extension UI by its path, behind the same
 *          gate build-time pages use (installed + active, then the page's
 *          access rule). A path no page claims is an empty state, not a
 *          crash.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { EmptyState } from '@/kit'
import { ExtensionPageGate } from '@/components/extension-page-gate'
import { useExtensionUi } from '@/lib/extension-ui'

export function RuntimeExtensionPage() {
  const params = useParams<{ workspaceId: string; extensionId: string; '*': string }>()
  const ui = useExtensionUi(params.workspaceId)
  const extensionId = params.extensionId!
  const rel = (params['*'] ?? '').replace(/\/+$/, '')
  const page = (ui.pages[extensionId] ?? []).find((p) => p.path.replace(/\/+$/, '') === rel)
  if (!page) {
    return <div className="p-6 max-w-3xl"><EmptyState title="Nothing here" description={`No page of the extension “${extensionId}” answers this address.`} /></div>
  }
  const Page = page.component
  return (
    <ExtensionPageGate extensionId={extensionId} access={page.access}>
      <Suspense fallback={null}><Page /></Suspense>
    </ExtensionPageGate>
  )
}
