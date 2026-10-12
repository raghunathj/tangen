/**
 * File Name: embed-sheet.tsx
 * Purpose: "Share": where the form lives on the public web, as the API
 *          reports it. Three ways in - the styled page, the unstyled page, the
 *          headless schema and submit endpoints - each with the snippet to
 *          copy.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { Callout, CodeBlock, Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, useLocaleStore } from '@/kit'
import { formsApi, type EmbedUrls } from '../api'

export function EmbedSheet({ open, onOpenChange, formId, formName }: { open: boolean; onOpenChange: (o: boolean) => void; formId: string; formName: string }) {
  const [urls, setUrls] = useState<EmbedUrls | null>(null)
  const localeEnabled = useLocaleStore((s) => s.enabled)
  const locales = useLocaleStore((s) => s.locales)
  const defaultLocale = useLocaleStore((s) => s.defaultLocale)
  const otherLocales = locales.filter((l) => l.code !== defaultLocale)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    formsApi.embed(formId).then((u) => { if (!cancelled) setUrls(u) }).catch(() => {})
    return () => { cancelled = true }
  }, [open, formId])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="md" dismissible>
        <SheetHeader>
          <SheetTitle>Share {formName}</SheetTitle>
          <SheetDescription>Put the form on a page, or render it yourself from its schema.</SheetDescription>
        </SheetHeader>
        <SheetBody>
          {!urls ? <Skeleton variant="rows" rows={4} /> : (
            <div className="space-y-4">
              {urls.requireApiKey && (
                <Callout variant="warning" title="This form requires an API key">
                  The public pages refuse it. Call the keyed endpoints below from your server with a key that grants forms: read and submit.
                </Callout>
              )}
              <Tabs defaultValue="styled">
                <TabsList>
                  <TabsTrigger value="styled">Styled page</TabsTrigger>
                  <TabsTrigger value="appless">Unstyled</TabsTrigger>
                  <TabsTrigger value="headless">Headless</TabsTrigger>
                </TabsList>
                <TabsContent value="styled" className="space-y-3 pt-3">
                  <p className="text-ui-sm text-fg-muted">A hosted page with Tangen's styles and submit logic. Paste the frame anywhere.</p>
                  <Block label="Link" code={urls.styled} />
                  <Block label="Frame" code={`<iframe src="${urls.styled}" width="100%" height="520" style="border:0"></iframe>`} />
                </TabsContent>
                <TabsContent value="appless" className="space-y-3 pt-3">
                  <p className="text-ui-sm text-fg-muted">The same form without styles. Bring your own stylesheet.</p>
                  <Block label="Link" code={urls.appless} />
                  <Block label="In-page, isolated from your styles" code={`<div id="tangen-form"></div>\n<script>\nfetch('${urls.appless}').then(r => r.text()).then(html => {\n  const host = document.getElementById('tangen-form')\n  host.attachShadow({ mode: 'open' }).innerHTML = html\n})\n</script>`} />
                </TabsContent>
                <TabsContent value="headless" className="space-y-3 pt-3">
                  <p className="text-ui-sm text-fg-muted">Render it in your own framework: read the schema, post the values.</p>
                  <Block label="Schema (GET)" code={urls.requireApiKey ? urls.keyedSchema : urls.schema} />
                  <Block label="Submit (POST)" code={urls.requireApiKey ? urls.keyedSubmit : urls.submit} />
                  <Block label="Example" code={`const { data } = await fetch('${urls.requireApiKey ? urls.keyedSchema : urls.schema}').then(r => r.json())\n// data.fields, data.steps, data.submitUrl\nawait fetch(data.submitUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) })`} />
                </TabsContent>
              </Tabs>
              {localeEnabled && otherLocales.length > 0 && (
                <div className="space-y-2 border-t border-border-subtle pt-4" data-testid="embed-locales">
                  <p className="text-ui-sm font-medium text-fg">In another language</p>
                  <p className="text-ui-sm text-fg-muted">
                    Add <code className="rounded bg-surface-sunken px-1 font-mono text-ui-xs text-fg">?locale=</code> and a locale code to any URL above and the form renders with its translations for that language: labels, help texts, buttons and validation messages. Each submission records the locale it was sent in. Without it the form is in {defaultLocale}. Locales: {otherLocales.map((l) => l.code).join(', ')}.
                  </p>
                  <Block label={`Example (${otherLocales[0]!.code})`} code={`${urls.styled}?locale=${otherLocales[0]!.code}`} />
                </div>
              )}
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

function Block({ label, code }: { label: string; code: string }) {
  return (
    <div>
      <p className="mb-1 text-ui-xs font-medium text-fg-muted">{label}</p>
      <CodeBlock code={code} />
    </div>
  )
}
