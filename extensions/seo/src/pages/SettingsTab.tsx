/**
 * File Name: SettingsTab.tsx
 * Purpose: The SEO Manager's Settings tab (plan-seo-next Phase 1). The form over
 *          the workspace-level SEO settings served by GET/POST
 *          /admin/ext/seo/site-settings - the hybrid-config half an editor can
 *          change, saved one GROUP at a time
 *          without a code deploy. Built entirely on the Lightfield kit (@/kit):
 *          Section/Panel/FormRow, Input/Textarea/Select/Toggle - the
 *          section's name sits ABOVE its card, so a heading reads as a heading
 *          rather than competing with the fields under it. Save and Reset live
 *          in the page header (the page scrolls past a screen) and Save is
 *          offered only while the form differs from what the server sent. The
 *          server codec (normalizeSettings) is the source of truth; this renders
 *          it and sends it back, never re-authoring the rules.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @/kit only, no raw form elements (kit-lint). No em dashes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  adminFetch, useCan, toast, usePageHeaderActions,
  Section, Panel, FormRow,
  Input, Textarea, Select, SelectItem, Toggle, Button, Callout, Skeleton, Text,
  ExtensionSettingsForm,
} from '@/kit'
import { parseSameAs, SEO_SETTINGS_GROUPS } from '../lib/settings'
import type { SeoSettings, SeoSettingsGroup } from '../lib/settings'

/**
 * NOT `/admin/ext/seo/settings`: core serves that path itself for any
 * extension whose manifest declares typed settings, and SEO declares the
 * Search Console ones - so this page was handed the manifest form's payload
 * and could not read its own shape (found in acme, 2026-09-20).
 */
const SEO_SETTINGS_PATH = '/admin/ext/seo/site-settings'

const TWITTER_AUTO = 'auto'

export function SettingsPanel() {
  const { hasCapability } = useCan()
  const mayWrite = hasCapability('seo:write' as never)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** The group being saved, 'all' for the header's Save changes, else null. */
  const [savingGroup, setSavingGroup] = useState<SeoSettingsGroup | 'all' | null>(null)
  const saving = savingGroup !== null
  /**
   * What the server last gave us, serialised. Save is offered only while the
   * form differs from it: a page this long should not leave an editor
   * wondering whether they changed anything.
   */
  const [baseline, setBaseline] = useState('')

  // Flat form state - the nested SeoSettings is assembled on save.
  const [siteName, setSiteName] = useState('')
  const [titleTemplate, setTitleTemplate] = useState('')
  const [titleSeparator, setTitleSeparator] = useState('')
  const [defaultImageId, setDefaultImageId] = useState('')
  const [twitterCard, setTwitterCard] = useState<string>(TWITTER_AUTO)
  const [twitterHandle, setTwitterHandle] = useState('')
  const [orgName, setOrgName] = useState('')
  const [logoId, setLogoId] = useState('')
  const [sameAsText, setSameAsText] = useState('')
  const [google, setGoogle] = useState('')
  const [bing, setBing] = useState('')
  const [defaultIndex, setDefaultIndex] = useState(true)
  const [defaultFollow, setDefaultFollow] = useState(true)
  // S2: llms.txt is the GEO tab's; the settings write is a full replace, so what was loaded is sent back untouched.
  const [geo, setGeo] = useState<SeoSettings['geo']>({ llmsTxtEnabled: false })

  /** The write body, assembled from the flat form state. Also the dirty check. */
  const body = useMemo(() => ({
    general: { siteName, titleTemplate, titleSeparator },
    social: {
      defaultImageId,
      ...(twitterCard === TWITTER_AUTO ? {} : { twitterCard }),
      twitterHandle,
    },
    organization: { name: orgName, logoId, sameAs: parseSameAs(sameAsText) },
    verification: { google, bing },
    robots: { defaultIndex, defaultFollow },
    geo,
  }), [siteName, titleTemplate, titleSeparator, defaultImageId, twitterCard, twitterHandle, orgName, logoId, sameAsText, google, bing, defaultIndex, defaultFollow, geo])

  const dirty = baseline !== '' && JSON.stringify(body) !== baseline
  /** Which groups differ from what the server last sent. */
  const dirtyGroups = useMemo(() => {
    if (baseline === '') return [] as SeoSettingsGroup[]
    const was = JSON.parse(baseline) as Record<string, unknown>
    const now = body as unknown as Record<string, unknown>
    return SEO_SETTINGS_GROUPS.filter((g) => JSON.stringify(now[g]) !== JSON.stringify(was[g]))
  }, [body, baseline])
  /**
   * The header's Save closes over this, not over `body`. Registering the
   * overlay again on every keystroke would rerender the header for each
   * character; a ref keeps the button's deps down to what it DISPLAYS while
   * still sending the latest form.
   */
  const bodyRef = useRef(body)
  bodyRef.current = body
  const dirtyGroupsRef = useRef(dirtyGroups)
  dirtyGroupsRef.current = dirtyGroups
  /** The header's action closes over this, so it re-registers on state, not on keystrokes. */
  const saveGroupsRef = useRef<(groups: readonly SeoSettingsGroup[], label: string) => Promise<void>>(async () => {})

  const hydrate = useCallback((s: SeoSettings) => {
    setSiteName(s.general.siteName ?? '')
    setTitleTemplate(s.general.titleTemplate ?? '')
    setTitleSeparator(s.general.titleSeparator ?? '')
    setDefaultImageId(s.social.defaultImageId ?? '')
    setTwitterCard(s.social.twitterCard ?? TWITTER_AUTO)
    setTwitterHandle(s.social.twitterHandle ?? '')
    setOrgName(s.organization.name ?? '')
    setLogoId(s.organization.logoId ?? '')
    setSameAsText((s.organization.sameAs ?? []).join('\n'))
    setGoogle(s.verification.google ?? '')
    setBing(s.verification.bing ?? '')
    setDefaultIndex(s.robots.defaultIndex)
    setDefaultFollow(s.robots.defaultFollow)
    setGeo(s.geo)
    // The same shape the dirty check compares, built from what the server sent.
    setBaseline(JSON.stringify({
      general: { siteName: s.general.siteName ?? '', titleTemplate: s.general.titleTemplate ?? '', titleSeparator: s.general.titleSeparator ?? '' },
      social: {
        defaultImageId: s.social.defaultImageId ?? '',
        ...(s.social.twitterCard ? { twitterCard: s.social.twitterCard } : {}),
        twitterHandle: s.social.twitterHandle ?? '',
      },
      organization: { name: s.organization.name ?? '', logoId: s.organization.logoId ?? '', sameAs: s.organization.sameAs ?? [] },
      verification: { google: s.verification.google ?? '', bing: s.verification.bing ?? '' },
      robots: { defaultIndex: s.robots.defaultIndex, defaultFollow: s.robots.defaultFollow },
      geo: s.geo,
    }))
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await adminFetch<{ data: SeoSettings }>(SEO_SETTINGS_PATH)
      hydrate(res.data)
    } catch (e) {
      setError((e as Error).message || 'The SEO settings could not be loaded.')
    } finally { setLoading(false) }
  }, [hydrate])

  useEffect(() => { load() }, [load])

  /**
   * Saves the GROUPS it is given, and only those (the user, 2026-09-20: "can
   * we have save for each group in settings so that not big payload is sent
   * and broken down into chunks"). The route merges by group, so a section
   * saves itself: two people editing different sections do not overwrite each
   * other, and a failed save loses one section rather than the page.
   */
  const saveGroups = useCallback(async (groups: readonly SeoSettingsGroup[], label: string) => {
    const patch: Record<string, unknown> = {}
    for (const g of groups) patch[g] = (bodyRef.current as Record<string, unknown>)[g]
    setSavingGroup(groups.length === 1 ? groups[0]! : 'all'); setError(null)
    try {
      const res = await adminFetch<{ data: SeoSettings }>(SEO_SETTINGS_PATH, { method: 'POST', body: JSON.stringify(patch) })
      hydrate(res.data)   // reflect exactly what the server stored
      toast.success(`${label} saved`)
    } catch (e) {
      setError((e as Error).message || 'These settings could not be saved.')
    } finally { setSavingGroup(null) }
  }, [hydrate])
  saveGroupsRef.current = saveGroups

  /** One section's own Save: this group, nothing else. */
  const GroupSave = ({ group, label }: { group: SeoSettingsGroup; label: string }) => (
    mayWrite ? (
      <Button
        size="xs"
        variant="secondary"
        isLoading={savingGroup === group}
        disabled={saving || !dirtyGroups.includes(group)}
        onClick={() => saveGroups([group], label)}
      >
        Save
      </Button>
    ) : null
  )

  // The actions live in the page header: this page scrolls past a screen, and
  // a footer button under six cards is a footer nobody reaches. Save is offered
  // only while something has changed.
  usePageHeaderActions(
    mayWrite && !loading ? (
      <>
        <Button variant="secondary" size="xs" onClick={load} disabled={saving || !dirty}>Reset</Button>
        {/* Saves the CHANGED groups, not the page: one request carrying what
            moved, where a section's own Save carries just that section. */}
        <Button size="xs" isLoading={savingGroup === 'all'} disabled={!dirty} onClick={() => saveGroupsRef.current(dirtyGroupsRef.current, 'Settings')}>
          {`Save changes${dirty ? ` (${dirtyGroupsRef.current.length})` : ''}`}
        </Button>
      </>
    ) : null,
    [mayWrite, loading, savingGroup, dirty],
  )

  if (loading) return <div className="space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>

  const ro = !mayWrite

  return (
    <div className="space-y-8">
      {error && <Callout variant="danger">{error}</Callout>}
      {ro && <Callout variant="info">You can view these settings but not change them. Managing SEO settings needs the seo:write permission.</Callout>}

      {/* The connection and the property ARE the analytics source, so they
          belong where the feature lives - not on Settings > Extensions, which
          an operator configuring SEO has no reason to visit (the user,
          2026-09-20). The same generated form, same store: this is the
          platform's own, brought here. */}
      <ExtensionSettingsForm
        extensionId="seo"
        title="Search Console"
        description="The Google connection SEO reads Search Console with, the property to read, and how much of it to keep. Analytics fills from this."
      />

      <Section title="General" description="How your site is named across search results and titles." action={<GroupSave group="general" label="General" />}>
        <Panel className="space-y-4">
          <FormRow label="Site name" htmlFor="seo-site-name" help="Used by title templates and structured data.">
            <Input id="seo-site-name" value={siteName} disabled={ro} onChange={(e) => setSiteName((e.target as HTMLInputElement).value)} placeholder="Acme Corp" />
          </FormRow>
          <FormRow label="Title template" htmlFor="seo-title-template" help="Use %title% and %site%. Example: %title% | %site%">
            <Input id="seo-title-template" value={titleTemplate} disabled={ro} onChange={(e) => setTitleTemplate((e.target as HTMLInputElement).value)} placeholder="%title% | %site%" />
          </FormRow>
          <FormRow label="Title separator" htmlFor="seo-title-sep" help="The character between the parts of a title. Defaults to a pipe.">
            <Input id="seo-title-sep" value={titleSeparator} disabled={ro} onChange={(e) => setTitleSeparator((e.target as HTMLInputElement).value)} placeholder="|" className="max-w-24" />
          </FormRow>
        </Panel>
      </Section>

      <Section title="Social defaults" description="Fallback Open Graph and Twitter values when a page sets none." action={<GroupSave group="social" label="Social defaults" />}>
        <Panel className="space-y-4">
          <FormRow label="Default share image" htmlFor="seo-og-image" help="A media id used as the Open Graph image when a page has none.">
            <Input id="seo-og-image" value={defaultImageId} disabled={ro} onChange={(e) => setDefaultImageId((e.target as HTMLInputElement).value)} placeholder="Media id" />
          </FormRow>
          <FormRow label="Twitter card" htmlFor="seo-tw-card">
            {/* A Select's trigger is a button, and a button takes its name from
                its CONTENT, not from a label pointing at it - so the row's
                label alone left it unnamed (axe button-name, critical). */}
            <Select id="seo-tw-card" aria-label="Twitter card" value={twitterCard} onValueChange={setTwitterCard} disabled={ro}>
              <SelectItem value={TWITTER_AUTO}>Default (let the network decide)</SelectItem>
              <SelectItem value="summary">Summary</SelectItem>
              <SelectItem value="summary_large_image">Summary with large image</SelectItem>
            </Select>
          </FormRow>
          <FormRow label="Twitter handle" htmlFor="seo-tw-handle" help="The @handle credited on shared cards.">
            <Input id="seo-tw-handle" value={twitterHandle} disabled={ro} onChange={(e) => setTwitterHandle((e.target as HTMLInputElement).value)} placeholder="@acme" />
          </FormRow>
        </Panel>
      </Section>

      <Section title="Organization" description="Your identity for the entity graph (Organization schema)." action={<GroupSave group="organization" label="Organization" />}>
        <Panel className="space-y-4">
          <FormRow label="Organization name" htmlFor="seo-org-name">
            <Input id="seo-org-name" value={orgName} disabled={ro} onChange={(e) => setOrgName((e.target as HTMLInputElement).value)} placeholder="Acme Corporation" />
          </FormRow>
          <FormRow label="Logo" htmlFor="seo-org-logo" help="A media id for the organization logo.">
            <Input id="seo-org-logo" value={logoId} disabled={ro} onChange={(e) => setLogoId((e.target as HTMLInputElement).value)} placeholder="Media id" />
          </FormRow>
          <FormRow label="Profiles (sameAs)" htmlFor="seo-org-sameas" help="One profile URL per line: your social and directory profiles.">
            <Textarea id="seo-org-sameas" value={sameAsText} disabled={ro} rows={3} onChange={(e) => setSameAsText((e.target as HTMLTextAreaElement).value)} placeholder={'https://twitter.com/acme\nhttps://www.linkedin.com/company/acme'} />
          </FormRow>
        </Panel>
      </Section>

      <Section title="Verification" description="Site ownership codes for search consoles." action={<GroupSave group="verification" label="Verification" />}>
        <Panel className="space-y-4">
          <FormRow label="Google verification" htmlFor="seo-ver-google">
            <Input id="seo-ver-google" value={google} disabled={ro} onChange={(e) => setGoogle((e.target as HTMLInputElement).value)} placeholder="google-site-verification code" />
          </FormRow>
          <FormRow label="Bing verification" htmlFor="seo-ver-bing">
            <Input id="seo-ver-bing" value={bing} disabled={ro} onChange={(e) => setBing((e.target as HTMLInputElement).value)} placeholder="msvalidate.01 code" />
          </FormRow>
        </Panel>
      </Section>

      <Section title="Robots" description="The default indexing directives for pages that set none." action={<GroupSave group="robots" label="Robots" />}>
        <Panel rows>
          <Toggle className="px-4 py-3" label="Allow indexing by default" description="Search engines may list your pages (index)." checked={defaultIndex} disabled={ro} onCheckedChange={setDefaultIndex} />
          <Toggle className="px-4 py-3" label="Allow following links by default" description="Search engines may follow links on your pages (follow)." checked={defaultFollow} disabled={ro} onCheckedChange={setDefaultFollow} />
        </Panel>
      </Section>

      {/* The grey card: a note that should sit BELOW the settings it qualifies,
          not compete with them. Same component, quieter tone. */}
      <Panel tone="sunken">
        <Text variant="help">Functions your app owns (how a URL is built, how media resolves) stay in code. Everything here is stored per workspace.</Text>
      </Panel>
    </div>
  )
}
