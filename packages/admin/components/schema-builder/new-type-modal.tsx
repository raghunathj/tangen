/**
 * File Name: new-type-modal.tsx
 * Purpose: The schema builder's "New content type" modal — collects label, name
 *   (code id), description, and an icon, then hands off to the full-page builder
 *   where fields are added.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription,
  Button, Input, Label, Toggle,
} from '@/kit'
import { pluralize } from '@tangen/types'
import { IconPicker, NamedIcon } from './icon-picker'

export interface NewTypeMeta { name: string; label: string; plural: string; description: string; icon: string; singleton?: boolean }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

export function NewTypeModal({ open, onOpenChange, onContinue, title = 'New content type', showIcon = true, nameHint = 'blog_post', labelHint = 'Blog Post' , showSingleton = false }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onContinue: (meta: NewTypeMeta) => void
  /** Content types only — offer the single-entry (singleton) mode. */
  showSingleton?: boolean
  title?: string
  showIcon?: boolean
  nameHint?: string
  labelHint?: string
}) {
  const [label, setLabel] = useState('')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [plural, setPlural] = useState('')
  const [pluralTouched, setPluralTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('')
  const [singleton, setSingleton] = useState(false)

  const effectiveName = nameTouched ? name : slug(label)
  // Autofilled from the name (product → products); the user corrects irregulars
  // (person → people). Locked after creation — this is the only chance to set it.
  const effectivePlural = pluralTouched ? plural : (effectiveName ? pluralize(effectiveName) : '')
  const canContinue = effectiveName.length > 0

  function reset() {
    setLabel(''); setName(''); setNameTouched(false); setPlural(''); setPluralTouched(false); setDescription(''); setIcon(''); setSingleton(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Name it{showIcon ? ' and pick an icon' : ''} - you'll add fields next.</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="nt-label">Label</Label>
            <Input id="nt-label" value={label} onChange={(e) => setLabel(e.currentTarget.value)} placeholder={labelHint} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nt-name">Name (code id)</Label>
            <Input id="nt-name" className="font-mono" value={effectiveName} onChange={(e) => { setNameTouched(true); setName(slug(e.currentTarget.value)) }} placeholder={nameHint} />
          </div>
          {showSingleton && !singleton && (
            <div className="space-y-1">
              <Label htmlFor="nt-plural">Plural <span className="font-normal text-fg-subtle">(the GraphQL list query - can't change later)</span></Label>
              <Input id="nt-plural" className="font-mono" value={effectivePlural} onChange={(e) => { setPluralTouched(true); setPlural(e.currentTarget.value) }} placeholder={pluralize(nameHint)} />
              <p className="text-ui-xs text-fg-subtle">Auto-filled from the name - correct it for irregulars (person → people).</p>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="nt-desc">Description <span className="font-normal text-fg-subtle">(optional)</span></Label>
            <Input id="nt-desc" value={description} onChange={(e) => setDescription(e.currentTarget.value)} placeholder="Articles for the blog" />
          </div>
          {showSingleton && (
            <div className="rounded-control border border-border px-3 py-2.5">
              <Toggle size="sm" label="Singleton - a single entry, not a list"
                description="For one-of-a-kind content like a Homepage, About page, or Site Settings. The menu opens the editor directly - there's no list view and no New button."
                checked={singleton} onCheckedChange={setSingleton} />
            </div>
          )}
          {showIcon && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label>Icon <span className="font-normal text-fg-subtle">(optional)</span></Label>
                {icon && <span className="flex items-center gap-1 text-ui-xs text-fg"><NamedIcon name={icon} className="size-4" /> {icon}</span>}
              </div>
              <IconPicker value={icon} onChange={setIcon} />
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canContinue}
            onClick={() => onContinue({ name: effectiveName, label: label || effectiveName, plural: (showSingleton && !singleton) ? effectivePlural : '', description, icon, ...(showSingleton && singleton ? { singleton: true } : {}) })}
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
