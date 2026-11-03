/**
 * File Name: link-field.tsx
 * Purpose: The content editor's control for a link field (closure plan Phase
 *          6B, Unit 20). In the editor it is ONE row - the link's label and
 *          where it goes, with edit and clear; the label, the kind, the
 *          picker or URL, the anchor and the query live behind a dialog
 *          (the user, 2026-09-13: six controls inline crowded the editor).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: All of the logic lives in lib/link-editor.ts, which is
 *          where its tests are. Internal targets reuse the ObjectPicker, so a
 *          link picks content exactly the way a reference field does, and
 *          what it stores is identity: `{ type, id }`, never a copied slug.
 *          The dialog edits the value live; Cancel puts back what was there
 *          when it opened. The kind the author is looking at is the dialog's
 *          own state: an external destination with no URL yet is not a link,
 *          so it cannot be read back from the value.
 */
import { useState } from 'react'
import {
  Button, Input, Badge, Toggle,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from '@tangen/ui'
import { IconLink, IconPencil, IconX, IconExternalLink, IconHome } from '@tangen/icons'
import { ObjectPicker } from '@/components/fields/object-picker'
import {
  linkConfigView, authoredLink, currentKind, setTarget, setUrl, setPath,
  setLabel, setNewTab, setPostfix, postfixOf, targetSummary,
} from '@/lib/link-editor'
import { useResolvedPickableRow } from '@/lib/use-pickable-objects'
import { externalUrlIssue, pathLinkIssue } from '@tangen/types'
import type { FieldDefinition, LinkKind } from '@tangen/types'

const KIND_LABEL: Record<LinkKind, string> = {
  internal: 'Content',
  external: 'External URL',
  path: 'Page path',
}

/**
 * What is wrong with the destination as it stands, said HERE rather than at
 * publish. `type="url"` on the input did nothing for this: native constraint
 * validation only surfaces on a form submit, and these are controlled inputs
 * with no form, so a bad URL used to save into the draft silently and surface
 * as a failed publish on another screen.
 *
 * Empty is not an error. A field in the middle of being filled must not shout,
 * and `required` is the rule that decides whether empty is allowed.
 */
function destinationIssue(kind: LinkKind, text: string): string | null {
  if (text.trim() === '') return null
  if (kind === 'external') {
    const issue = externalUrlIssue(text)
    if (issue?.reason === 'relative') return 'That is a path on this site. Switch to Page path.'
    if (issue?.reason === 'unsafe') return `A ${issue.scheme} URL cannot be a link destination.`
    if (issue?.reason === 'scheme') return `${issue.scheme} links are not allowed here.`
    if (issue) return 'Enter a full URL, like https://example.com/page.'
    return null
  }
  if (kind === 'path') {
    const issue = pathLinkIssue(text)
    if (issue?.reason === 'absolute') {
      return issue.scheme ? 'That is a full URL. Switch to External URL.' : 'A path starts with one slash, like /about.'
    }
    if (issue) return 'Enter a path on this site, like /about.'
    return null
  }
  return null
}

export interface LinkFieldProps {
  field: FieldDefinition
  value: unknown
  onChange: (next: unknown) => void
  workspaceId: string
}

export function LinkField({ field, value, onChange, workspaceId }: LinkFieldProps) {
  const view = linkConfigView(field)
  const authored = authoredLink(value)
  const summary = targetSummary(value)
  const [open, setOpen] = useState(false)
  const [before, setBefore] = useState<unknown>(null)

  const openDialog = () => { setBefore(value); setOpen(true) }
  const cancel = () => { onChange(before); setOpen(false) }

  // A target the author JUST picked carries no facts: the read that resolves
  // a link's target runs on the server, and nothing has been saved yet. So the
  // collapsed row showed the raw id of a page chosen by its name, until the
  // entry was saved and read back. This asks for the one row by id, which is
  // what the picker's own trigger already does.
  const unresolvedTarget =
    authored?.type === 'internal' && summary && !summary.resolved ? authored.target : null
  const { row: fetchedTarget } = useResolvedPickableRow(
    unresolvedTarget?.type ?? '',
    unresolvedTarget?.id ?? null,
  )

  const destination = authored
    ? (authored.type === 'internal'
        ? (summary?.resolved ? summary.label : (fetchedTarget?.title ?? summary?.label ?? authored.target.id))
        : authored.type === 'path' ? authored.path : authored.url)
    : ''
  const suffix = postfixOf(value)

  return (
    <div>
      {authored ? (
        <div className="flex h-(--tg-control-h) items-center gap-2 rounded-control border border-border bg-surface pl-3 pr-1 text-ui-sm">
          {/*
            External is the only destination that LEAVES the site, so it is the
            only one wearing the leaving-arrow. A path stays here, so showing it
            that arrow said the opposite of what it does.
          */}
          {authored.type === 'external'
            ? <IconExternalLink className="size-4 shrink-0 text-fg-subtle" aria-hidden />
            : authored.type === 'path'
              ? <IconHome className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              : <IconLink className="size-4 shrink-0 text-fg-subtle" aria-hidden />}
          <span className="min-w-0 flex-1 truncate">
            {authored.label && <span className="font-medium text-fg">{authored.label}</span>}
            {authored.label && <span className="mx-1.5 text-fg-faint" aria-hidden>·</span>}
            <span className={authored.label ? 'text-fg-muted' : 'text-fg'}>{destination}</span>
            {suffix && <span className="text-fg-subtle">{suffix}</span>}
          </span>
          {authored.type === 'internal' && summary && (
            summary.broken
              ? <Badge variant="error">Cannot be found</Badge>
              : <span className="hidden shrink-0 text-ui-xs text-fg-subtle sm:inline">{summary.detail}</span>
          )}
          {authored.newTab && <span className="hidden shrink-0 text-ui-xs text-fg-subtle sm:inline">new tab</span>}
          <Button variant="ghost" size="sm" icon={<IconPencil />} aria-label="Edit link" onClick={openDialog} />
          <Button variant="ghost" size="sm" icon={<IconX />} aria-label="Clear link" onClick={() => onChange(null)} />
        </div>
      ) : (
        <Button variant="secondary" size="sm" icon={<IconLink />} onClick={openDialog}>Add link</Button>
      )}

      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false) }}>
        <DialogContent size="md" showClose={false}>
          <DialogHeader>
            <DialogTitle><IconLink />{field.label || 'Link'}</DialogTitle>
            <DialogDescription>Content in this workspace, held by identity, or an external URL.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {open && <LinkDestinationEditor value={value} onChange={onChange} view={view} workspaceId={workspaceId} />}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={cancel}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => setOpen(false)} disabled={!authored}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** The full form: label, kind, target or URL, postfix, new tab. Mounted fresh each time the dialog opens. */
function LinkDestinationEditor({ value, onChange, view, workspaceId }: {
  value: unknown
  onChange: (next: unknown) => void
  view: ReturnType<typeof linkConfigView>
  workspaceId: string
}) {
  const authored = authoredLink(value)
  const summary = targetSummary(value)
  // Which destination the author is looking at. Not derived from the value:
  // an external destination with no URL typed yet is not a link at all.
  const [kind, setKind] = useState<LinkKind>(() => currentKind(value, view))
  // What the author is typing, kept as typed: the stored forms are trimmed
  // and parsed, so showing them back would eat a trailing space in the label
  // and a lone "?" in the postfix on every keystroke (the user, 2026-09-13).
  // A label typed before the destination exists waits here and lands with it.
  const [labelDraft, setLabelDraft] = useState(() => authored?.label ?? '')
  const [postfixDraft, setPostfixDraft] = useState(() => postfixOf(value))
  // Said on BLUR, not on every keystroke: typing "example.com" passes through
  // "e", "ex", "exa", each of which has no scheme and would otherwise flash
  // "that is a path on this site" into the author's face while they type.
  // Once they have been told, it updates live as they fix it.
  const [touched, setTouched] = useState(false)
  const typedUrl = authored?.type === 'external' ? authored.url : ''
  const typedPath = authored?.type === 'path' ? authored.path : ''
  const urlIssue = touched ? destinationIssue('external', typedUrl) : null
  const pathIssue = touched ? destinationIssue('path', typedPath) : null

  const withLabel = (next: unknown) => (labelDraft.trim() && next ? setLabel(next, labelDraft) : next)

  return (
    <div className="space-y-4">
      {view.withLabel && (
        <div>
          <span className="mb-1 block text-ui-xs font-medium text-fg-muted">Label</span>
          <Input
            value={labelDraft}
            onChange={(e) => { const v = e.currentTarget.value; setLabelDraft(v); if (authored) onChange(setLabel(value, v)) }}
            placeholder="Learn more"
            maxLength={200}
            aria-label="Link label"
          />
        </div>
      )}

      {view.kinds.length > 1 && (
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-sunken p-1" role="tablist">
          {view.kinds.map((k) => (
            <Button
              key={k}
              role="tab"
              aria-selected={kind === k}
              variant={kind === k ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => { setKind(k); setTouched(false) }}
            >
              {KIND_LABEL[k]}
            </Button>
          ))}
        </div>
      )}

      {kind === 'internal' ? (
        <div className="space-y-2">
          <ObjectPicker
            workspaceId={workspaceId}
            include={view.allowedTargets}
            value={authored?.type === 'internal' ? (authored.target as never) : (null as never)}
            onChange={(next: unknown) => onChange(withLabel(setTarget(value, next as { type: string; id: string } | null)))}
          />
          {authored?.type === 'internal' && summary?.broken && (
            <p className="text-ui-xs text-danger-fg">
              {summary.detail}. The link still points at {summary.label}, so it works again if that entry comes back.
            </p>
          )}
        </div>
      ) : kind === 'path' ? (
        <div>
          <span className="mb-1 block text-ui-xs font-medium text-fg-muted">Path</span>
          <Input
            value={typedPath}
            onChange={(e) => onChange(withLabel(setPath(value, e.currentTarget.value)))}
            onBlur={() => setTouched(true)}
            placeholder="/about"
            spellCheck={false}
            aria-label="Path"
            aria-invalid={pathIssue ? true : undefined}
          />
          {pathIssue
            ? <p className="mt-1 text-ui-xs text-danger-fg">{pathIssue}</p>
            : <p className="mt-1 text-ui-xs text-fg-subtle">A route on this site, handed to your app as you type it. Use this for a page that is not an entry here.</p>}
        </div>
      ) : (
        <div>
          <span className="mb-1 block text-ui-xs font-medium text-fg-muted">URL</span>
          <Input
            value={typedUrl}
            onChange={(e) => onChange(withLabel(setUrl(value, e.currentTarget.value)))}
            onBlur={() => setTouched(true)}
            placeholder="https://example.com"
            spellCheck={false}
            aria-label="URL"
            aria-invalid={urlIssue ? true : undefined}
          />
          {urlIssue && <p className="mt-1 text-ui-xs text-danger-fg">{urlIssue}</p>}
        </div>
      )}

      {authored && (view.anchor || view.query) && (
        <div>
          <span className="mb-1 block text-ui-xs font-medium text-fg-muted">Postfix</span>
          <Input
            value={postfixDraft}
            onChange={(e) => { const v = e.currentTarget.value; setPostfixDraft(v); onChange(setPostfix(value, v)) }}
            placeholder="?source=footer#team"
            spellCheck={false}
            className="font-mono text-ui-xs"
            aria-label="Postfix"
          />
          <p className="mt-1 text-ui-xs text-fg-subtle">Appended after the destination: query parameters, an anchor, or both. A path belongs in the URL.</p>
        </div>
      )}

      {authored && view.newTab && (
        <Toggle
          label="Open in a new tab"
          description="The link opens in a new browser tab; a content link still resolves to this site."
          direction="switch-first"
          size="sm"
          checked={authored.newTab === true}
          onCheckedChange={(on) => onChange(setNewTab(value, on))}
        />
      )}
    </div>
  )
}
