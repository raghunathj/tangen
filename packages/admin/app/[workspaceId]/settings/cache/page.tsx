

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { IconDatabase, IconTrash, IconRefresh, IconCheckCircle, IconCloseCircle } from '@tangen/icons'
import { adminFetch } from '@/lib/api'
import { usePageHeader } from '@/lib/page-header'
import { SettingsSection } from '@/components/settings/settings-section'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'

interface TypeDef {
  name: string
  label?: string
}

interface FlushResult {
  flushed: number
  scope: string
  typeSlug: string | null
}

interface CacheStats {
  redis: {
    connected: boolean
    usedMemory: number
    usedMemoryHuman: string
    maxMemory: number
    maxMemoryHuman: string
  }
  schemaCache: {
    key: string
    exists: boolean
    ttl: number
    hits: number
    misses: number
    hitRate: number
  }
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {

  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-xs text-fg-subtle mb-0.5">{label}</p>
      <p className="text-lg font-semibold text-fg">{value}</p>
      {sub && <p className="text-xs text-fg-subtle mt-0.5">{sub}</p>}
    </div>
  )
}

export default function CacheSettingsPage() {
  // Title comes from the Settings breadcrumb; the short info moves to the header
  usePageHeader({ description: 'Redis memory usage, schema cache performance, and flush controls' })

  const params = useParams<{ workspaceId: string }>()

  const [types, setTypes] = useState<TypeDef[]>([])
  const [stats, setStats] = useState<CacheStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [flushing, setFlushing] = useState<string | null>(null)

  const loadStats = useCallback(() => {
    setStatsLoading(true)
    adminFetch<{ data: CacheStats }>('/admin/cache/stats')
      .then((r) => setStats(r.data))
      .catch(() => {})
      .finally(() => setStatsLoading(false))
  }, [])

  useEffect(() => {
    loadStats()
    adminFetch<{ data: TypeDef[] }>('/types')
      .then((r) => setTypes(r.data))
      .catch(() => {})
  }, [loadStats])

  async function flush(scope: 'all' | 'type' | 'objects', typeSlug?: string) {
    const key = scope === 'type' ? typeSlug! : scope
    setFlushing(key)
    try {
      const result = await adminFetch<FlushResult>('/admin/cache/flush', {
        method: 'POST',
        body: JSON.stringify({ scope, typeSlug }),
      })
      const label = scope === 'all' ? 'Schema cache' : scope === 'objects' ? 'All object cache' : `Cache for "${typeSlug}"`
      toast.success(`${label} flushed`, `${result.flushed} key${result.flushed !== 1 ? 's' : ''} removed`)
      loadStats()
    } catch (e: any) {
      toast.error('Flush failed', e.message ?? 'Could not flush cache')
    } finally {
      setFlushing(null)
    }
  }

  // Only the stats shape renders as stats; anything else (an older server, an
  // unfixtured harness answer) reads as "could not load", never as a crash.
  const s = stats && typeof stats === 'object' && 'redis' in stats && 'schemaCache' in stats ? stats : null

  return (
    <div className="space-y-10">
      {/* ── Status dashboard ── */}
      <SettingsSection
        title="Status"
        description="Redis memory and the schema cache of this environment."
        actions={(
          <button
            type="button"
            onClick={loadStats}
            disabled={statsLoading}
            className="text-fg-subtle hover:text-fg-muted transition disabled:opacity-40"
            title="Refresh"
            aria-label="Refresh"
          >
            <IconRefresh className={`size-4 ${statsLoading ? 'animate-spin' : ''}`} />
          </button>
        )}
        summary={s ? (
          <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${s.redis.connected ? 'text-success-fg' : 'text-danger-fg'}`}>
            <IconDatabase className="size-4" />
            {s.redis.connected ? <IconCheckCircle className="size-3.5" /> : <IconCloseCircle className="size-3.5" />}
            Redis {s.redis.connected ? 'connected' : 'offline'}
          </span>
        ) : undefined}
        flush
      >
        {statsLoading && !s ? (
          <div className="px-5 py-6 text-sm text-fg-subtle">Loading…</div>
        ) : s ? (
          <div className="px-5 py-5 space-y-5">
            {/* Redis memory */}
            <div>
              <p className="text-xs font-medium text-fg-muted uppercase tracking-wide mb-2">Redis memory</p>
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="Used memory"
                  value={s.redis.usedMemoryHuman}
                  sub={s.redis.usedMemory.toLocaleString() + ' bytes'}
                />
                <StatCard
                  label="Max memory"
                  value={s.redis.maxMemoryHuman === 'noevict' ? 'No limit' : s.redis.maxMemoryHuman}
                  sub={s.redis.maxMemory === 0 ? 'no eviction policy set' : undefined}
                />
              </div>
            </div>

            {/* Schema cache */}
            <div>
              <p className="text-xs font-medium text-fg-muted uppercase tracking-wide mb-2">Schema cache - <code className="font-mono normal-case">{s.schemaCache.key}</code></p>
              <div className="grid grid-cols-4 gap-3">
                <StatCard
                  label="Status"
                  value={s.schemaCache.exists ? 'Warm' : 'Cold'}
                  sub={s.schemaCache.exists ? `TTL ${s.schemaCache.ttl}s` : 'not cached'}
                />
                <StatCard label="Hit rate" value={`${s.schemaCache.hitRate}%`} />
                <StatCard label="Hits" value={s.schemaCache.hits.toLocaleString()} />
                <StatCard label="Misses" value={s.schemaCache.misses.toLocaleString()} />
              </div>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 text-sm text-fg-subtle">Could not load stats.</div>
        )}
      </SettingsSection>

      {/* ── Schema cache flush ── */}
      <SettingsSection title="Schema cache" description="The schema is re-loaded from the database on the next API request and re-cached automatically.">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm text-fg">Flush the schema cache for this environment.</p>
            <p className="text-xs text-fg-subtle mt-0.5">
              Key: <code className="font-mono">tangen:schema</code>
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            isLoading={flushing === 'env'}
            onClick={() => flush('all')}
            className="shrink-0"
          >
            <IconTrash className="size-3.5 mr-1.5" />
            Flush schema cache
          </Button>
        </div>
      </SettingsSection>

      {/* ── Per-type object cache ── */}
      <SettingsSection
        title="Object cache - per type"
        description="Cached object reads, one namespace per type. Flush a type after a change outside the Admin."
        actions={(
          <Button
            variant="secondary"
            size="sm"
            isLoading={flushing === 'objects'}
            onClick={() => flush('objects')}
            className="shrink-0"
          >
            <IconTrash className="size-3.5 mr-1.5" />
            Flush all objects
          </Button>
        )}
        flush
      >
        {types.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-subtle italic">
            No object types found in this environment.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {types.map((t) => (
              <li key={t.name} className="px-5 py-3.5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-fg">{t.label ?? t.name}</p>
                  <p className="text-xs text-fg-subtle font-mono mt-0.5">
                    tangen:object:*:{t.name}:*
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  isLoading={flushing === t.name}
                  onClick={() => flush('type', t.name)}
                  className="shrink-0"
                >
                  <IconTrash className="size-3.5 mr-1.5" />
                  Flush
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="px-5 py-3 border-t border-border bg-surface-sunken">
          <p className="text-xs text-fg-subtle">
            Flushes schema cache and all cached object reads for the selected type in this environment.
          </p>
        </div>
      </SettingsSection>
    </div>
  )
}
