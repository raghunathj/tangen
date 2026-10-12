import { useEffect, useState } from 'react'
import { Callout } from '@tangen/ui'
import { useParams } from 'react-router-dom'
import { adminFetch } from '@/lib/api'
import { invalidateCachedGet } from '@/lib/api-cache'
import { usePageHeader } from '@/lib/page-header'
import { useDevMode } from '@/lib/use-dev-mode'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { SettingsSection } from '@/components/settings/settings-section'
import { useAuthStore } from '@/lib/auth'
import { KnowledgeOps } from '../knowledge/knowledge-ops'

interface ProviderInfo { name: string; available: boolean; models: string[]; imageModels?: string[] }
interface Guidelines { audience: string; voiceTone: string; glossary: string; legal: string; general: string }
interface GuidelineProfile { id: string; name: string; guidelines: Guidelines }
interface AISettings {
  provider: string | null
  model: string | null
  titleGeneration: boolean
  profiles: GuidelineProfile[]
  image?: { provider?: string | null; model?: string | null }
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
  kimi: 'Kimi (Moonshot)',
  qwen: 'Qwen (Alibaba)',
}

const GUIDELINE_SECTIONS: { key: keyof Guidelines; label: string; hint: string }[] = [
  { key: 'audience', label: 'Audience & context', hint: 'Who is this content for? What does the site cover?' },
  { key: 'voiceTone', label: 'Brand voice & tone', hint: 'How should the writing sound? E.g. friendly but precise, no exclamation marks.' },
  { key: 'glossary', label: 'Glossary', hint: 'Preferred terms and their meanings, one per line. E.g. "Tangen - always capitalised".' },
  { key: 'legal', label: 'Legal & compliance', hint: 'Claims to avoid, required disclaimers, regulated wording.' },
  { key: 'general', label: 'General instructions', hint: 'Anything else the AI should always follow.' },
]

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-fg mb-1">{children}</label>
}

export default function AISettingsPage() {
  // Title comes from the Settings breadcrumb; the short info moves to the header
  usePageHeader({ title: 'AI', description: 'Provider, guidelines, and image defaults - applies to the whole workspace' })

  const params = useParams<{ workspaceId: string }>()
  const devMode = useDevMode()
  const { member } = useAuthStore((s) => ({ member: s.member }))
  const canEdit = member?.role === 'owner' || member?.role === 'admin'

  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      adminFetch<{ data: { providers: ProviderInfo[] } }>('/admin/ai/providers'),
      adminFetch<{ data: AISettings }>('/admin/ai/settings'),
    ])
      .then(([p, s]) => {
        setProviders(p.data.providers)
        setSettings(s.data)
      })
      .catch((e: any) => toast.error('Failed to load AI settings', e.message))
      .finally(() => setLoading(false))
  }, [])

  function patch(update: Partial<AISettings>) {
    setSettings((s) => (s ? { ...s, ...update } : s))
  }

  const [activeProfile, setActiveProfile] = useState(0)

  function patchGuideline(key: keyof Guidelines, value: string) {
    setSettings((s) => {
      if (!s) return s
      const profiles = s.profiles.map((p, i) =>
        i === activeProfile ? { ...p, guidelines: { ...p.guidelines, [key]: value } } : p)
      return { ...s, profiles }
    })
  }

  function renameProfile(name: string) {
    setSettings((s) => {
      if (!s) return s
      const profiles = s.profiles.map((p, i) => (i === activeProfile ? { ...p, name } : p))
      return { ...s, profiles }
    })
  }

  function addProfile() {
    setSettings((s) => {
      if (!s) return s
      const profiles = [...s.profiles, {
        id: `p_${Math.random().toString(36).slice(2, 10)}`,
        name: `Profile ${s.profiles.length + 1}`,
        guidelines: { audience: '', voiceTone: '', glossary: '', legal: '', general: '' },
      }]
      setActiveProfile(profiles.length - 1)
      return { ...s, profiles }
    })
  }

  function removeProfile() {
    setSettings((s) => {
      if (!s || s.profiles.length <= 1) return s
      const profiles = s.profiles.filter((_, i) => i !== activeProfile)
      setActiveProfile(Math.max(0, activeProfile - 1))
      return { ...s, profiles }
    })
  }

  async function handleSave() {
    if (!settings) return
    setSaving(true)
    try {
      const r = await adminFetch<{ data: AISettings }>('/admin/ai/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      })
      // Other pages cache these for 60s - bust on save so changes show immediately.
      invalidateCachedGet('/admin/ai/settings')
      invalidateCachedGet('/admin/ai/providers')
      setSettings(r.data)
      toast.success('AI settings saved')
    } catch (e: any) {
      toast.error('Failed to save', e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-sm text-fg-subtle">Loading…</div>
  if (!settings) return <div className="p-8 text-sm text-danger-fg">Could not load AI settings.</div>

  const anyAvailable = providers.some((p) => p.available)
  const activeProvider = providers.find((p) => p.name === settings.provider)
  const imageCapable = providers.filter((p) => p.available && (p.imageModels?.length ?? 0) > 0)
  const activeImageProvider = imageCapable.find((p) => p.name === settings.image?.provider)
  const selectClass =
    'w-full border border-border rounded-lg px-3 py-2 text-sm text-fg bg-surface focus:outline-none focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25 disabled:bg-surface-sunken disabled:text-fg-subtle'


  return (
    // The workspace layout's <main> is overflow-hidden (pages own their scroll),
    // so this page needs its own scroll container or long content is clipped.
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="space-y-10">
      {!anyAvailable && (
        <Callout variant="warning">
          No AI provider is available. Ask your developer to add an API key
          (ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY) and enable providers in <code>app/config/ai.ts</code>.
        </Callout>
      )}

      {/* Provider */}
      <SettingsSection title="Provider" description="The model behind content generation and the editor's AI actions.">
        <div className="space-y-4">
          <div>
            <Label>AI provider</Label>
            <select
              className={selectClass}
              value={settings.provider ?? ''}
              disabled={!canEdit}
              onChange={(e) => patch({ provider: e.currentTarget.value || null, model: null })}
            >
              <option value="">Choose a provider…</option>
              {providers.map((p) => (
                <option key={p.name} value={p.name} disabled={!p.available}>
                  {PROVIDER_LABELS[p.name] ?? p.name}{!p.available ? ' - no API key' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Model</Label>
            <select
              className={selectClass}
              value={settings.model ?? ''}
              disabled={!canEdit || !activeProvider}
              onChange={(e) => patch({ model: e.currentTarget.value || null })}
            >
              <option value="">Provider default</option>
              {(activeProvider?.models ?? []).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={settings.titleGeneration}
              disabled={!canEdit}
              onChange={(e) => patch({ titleGeneration: e.currentTarget.checked })}
              className="rounded border-border-strong"
            />
            Allow AI title suggestions
          </label>
        </div>
      </SettingsSection>

      {/* Image generation */}
      <SettingsSection
        title="Image generation"
        description="Default provider for media-field images (editors can switch per chat). Only image-capable providers appear - Claude cannot draw."
      >
        <div className="space-y-4">
          {imageCapable.length === 0 ? (
            <p className="text-sm text-fg-subtle">
              No available provider supports image generation. Add an OpenAI or Gemini API key.
            </p>
          ) : (
            <>
              <div>
                <Label>Image provider</Label>
                <select
                  className={selectClass}
                  value={settings.image?.provider ?? ''}
                  disabled={!canEdit}
                  onChange={(e) => patch({ image: e.currentTarget.value ? { provider: e.currentTarget.value, model: null } : undefined })}
                >
                  <option value="">First available</option>
                  {imageCapable.map((p) => (
                    <option key={p.name} value={p.name}>{PROVIDER_LABELS[p.name] ?? p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Image model</Label>
                <select
                  className={selectClass}
                  value={settings.image?.model ?? ''}
                  disabled={!canEdit || !activeImageProvider}
                  onChange={(e) => patch({ image: { provider: settings.image?.provider ?? null, model: e.currentTarget.value || null } })}
                >
                  <option value="">Provider default</option>
                  {(activeImageProvider?.imageModels ?? []).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
      </SettingsSection>

      {/* Guideline profiles */}
      <SettingsSection
        title="Content guidelines"
        description="Included with every AI request. Create multiple profiles (e.g. Blog, Product pages) to steer different kinds of content - editors pick one when generating if more than one exists."
        flush
      >

        {/* Profile tabs */}
        <div className="px-5 pt-4 flex items-center gap-1.5 flex-wrap">
          {settings.profiles.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setActiveProfile(i)}
              className={
                i === activeProfile
                  ? 'px-3 py-1 rounded-full text-xs font-medium bg-accent-strong text-white'
                  : 'px-3 py-1 rounded-full text-xs font-medium bg-surface-hover text-fg-muted hover:bg-surface-hover'
              }
            >
              {p.name}
            </button>
          ))}
          {canEdit && (
            <button
              type="button"
              onClick={addProfile}
              className="px-2.5 py-1 rounded-full text-xs font-medium border border-dashed border-border-strong text-fg-subtle hover:text-accent-fg hover:border-accent/30"
            >
              + Add profile
            </button>
          )}
        </div>

        <div className="px-5 py-5 space-y-5">
          {canEdit && (
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Label>Profile name</Label>
                <input
                  type="text"
                  value={settings.profiles[activeProfile]?.name ?? ''}
                  onChange={(e) => renameProfile(e.currentTarget.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25"
                />
              </div>
              {settings.profiles.length > 1 && (
                <button
                  type="button"
                  onClick={removeProfile}
                  className="text-xs font-medium text-danger-fg hover:text-danger-fg pb-2.5"
                >
                  Delete profile
                </button>
              )}
            </div>
          )}

          {GUIDELINE_SECTIONS.map(({ key, label, hint }) => (
            <div key={key}>
              <Label>{label}</Label>
              <textarea
                value={settings.profiles[activeProfile]?.guidelines[key] ?? ''}
                disabled={!canEdit}
                onChange={(e) => patchGuideline(key, e.currentTarget.value)}
                placeholder={hint}
                rows={3}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25 disabled:bg-surface-sunken disabled:text-fg-subtle"
              />
            </div>
          ))}
        </div>
      </SettingsSection>

      {canEdit ? (
        <div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save AI settings'}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-fg-subtle">Only owners and admins can change AI settings.</p>
      )}

      <AiSurfacesCard />
      </div>
    </div>
  )
}

// ── AI Surfaces (read-only) ──────────────────────────────────────────────────
// MCP / Knowledge state resolved from CODE config — the admin shows it, the
// config files own it (app/config/mcp.ts, app/config/knowledge.ts).

interface SurfacesData {
  mcp: { installed: boolean; configured: boolean; enabled: boolean; write?: unknown; tools?: string[] | null }
  knowledge: { installed: boolean; configured: boolean; enabled: boolean; provider?: string | null; model?: string | null }
}

function AiSurfacesCard() {
  const devMode = useDevMode()
  const [data, setData] = useState<SurfacesData | null>(null)
  useEffect(() => {
    adminFetch<{ data: SurfacesData }>('/admin/ai/surfaces')
      .then((r) => setData(r.data))
      .catch(() => setData(null))
  }, [])
  if (!data) return null
  const mcpOn = data.mcp.enabled
  const kOn = data.knowledge.enabled
  return (
    <SettingsSection title="AI surfaces" description="What the platform exposes to agents and search." actions={<span className="text-xs text-fg-subtle">configured in code - see docs/mcp.md</span>}>
      <div className="space-y-3 text-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium text-fg">MCP server</p>
            <p className="text-xs text-fg-subtle mt-0.5">
              Agent tools at POST /api/v1/mcp · enable via <code className="font-mono">app/config/mcp.ts</code>
            </p>
          </div>
          <span className={mcpOn ? 'text-xs font-medium text-success' : 'text-xs text-fg-subtle'}>
            {data.mcp.installed ? (mcpOn ? 'Enabled' : 'Off (default)') : 'Package not installed'}
          </span>
        </div>
        {mcpOn && (
          <div className="rounded-md bg-surface-sunken border border-border">
            <div className="flex items-center justify-between px-3 py-2 text-xs">
              <span className="font-mono text-fg-muted">this deployment</span>
              <span className="text-success font-medium">{`on · write: ${String(data.mcp.write)}`}</span>
            </div>
          </div>
        )}
        <div className="flex items-start justify-between gap-4 pt-1">
          <div>
            <p className="font-medium text-fg">Knowledge (RAG)</p>
            <p className="text-xs text-fg-subtle mt-0.5">
              Semantic search & ask over your content{devMode ? <> · enable via <code className="font-mono">app/config/knowledge.ts</code> · backfill: <code className="font-mono">tangen knowledge index</code></> : '.'}
            </p>
          </div>
          <span className={kOn ? 'text-xs font-medium text-success' : 'text-xs text-fg-subtle'}>
            {data.knowledge.installed ? (kOn ? 'Enabled' : 'Off (default)') : 'Package not installed'}
          </span>
        </div>
        {kOn && (
          <div className="rounded-md bg-surface-sunken border border-border">
            <div className="flex items-center justify-between px-3 py-2 text-xs">
              <span className="font-mono text-fg-muted">this deployment</span>
              <span className="text-success font-medium">
                {`on · ${data.knowledge.provider ?? 'no provider!'}${data.knowledge.model ? `/${data.knowledge.model}` : ''}`}
              </span>
            </div>
          </div>
        )}
        {kOn && <KnowledgeOps />}
      </div>
    </SettingsSection>
  )
}


/** Test-search + reindex controls for the knowledge half (enabled envs only). */
