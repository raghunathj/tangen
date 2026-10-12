'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent, Button, Input, Textarea, Tabs, TabsList, TabsTrigger } from '@tangen/ui'
import { IconSparkles } from '@tangen/icons'
import { adminFetch, toast } from '@/kit'
import {
  analyzeTitleLength, analyzeMetaDescLength,
  analyzeKeywordInTitle, analyzeKeywordInMetaDesc,
  analyzeKeywordDensity, analyzeReadability,
  computeOverallScore,
  type SeoCheck, type SeoScore,
} from '../lib/seo-analysis'
import { panelToScopedFull, scopedToPanelFull } from '../lib/metadata'
import type { SeoPanelFields, SeoPanelLocaleFields } from '../lib/metadata'

export interface SeoPanelProps {
  title?: string
  content?: string
  ai?: { available: boolean; fill: (instruction: string) => Promise<string>; openAssistant?: () => void }
  fieldValues?: Record<string, unknown>
  objectUrl?: string
  /** The object's id ('' on the /new editor): what the alt-text route describes the share image of (S3). */
  objectId?: string
  /**
   * Pre-loaded panel data from app_data (focusKeyword, seoTitle, metaDescription).
   * The editor fetches this on load and passes it here.
   */
  panelData?: Record<string, unknown>
  /**
   * Called whenever the user changes a SEO field. The editor batches these
   * and sends them as __seoPanelData on the next save so the hook can persist them.
   */
  onPanelDataChange?: (data: Record<string, unknown>) => void
  /** The locale the editor is working in; the default locale (or unset) means the base. */
  activeLocale?: string | null
  /** The workspace's configured locales; a switcher shows when there is more than one. */
  locales?: { code: string; label: string }[]
  /** The default (base) locale, or null when localization is off. */
  defaultLocale?: string | null
}

function ScoreDot({ score }: { score: SeoScore }) {
  return (
    <span className={clsx('inline-block w-2 h-2 rounded-full shrink-0', {
      'bg-success': score === 'good',
      'bg-warning': score === 'ok',
      'bg-red-400': score === 'poor',
    })} />
  )
}

function OverallBadge({ score }: { score: SeoScore }) {
  const labels: Record<SeoScore, string> = { good: 'Good', ok: 'Needs improvement', poor: 'Poor' }
  return (
    <div className={clsx(
      'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
      {
        'bg-success-muted text-success-fg': score === 'good',
        'bg-warning-muted text-warning-fg': score === 'ok',
        'bg-danger-muted text-danger-fg': score === 'poor',
      },
    )}>
      <ScoreDot score={score} />
      {labels[score]}
    </div>
  )
}

function GooglePreview({ title, metaDesc, url }: { title: string; metaDesc: string; url: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3 text-left space-y-0.5">
      <p className="text-[10px] text-fg-subtle font-medium uppercase tracking-wider mb-1.5">Google preview</p>
      <p className="text-[13px] text-info-fg hover:underline cursor-pointer leading-tight truncate">{title || 'Page title'}</p>
      <p className="text-[11px] text-success-fg truncate">{url || 'https://example.com/page'}</p>
      <p className="text-[11px] text-fg-muted leading-relaxed line-clamp-2">{metaDesc || 'Meta description will appear here…'}</p>
    </div>
  )
}

function ChecklistItem({ check }: { check: SeoCheck }) {
  return (
    <AccordionItem value={check.key}>
      <AccordionTrigger>
        <span className="flex items-center gap-2">
          <ScoreDot score={check.score} />
          {check.label}
        </span>
      </AccordionTrigger>
      <AccordionContent>
        <p className="text-[11px] text-fg-muted leading-relaxed">{check.message}</p>
      </AccordionContent>
    </AccordionItem>
  )
}

export function SeoPanel({
  title = '',
  content = '',
  fieldValues = {},
  objectUrl = '',
  objectId = '',
  panelData,
  onPanelDataChange,
  ai,
  activeLocale = null,
  locales = [],
  defaultLocale = null,
}: SeoPanelProps) {
  const [aiBusy, setAiBusy] = useState(false)
  // S3: whether this installation can describe an image (both optional grants + a provider that can see).
  const [vision, setVision] = useState<{ available: boolean; provider?: string } | null>(null)
  const [altBusy, setAltBusy] = useState(false)
  const [activeTab, setActiveTab] = useState<'seo' | 'readability'>('seo')
  const showAssistantButton = ai?.available && typeof ai.openAssistant === 'function'

  // The full editable state: base fields plus per-locale slices. title and
  // description are per locale; the focus keyphrase is a base-only editorial aid.
  const [base, setBase] = useState<SeoPanelFields>({})
  const [localeData, setLocaleData] = useState<Record<string, SeoPanelLocaleFields>>({})
  // Which locale is being edited. The default locale edits the base.
  const [active, setActive] = useState<string>(activeLocale || defaultLocale || '')
  const localized = locales.length > 1
  const isBase = !active || active === defaultLocale

  const seoTitle = (isBase ? base.seoTitle : localeData[active]?.seoTitle) ?? ''
  const metaDesc = (isBase ? base.metaDescription : localeData[active]?.metaDescription) ?? ''
  const focusKeyword = base.focusKeyword ?? ''

  // One commit point: set state AND emit the COMPLETE scoped shape (every
  // locale), because writeDraft replaces the whole draft.
  function commit(nextBase: SeoPanelFields, nextLocales: Record<string, SeoPanelLocaleFields>) {
    setBase(nextBase)
    setLocaleData(nextLocales)
    onPanelDataChange?.(panelToScopedFull(nextBase, nextLocales) as unknown as Record<string, unknown>)
  }
  function setTitleValue(v: string) {
    if (isBase) commit({ ...base, seoTitle: v }, localeData)
    else commit(base, { ...localeData, [active]: { ...localeData[active], seoTitle: v } })
  }
  function setDescValue(v: string) {
    if (isBase) commit({ ...base, metaDescription: v }, localeData)
    else commit(base, { ...localeData, [active]: { ...localeData[active], metaDescription: v } })
  }
  function setFocusValue(v: string) {
    commit({ ...base, focusKeyword: v }, localeData)
  }

  // FAQ pairs are base-only (shared across locales) - edited on the base view.
  const faqList = base.faqs ?? []
  function setFaqs(next: { question: string; answer: string }[]) {
    commit({ ...base, faqs: next }, localeData)
  }
  const updateFaq = (i: number, patch: { question?: string; answer?: string }) =>
    setFaqs(faqList.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  const addFaq = () => setFaqs([...faqList, { question: '', answer: '' }])
  const removeFaq = (i: number) => setFaqs(faqList.filter((_, idx) => idx !== i))

  // The GEO answer summary (base-only). AI-fillable when a provider is configured.
  const answerSummary = base.answerSummary ?? ''
  function setAnswerSummary(v: string) {
    commit({ ...base, answerSummary: v }, localeData)
  }
  async function aiWriteAnswer() {
    if (!ai?.available || aiBusy) return
    setAiBusy(true)
    try {
      const text = await ai.fill(
        `Write a concise, factual answer summary of this content for AI answer engines: 2 to 4 sentences, plain text, no marketing language.${focusKeyword ? ` Focus: "${focusKeyword}".` : ''}`,
      )
      setAnswerSummary(text)
    } catch {
      // the host surfaces API errors via toasts
    } finally {
      setAiBusy(false)
    }
  }

  // S3: the share image's alt text (og:image:alt, base-only). A vision provider can write it from the image itself.
  const imageAlt = base.imageAlt ?? ''
  function setImageAlt(v: string) {
    commit({ ...base, imageAlt: v }, localeData)
  }
  useEffect(() => {
    if (!objectId) return
    let alive = true
    adminFetch<{ data: { available: boolean; provider?: string } }>('/admin/ext/seo/vision-status')
      .then((r) => { if (alive) setVision(r.data) })
      .catch(() => { if (alive) setVision({ available: false }) })
    return () => { alive = false }
  }, [objectId])
  async function describeImage() {
    if (!objectId || altBusy) return
    setAltBusy(true)
    try {
      const r = await adminFetch<{ data?: { alt: string }; error?: { message: string } }>('/admin/ext/seo/alt-text', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: objectId, title, locale: isBase ? null : active }),
      })
      if (r.error) toast.error(r.error.message)
      else if (r.data) setImageAlt(r.data.alt)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The image could not be described')
    } finally {
      setAltBusy(false)
    }
  }

  async function aiWriteTitle() {
    if (!ai?.available || aiBusy) return
    setAiBusy(true)
    try {
      const text = await ai.fill(
        `Write an SEO title for this content: max 60 characters, no quotes, compelling.${focusKeyword ? ` Include the focus keyword "${focusKeyword}".` : ''}`,
      )
      setTitleValue(text)
    } catch {
      // the host surfaces API errors via toasts
    } finally {
      setAiBusy(false)
    }
  }

  async function aiWriteMetaDesc() {
    if (!ai?.available || aiBusy) return
    setAiBusy(true)
    try {
      const text = await ai.fill(
        `Write an SEO meta description for this content: 120-160 characters, plain text, compelling, no quotes.${focusKeyword ? ` Include the focus keyword "${focusKeyword}".` : ''}`,
      )
      setDescValue(text)
    } catch {
      // panel stays usable; the host page surfaces API errors via toasts
    } finally {
      setAiBusy(false)
    }
  }

  // Initialise from pre-loaded panelData once when it first arrives. The store
  // speaks the scoped {draft:{base,locales}} shape; scopedToPanelFull maps it
  // back to the fields this panel edits (and tolerates legacy flat rows).
  const initializedRef = useRef(false)
  useEffect(() => {
    if (initializedRef.current || !panelData) return
    const full = scopedToPanelFull(panelData)
    const hasAny = full.base.seoTitle || full.base.metaDescription || full.base.focusKeyword || full.base.answerSummary || full.base.imageAlt || full.base.faqs?.length || Object.keys(full.locales).length > 0
    if (hasAny) {
      setBase(full.base)
      setLocaleData(full.locales)
      initializedRef.current = true
    }
  }, [panelData])

  const effectiveTitle = seoTitle || title

  const seoChecks = useMemo<SeoCheck[]>(() => [
    analyzeTitleLength(effectiveTitle),
    analyzeMetaDescLength(metaDesc),
    analyzeKeywordInTitle(effectiveTitle, focusKeyword),
    analyzeKeywordInMetaDesc(metaDesc, focusKeyword),
    analyzeKeywordDensity(content, focusKeyword),
  ], [effectiveTitle, metaDesc, focusKeyword, content])

  const readabilityChecks = useMemo<SeoCheck[]>(() => [
    analyzeReadability(content),
  ], [content])

  const activeChecks = activeTab === 'seo' ? seoChecks : readabilityChecks
  const overallScore = computeOverallScore(activeChecks)


  const overallSeoScore = computeOverallScore(seoChecks)

  return (
    <div className="space-y-4">
      {/* The panel's own header line (the design's score pill): where this page stands, before the fields. */}
      <div className="flex items-center gap-2 border-b border-border-subtle pb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Search appearance</span>
        <span className="ml-auto"><OverallBadge score={overallSeoScore} /></span>
      </div>
      {showAssistantButton && (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="xs" icon={<IconSparkles className="w-3.5 h-3.5" />} onClick={() => ai!.openAssistant!()}>
            Generate SEO with Gen AI
          </Button>
        </div>
      )}
      {/* Locale switcher - title and description are stored per locale. */}
      {localized && (
        <div>
          <div className="flex flex-wrap gap-1 rounded-md bg-surface-sunken p-0.5">
            {locales.map((l) => {
              const on = l.code === (active || defaultLocale)
              return (
                <Button key={l.code} type="button" size="xs" variant={on ? 'secondary' : 'ghost'} aria-pressed={on} onClick={() => setActive(l.code)}>
                  {l.label}
                </Button>
              )
            })}
          </div>
          {!isBase && (
            <p className="mt-1 text-[10px] text-fg-subtle">
              Overrides for this locale. Leave a field empty to fall back to the default.
            </p>
          )}
        </div>
      )}

      {/* Focus keyword */}
      <div>
        <label className="block text-[10px] font-semibold text-fg-muted uppercase tracking-wider mb-1">
          Focus keyphrase
        </label>
        <Input
          type="text"
          value={focusKeyword}
          onChange={(e) => setFocusValue(e.currentTarget.value)}
          placeholder="e.g. headless CMS"
        />
      </div>

      {/* The design's check lines: the three that matter, right where the keyphrase is typed. */}
      {isBase && (
        <ul className="space-y-1.5">
          {seoChecks.slice(0, 3).map((check) => (
            <li key={check.key} className="flex items-start gap-2 text-[11px] font-medium text-fg-muted">
              <ScoreDot score={check.score} />
              <span className="mt-[-2px]">{check.message}</span>
            </li>
          ))}
        </ul>
      )}

      {/* SEO title */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="flex items-center text-[10px] font-semibold text-fg-muted uppercase tracking-wider">
            SEO title
            {ai?.available && (
              <Button type="button" variant="ghost" size="xs" className="ml-1.5 h-5 px-1.5 align-middle text-[10px] font-semibold normal-case tracking-normal text-accent-fg" title="Write with AI" disabled={aiBusy} onClick={aiWriteTitle}
                icon={<IconSparkles className={aiBusy ? 'w-3.5 h-3.5 animate-pulse text-accent' : 'w-3.5 h-3.5'} />}>AI</Button>
            )}
          </label>
          <span className={clsx('text-[10px] font-medium', {
            'text-success-fg': seoTitle.length >= 50 && seoTitle.length <= 60,
            'text-warning': (seoTitle.length > 0 && seoTitle.length < 50) || (seoTitle.length > 60 && seoTitle.length <= 70),
            'text-danger-fg': seoTitle.length > 70,
            'text-fg-subtle': seoTitle.length === 0,
          })}>
            {seoTitle.length || effectiveTitle.length}/60
          </span>
        </div>
        <Input
          type="text"
          value={seoTitle}
          onChange={(e) => setTitleValue(e.currentTarget.value)}
          placeholder={title || 'SEO title…'}
        />
      </div>

      {/* Meta description */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] font-semibold text-fg-muted uppercase tracking-wider">
            Meta description
            {ai?.available && (
              <Button type="button" variant="ghost" size="xs" className="ml-1.5 h-5 px-1.5 align-middle text-[10px] font-semibold normal-case tracking-normal text-accent-fg" title="Write with AI" disabled={aiBusy} onClick={aiWriteMetaDesc}
                icon={<IconSparkles className={aiBusy ? 'w-3.5 h-3.5 animate-pulse text-accent' : 'w-3.5 h-3.5'} />}>AI</Button>
            )}
          </label>
          <span className={clsx('text-[10px] font-medium', {
            'text-success-fg': metaDesc.length >= 120 && metaDesc.length <= 160,
            'text-warning': (metaDesc.length >= 80 && metaDesc.length < 120) || (metaDesc.length > 160 && metaDesc.length <= 180),
            'text-danger-fg': (metaDesc.length > 0 && metaDesc.length < 80) || metaDesc.length > 180,
            'text-fg-subtle': metaDesc.length === 0,
          })}>
            {metaDesc.length}/160
          </span>
        </div>
        <Textarea
          rows={3}
          value={metaDesc}
          onChange={(e) => setDescValue(e.currentTarget.value)}
          placeholder="Write a compelling description for search results…"
          className="resize-none"
        />
      </div>

      {/* GEO answer summary - base-only; surfaced in the resolved output. */}
      {isBase && (
        <div>
          <label className="flex items-center text-[10px] font-semibold text-fg-muted uppercase tracking-wider mb-1">
            AI answer summary
            {ai?.available && (
              <Button type="button" variant="ghost" size="xs" className="ml-1.5 h-5 px-1.5 align-middle text-[10px] font-semibold normal-case tracking-normal text-accent-fg" title="Write with AI" disabled={aiBusy} onClick={aiWriteAnswer}
                icon={<IconSparkles className={aiBusy ? 'w-3.5 h-3.5 animate-pulse text-accent' : 'w-3.5 h-3.5'} />}>AI</Button>
            )}
          </label>
          <Textarea
            rows={3}
            value={answerSummary}
            onChange={(e) => setAnswerSummary(e.currentTarget.value)}
            placeholder="A concise, factual summary AI answer engines can cite…"
            className="resize-none"
          />
        </div>
      )}

      {/* S3: share image alt text - og:image:alt. The Describe button exists only when the installation can see. */}
      {isBase && (
        <div>
          <label className="flex items-center text-[10px] font-semibold text-fg-muted uppercase tracking-wider mb-1">
            Share image alt text
            {vision?.available && objectId && (
              <Button type="button" variant="ghost" size="xs" className="ml-1.5 h-5 px-1.5 align-middle text-[10px] font-semibold normal-case tracking-normal text-accent-fg" title="Describe the share image with AI" disabled={altBusy} onClick={describeImage}
                icon={<IconSparkles className={altBusy ? 'w-3.5 h-3.5 animate-pulse text-accent' : 'w-3.5 h-3.5'} />}>Describe</Button>
            )}
          </label>
          <Input
            type="text"
            value={imageAlt}
            onChange={(e) => setImageAlt(e.currentTarget.value)}
            placeholder="What the share image shows, in one sentence"
            maxLength={125}
          />
        </div>
      )}

      {/* FAQ - base-only; rendered as FAQPage JSON-LD for rich results and GEO. */}
      {isBase && (
        <div>
          <label className="block text-[10px] font-semibold text-fg-muted uppercase tracking-wider mb-1">
            FAQ (rich results and AI answers)
          </label>
          <div className="space-y-2">
            {faqList.map((f, i) => (
              <div key={i} className="rounded-md border border-border p-2 space-y-1.5">
                <div className="flex items-start gap-1">
                  <Input
                    type="text"
                    value={f.question}
                    onChange={(e) => updateFaq(i, { question: e.currentTarget.value })}
                    placeholder="Question"
                  />
                  <Button type="button" variant="ghost" size="xs" className="shrink-0" aria-label="Remove question" icon={<span aria-hidden="true">&times;</span>} onClick={() => removeFaq(i)} />
                </div>
                <Textarea
                  rows={2}
                  value={f.answer}
                  onChange={(e) => updateFaq(i, { answer: e.currentTarget.value })}
                  placeholder="Answer"
                  className="resize-none"
                />
              </div>
            ))}
            <Button type="button" variant="ghost" size="xs" onClick={addFaq}>
              + Add question
            </Button>
          </div>
        </div>
      )}

      {/* Google preview */}
      <GooglePreview title={effectiveTitle} metaDesc={metaDesc} url={objectUrl} />

      {/* Analysis tabs + checklist */}
      <div>
        <div className="flex items-end border-b border-border mb-2">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'seo' | 'readability')}>
            <TabsList>
              <TabsTrigger value="seo">SEO analysis</TabsTrigger>
              <TabsTrigger value="readability">Readability</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex-1" />
          <div className="flex items-center pb-1.5">
            <OverallBadge score={overallScore} />
          </div>
        </div>

        <Accordion type="multiple" className="border-t border-border">
          {activeChecks.map((check) => (
            <ChecklistItem key={check.key} check={check} />
          ))}
        </Accordion>
      </div>
    </div>
  )
}
