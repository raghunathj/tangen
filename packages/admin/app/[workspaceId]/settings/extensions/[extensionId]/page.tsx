/**
 * File Name: page.tsx (settings/extensions/[extensionId])
 * Purpose: Settings → Extensions → <id> (E.17): the generated settings form
 *          of one extension, to the Admin's settings-page standard - the
 *          extension's name in the header with the breadcrumb ending in it,
 *          Save as a header action, the fields as a plain section.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ExtensionSettingsForm } from '@/components/extensions/extension-settings-form'
import { DynamicIcon } from '@/components/dynamic-icon'
import { adminFetch } from '@/lib/api'
import { usePageHeader } from '@/lib/page-header'
import type { ExtensionRow } from '@/lib/extension-inventory'

export default function ExtensionSettingsPage() {
  const { workspaceId, extensionId = '' } = useParams<{ workspaceId: string; extensionId: string }>()
  const [ext, setExt] = useState<ExtensionRow | null>(null)
  useEffect(() => {
    // The workspace's own installations, which is what the parent list shows:
    // an extension that is installed and switched OFF still has settings, and
    // the active-extensions list would not name it.
    adminFetch<{ data: ExtensionRow[] }>(`/admin/workspaces/${workspaceId}/extensions`)
      .then((r) => setExt((r.data ?? []).find((e) => e.extensionId === extensionId) ?? null))
      .catch(() => setExt(null))
  }, [extensionId, workspaceId])
  const name = ext?.name ?? extensionId
  usePageHeader({
    icon: <DynamicIcon name={ext?.icon ?? 'IconPuzzle'} className="size-4" />,
    breadcrumbs: [
      { label: 'Settings', href: `/${workspaceId}/settings` },
      { label: 'Extensions', href: `/${workspaceId}/settings/extensions` },
      { label: name },
    ],
    description: 'Secrets are sealed at rest and never shown again. A setting that needs a permission this installation was not granted is unavailable until it is approved.',
  }, [name, ext?.icon, workspaceId])
  return <ExtensionSettingsForm extensionId={extensionId} actions="header" />
}
