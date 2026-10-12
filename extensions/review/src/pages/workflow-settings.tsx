/**
 * File Name: workflow-settings.tsx
 * Purpose: The editors ONE workflow's builder page is made of: the stage
 *          pipeline (connectors, colour swatches, inline rename, reorder,
 *          delete under the terminal-stage rule, a visible stage cap, and
 *          which roles may action each stage) and the coverage picker for
 *          which content types run through it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Rendered by pages/workflow-detail.tsx - the whole-set
 *          accordion tab these started life in is gone, replaced by the
 *          Workflows list plus a builder per workflow. The server
 *          re-validates everything (workflows.ts validateWorkflowSet); this
 *          UI only keeps honest people honest. A type belongs to at most ONE
 *          workflow, so types another workflow claims render disabled with
 *          the owner named instead of failing the save. Pure logic lives in
 *          settings-model.ts. No em dashes in UI copy.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Input, MultiSelect, Text, cx } from '@/kit'
import { DynamicIcon } from '@/kit'
import { IconArrowDown, IconChevronDown } from '@tangen/icons'
import { MAX_STAGES, STAGE_COLORS } from '../workflow'
import { stageDotClass } from '../queue-model'
import { claimOwner, draftKey, type DraftStage, type DraftWorkflow } from '../settings-model'

interface TypeItem {
  name: string
  label?: string
  admin?: { menu?: { icon?: string } }
}

/** The accessible on/off switch (the kit has no Switch primitive yet). */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex items-center gap-2.5 text-left"
    >
      <span
        className={cx(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-fg-faint',
        )}
      >
        <span
          className={cx(
            'inline-block size-4 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </span>
      <span className="text-sm font-medium text-fg group-hover:text-fg">{label}</span>
    </button>
  )
}

/**
 * Who may act on ONE stage (R3). `null` is the normal state: anyone who can
 * review does. Naming roles narrows it to them plus the owner, and the first
 * restriction pre-fills `admin` so restricting a stage never locks out the
 * people who administer the workspace by accident.
 */
function StageRoles({
  stage, roleOptions, onChange,
}: {
  stage: DraftStage
  roleOptions: Array<{ slug: string; name: string }>
  onChange: (roles: string[] | null) => void
}) {
  const restricted = stage.roles !== null
  const chosen = stage.roles ?? []
  // A role deleted from the workspace still sits in the stage's list. It
  // matches nobody, which is the SAFE failure (never silently widening), but
  // it looks like a working restriction unless we say otherwise.
  const known = new Set(roleOptions.map((r) => r.slug))
  const missingRoles = chosen.filter((slug) => !known.has(slug))
  if (roleOptions.length === 0) return null

  return (
    <div className="mt-3 pl-10">
      <Toggle
        checked={restricted}
        onChange={(on) => onChange(on ? ['admin'] : null)}
        label="Only certain roles can action this stage"
      />
      {restricted && (
        <>
          {/* One dropdown from the kit rather than a row of toggles: a
              workspace can have many roles and a wall of buttons stops being
              scannable. Deleted roles still show, so a restriction is never
              silently hidden. */}
          <MultiSelect
            className="mt-2 max-w-xs"
            aria-label="Roles that can action this stage"
            placeholder="Pick roles…"
            options={roleOptions.map((r) => ({ value: r.slug, label: r.name }))}
            value={chosen}
            onChange={(next) => onChange(next)}
            unknownLabel={(slug) => `${slug} (removed)`}
          />
          {missingRoles.length > 0 && (
            <p className="mt-1.5 text-[11px] font-medium text-warning-fg">
              {missingRoles.join(', ')} no longer {missingRoles.length === 1 ? 'exists' : 'exist'} in this
              workspace, so {missingRoles.length === 1 ? 'it grants' : 'they grant'} nobody access. Pick a
              current role, or only the owner can action this stage.
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-fg-subtle">
            {chosen.length === 0
              ? 'No roles picked - only the workspace owner can action this stage.'
              : 'The workspace owner can always action it. Flows and API keys cannot.'}
          </p>
        </>
      )}
    </div>
  )
}

/**
 * The stage's number, which IS its colour control. Six swatches per stage
 * shown up front turned the pipeline into a wall of dots; the colour is only
 * ever changed occasionally, so it hides behind the badge already showing it.
 */
function StageColorButton({
  index, color, onChange,
}: {
  index: number
  color: string
  onChange: (color: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Stage ${index + 1} colour: ${color}. Change it`}
        title="Change colour"
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'relative inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold text-white transition-transform hover:scale-105',
          stageDotClass(color),
        )}
      >
        {index + 1}
        {/* Always visible, not hover-only: the point is that someone who has
            never clicked it learns the number opens something. */}
        <span
          aria-hidden
          className={cx(
            'absolute -bottom-0.5 -right-0.5 inline-flex size-3.5 items-center justify-center rounded-full border border-border bg-surface text-fg-muted transition-transform',
            open && 'rotate-180',
          )}
        >
          <IconChevronDown className="size-2.5" />
        </span>
      </button>
      {open && (
        <div
          role="radiogroup"
          aria-label={`Stage ${index + 1} colour`}
          className="absolute left-0 top-9 z-50 flex gap-1.5 rounded-md border border-border bg-surface p-2 shadow-lg"
        >
          {STAGE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              title={c}
              onClick={() => { onChange(c); setOpen(false) }}
              className={cx(
                'size-5 rounded-full transition-transform hover:scale-110',
                stageDotClass(c),
                color === c && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** The stage pipeline editor for ONE workflow. */
export function StagePipeline({
  stages, terminalId, onChange, roleOptions,
}: {
  stages: DraftStage[]
  terminalId: string | null
  onChange: (next: DraftStage[]) => void
  /** Workspace roles a stage can be restricted to (R3). */
  roleOptions?: Array<{ slug: string; name: string }>
}) {
  const patch = (key: string, p: Partial<DraftStage>) =>
    onChange(stages.map((s) => (s.key === key ? { ...s, ...p } : s)))

  const move = (index: number, dir: -1 | 1) => {
    const next = [...stages]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  const atCap = stages.length >= MAX_STAGES

  const addStage = () => {
    if (atCap) return
    const next = [...stages]
    // New stages slot in before the terminal stage - the gate stays last.
    next.splice(Math.max(next.length - 1, 0), 0, { key: draftKey('stg'), name: '', color: 'blue', roles: null })
    onChange(next)
  }

  return (
    <section className="min-w-0 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-fg">Stages</h3>
        <Text variant="help">
          Items move through these stages in order. The last stage is the publish gate: content becomes publishable only there, and only while unchanged. Deleting a stage moves its items back to the previous stage.
        </Text>
      </div>

      <div>
        {stages.map((s, i) => {
          const isTerminal = i === stages.length - 1
          const isStoredTerminal = s.id != null && s.id === terminalId
          return (
            <div key={s.key}>
              {i > 0 && (
                <div className="flex flex-col items-center py-0.5" aria-hidden>
                  <span className="h-2.5 w-px bg-border-strong" />
                  <IconArrowDown className="size-3 text-fg-subtle" />
                </div>
              )}
              <div className="rounded-lg border border-border bg-surface p-4 shadow-xs">
                <div className="flex items-center gap-3">
                  <StageColorButton
                    index={i}
                    color={s.color}
                    onChange={(color) => patch(s.key, { color })}
                  />
                  <Input
                    value={s.name}
                    onChange={(e) => patch(s.key, { name: e.target.value })}
                    placeholder="Stage name"
                    aria-label={`Stage ${i + 1} name`}
                    className="h-9 flex-1 text-sm font-medium"
                  />
                  {isTerminal && (
                    <span className="shrink-0 rounded-full border border-success/40 bg-success-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success-fg">
                      Publish gate
                    </span>
                  )}
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button size="xs" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                      <DynamicIcon name="IconArrowUp" className="size-3.5" />
                    </Button>
                    <Button size="xs" variant="ghost" disabled={i === stages.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                      <DynamicIcon name="IconArrowDown" className="size-3.5" />
                    </Button>
                    <Button
                      size="xs" variant="ghost"
                      disabled={isStoredTerminal || stages.length <= 2}
                      title={isStoredTerminal ? 'The terminal stage cannot be deleted' : undefined}
                      onClick={() => onChange(stages.filter((x) => x.key !== s.key))}
                      aria-label="Delete stage"
                    >
                      <DynamicIcon name="IconTrash" className="size-3.5 text-danger-fg" />
                    </Button>
                  </div>
                </div>
                <StageRoles
                  stage={s}
                  roleOptions={roleOptions ?? []}
                  onChange={(roles) => patch(s.key, { roles })}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-3">
        <Button
          size="xs" variant="secondary" onClick={addStage} disabled={atCap}
          icon={<DynamicIcon name="IconPlus" className="size-3.5" />}
        >
          Add stage
        </Button>
        <span className={cx('text-xs', atCap ? 'font-medium text-warning-fg' : 'text-fg-subtle')}>
          {atCap ? `${MAX_STAGES} stages max - remove one to add another` : `${stages.length} of ${MAX_STAGES} stages`}
        </span>
      </div>
    </section>
  )
}

/** The coverage picker for ONE workflow. */
export function CoverageEditor({
  draft, drafts, types, onChange,
}: {
  draft: DraftWorkflow
  drafts: DraftWorkflow[]
  types: TypeItem[]
  onChange: (patch: Partial<DraftWorkflow>) => void
}) {
  return (
    <section className="min-w-0 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-fg">Covered types</h3>
        <Text variant="help">
          Which content objects this workflow reviews. A type belongs to one workflow only.
        </Text>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4 shadow-xs space-y-4">
        <Toggle
          checked={draft.coveredAll}
          onChange={(next) => onChange({ coveredAll: next })}
          label="All remaining content objects"
        />
        {!draft.coveredAll && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {types.map((t) => {
              const owner = claimOwner(drafts, draft.key, t.name)
              const selected = draft.covered.has(t.name)
              return (
                <button
                  key={t.name}
                  type="button"
                  aria-pressed={selected}
                  disabled={!!owner}
                  title={owner ? `Already reviewed by the ${owner} workflow` : undefined}
                  onClick={() => {
                    const next = new Set(draft.covered)
                    if (next.has(t.name)) next.delete(t.name); else next.add(t.name)
                    onChange({ covered: next })
                  }}
                  className={cx(
                    'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                    owner
                      ? 'cursor-not-allowed border-border bg-surface-sunken opacity-60'
                      : selected
                        ? 'border-accent/30 bg-accent-muted'
                        : 'border-border bg-surface hover:border-border-strong hover:bg-surface-sunken',
                  )}
                >
                  <span className={cx('shrink-0', selected ? 'text-accent-fg' : 'text-fg-subtle')}>
                    <DynamicIcon name={t.admin?.menu?.icon ?? 'IconFileText'} className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cx('block truncate text-sm', selected ? 'font-medium text-accent-fg' : 'text-fg')}>
                      {t.label || t.name}
                    </span>
                    {owner && <span className="block truncate text-[11px] text-fg-subtle">in {owner}</span>}
                  </span>
                  {selected && <DynamicIcon name="IconCheck" className="size-4 shrink-0 text-accent-fg" />}
                </button>
              )
            })}
            {types.length === 0 && <Text variant="help">No content types found.</Text>}
          </div>
        )}
        {!draft.coveredAll && (
          <p className="text-xs text-fg-subtle">
            {draft.covered.size === 0
              ? 'No types yet - this workflow reviews nothing until you pick some.'
              : `${draft.covered.size} of ${types.length} types run through this workflow.`}
          </p>
        )}
      </div>
    </section>
  )
}
