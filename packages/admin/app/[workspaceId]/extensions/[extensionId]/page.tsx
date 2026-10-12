/**
 * File Name: page.tsx
 * Purpose: The DEFAULT extension landing page. Any installed extension that
 *          doesn't declare its own admin page (e.g. a field-type / editor-panel
 *          extension like SEO) still gets a real screen here — an overview
 *          generated from its manifest (what it provides, version, whether it
 *          ships a server). This guarantees a sidebar entry never dead-ends.
 *          Extensions that declare a page override this via an explicit route.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { usePageHeader, adminFetch, ApiError, Card, Text, Badge, Skeleton, EmptyState } from '@/kit'
import { Slot } from '@/components/slot-mount'
import { ExtensionSettingsForm } from '@/components/extensions/extension-settings-form'

interface ExtensionOverview {
  id: string
  name: string
  version: string
  description?: string
  versionedData: boolean
  fieldTypes: { name: string; label: string; description?: string }[]
  sidebarPanels: { id: string; label: string }[]
  hasServer: boolean
  settings?: boolean
}

export default function ExtensionOverviewPage() {
  const { extensionId} = useParams<{ extensionId: string }>()
  const [data, setData] = useState<ExtensionOverview | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')

  usePageHeader({
    title: data?.name ?? 'Extension',
    description: data?.description,
  })

  useEffect(() => {
    let alive = true
    setState('loading')
    adminFetch<{ data: ExtensionOverview | null }>(`/extensions/${extensionId}`)
      .then((r) => { if (alive) { setData(r.data); setState(r.data ? 'ready' : 'missing') } })
      .catch((e) => { if (alive) setState(e instanceof ApiError && e.status === 404 ? 'missing' : 'missing') })
    return () => { alive = false }
  }, [extensionId])

  if (state === 'loading') {
    return <div className="p-6 max-w-3xl"><Skeleton variant="rows" rows={4} /></div>
  }
  if (state === 'missing' || !data) {
    return (
      <div className="p-6 max-w-3xl">
        <EmptyState title="Extension not found" description={`No installed extension matches “${extensionId}”.`} />
      </div>
    )
  }

  const provides =
    data.fieldTypes.length + data.sidebarPanels.length + (data.hasServer ? 1 : 0)

  return (
    <div className="p-6 max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <Text>{data.description ?? 'This extension does not provide its own admin screen - this is its default overview.'}</Text>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="neutral">v{data.version}</Badge>
        {data.versionedData && <Badge variant="neutral">Versioned data</Badge>}
        {data.hasServer && <Badge variant="neutral">Server (hooks / tasks)</Badge>}
      </div>

      {/* Extension Kernel K7.1/K7.2: the generated settings form, then what the extension itself adds to its overview. */}
      {data.settings && <ExtensionSettingsForm extensionId={data.id} title="Settings" description="What this extension lets you configure. Secrets are stored sealed and never shown again." />}
      <Slot name="admin.extension.overview@1" extensionId={data.id} context={{ extension: data.id }} />

      {provides === 0 && (
        <Card>
          <Text variant="help">This extension doesn’t contribute field types or editor panels.</Text>
        </Card>
      )}

      {data.fieldTypes.length > 0 && (
        <Card title="Field types" description="Custom fields this extension adds to your content model.">
          <ul className="divide-y divide-border">
            {data.fieldTypes.map((f) => (
              <li key={f.name} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-fg">{f.label}</span>
                  <code className="text-xs text-fg-subtle">{f.name}</code>
                </div>
                {f.description && <Text variant="help">{f.description}</Text>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.sidebarPanels.length > 0 && (
        <Card title="Editor panels" description="Panels this extension adds to the object editor sidebar.">
          <ul className="divide-y divide-border">
            {data.sidebarPanels.map((p) => (
              <li key={p.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center gap-2">
                <span className="font-medium text-fg">{p.label}</span>
                <code className="text-xs text-fg-subtle">{p.id}</code>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
