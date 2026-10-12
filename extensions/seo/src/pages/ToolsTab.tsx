/**
 * File Name: ToolsTab.tsx
 * Purpose: Tools (plan-seo-manager-v2 V7): the four things an operator needs
 *          occasionally - see what robots.txt serves, retire the cached
 *          answers after changing something outside Tangen, and move
 *          redirects in and out as a spreadsheet. Every one of them is a
 *          route that already governs itself; this page only asks.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AdminPage, Button, Callout, FormSection, Input, Textarea, Text, adminFetch, adminFetchFile, toast, useCan, TEXT_LINK } from '@/kit'
import { IconRefresh } from '@tangen/icons'
import { REDIRECT_CSV_HEADER } from '../lib/redirects-csv'
import { seoManagerHref } from '../lib/seo-manager-nav'

interface ImportReport {
  read: number
  written: number
  malformed: Array<{ line: number; message: string }>
  refused: Array<{ source: string; reason: string }>
}

export function SeoToolsPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const { hasCapability } = useCan()
  const mayWrite = hasCapability('seo:write')

  const [robots, setRobots] = useState<{ body: string; role: string | null; path: string } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [csv, setCsv] = useState('')
  const [importing, setImporting] = useState(false)
  const [report, setReport] = useState<ImportReport | null>(null)

  useEffect(() => {
    let alive = true
    adminFetch<{ data: { body: string; role: string | null; path: string } }>('/admin/ext/seo/robots-preview')
      .then((r) => { if (alive) setRobots(r.data) })
      .catch(() => { if (alive) setRobots(null) })
    return () => { alive = false }
  }, [])

  const refresh = async () => {
    setRefreshing(true)
    try {
      const r = await adminFetch<{ data: { version: number } }>('/admin/ext/seo/refresh-caches', { method: 'POST' })
      toast.success(`Cached answers retired (version ${r.data.version})`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The caches could not be refreshed')
    } finally { setRefreshing(false) }
  }

  const runImport = async () => {
    setImporting(true); setReport(null)
    try {
      const r = await adminFetch<{ data: ImportReport }>('/admin/ext/seo/redirects/import', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv }),
      })
      setReport(r.data)
      if (r.data.written) toast.success(`${r.data.written} redirect${r.data.written === 1 ? '' : 's'} imported`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The file could not be imported')
    } finally { setImporting(false) }
  }

  return (
    <AdminPage title="Tools" description="Occasional jobs: what robots.txt serves, cached answers, and redirects as a spreadsheet." access={{ capability: 'seo:read' }}>
      <div className="space-y-6">
        <FormSection title="robots.txt" description={robots?.role ? `What the public route serves for a ${robots.role} deployment.` : 'What the public route serves.'}>
          <Textarea rows={8} readOnly value={robots?.body ?? ''} className="resize-none font-mono text-xs" aria-label="robots.txt as served" />
          <div className="flex items-center gap-2">
            <Input readOnly value={robots?.path ?? ''} aria-label="The robots.txt route" className="max-w-md font-mono text-xs" />
            <Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(robots?.path ?? ''); toast.success('Path copied') }}>Copy</Button>
          </div>
          <Text variant="help">
            The directives come from <Link className={TEXT_LINK} to={seoManagerHref(workspaceId, 'settings')}>Settings</Link>, and a non-production deployment serves the guarded version instead.
          </Text>
        </FormSection>

        <FormSection title="Cached answers" description="Tangen caches the resolved metadata, the sitemaps and llms.txt, and retires them when content is published.">
          <div>
            <Button size="sm" variant="secondary" icon={<IconRefresh className="size-3.5" />} disabled={!mayWrite || refreshing} onClick={refresh}>
              {refreshing ? 'Refreshing' : 'Refresh caches'}
            </Button>
          </div>
          <Text variant="help">Use it after changing something Tangen cannot see, such as a URL your application builds differently. It costs one rebuild per answer, nothing more.</Text>
        </FormSection>

        <FormSection title="Redirects as a spreadsheet" description="Three columns: from, to, status. The same rules apply as in the redirect form, so a refused row says why.">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => { void download() }}>Export CSV</Button>
            <Text variant="help">{REDIRECT_CSV_HEADER}</Text>
          </div>
          <Textarea
            rows={6}
            value={csv}
            onChange={(e) => setCsv((e.target as HTMLTextAreaElement).value)}
            placeholder={`${REDIRECT_CSV_HEADER}\n/old-page,https://example.com/new-page,301`}
            className="resize-none font-mono text-xs"
            aria-label="Redirects to import"
            disabled={!mayWrite}
          />
          <div>
            <Button size="sm" disabled={!mayWrite || importing || !csv.trim()} onClick={runImport}>{importing ? 'Importing' : 'Import CSV'}</Button>
          </div>
          {report && (
            <Callout variant={report.malformed.length || report.refused.length ? 'warning' : 'success'} title={`${report.written} of ${report.read} rows imported`}>
              {report.malformed.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {report.malformed.slice(0, 10).map((m) => <li key={m.line}>{`Line ${m.line}: ${m.message}`}</li>)}
                </ul>
              )}
              {report.refused.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {report.refused.slice(0, 10).map((r) => <li key={r.source}>{`${r.source}: ${r.reason}`}</li>)}
                </ul>
              )}
              {report.malformed.length === 0 && report.refused.length === 0 && 'Every row was read and written.'}
            </Callout>
          )}
        </FormSection>
      </div>
    </AdminPage>
  )
}

/** The export is a file the browser saves; the route names it. */
async function download() {
  try {
    const res = await adminFetchFile('/admin/ext/seo/redirects/export', { headers: { accept: 'text/csv' } })
    const url = URL.createObjectURL(await res.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = 'redirects.csv'
    link.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'The file could not be exported')
  }
}
