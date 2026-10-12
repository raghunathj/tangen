/**
 * File Name: surface-band.tsx
 * Purpose: The shared surfaces on the canvas and in the navigator - a header
 *          band above the page and a footer band below it, each marked as
 *          shared across every page, with the way in, the way back, and the
 *          explicit Save a global needs because it has no draft.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pinned OUTSIDE the page body on purpose: the page's
 *          sections autosave to a draft, a surface saves live to every page,
 *          and two things that behave that differently must not look like
 *          one list. The band never renders the blocks - the site's preview
 *          does that from the saved global - so it says so, rather than
 *          letting an unsaved edit look applied.
 */
import { clsx } from 'clsx'
import { IconGlobe, IconArrowLeft, IconLock } from '@tangen/icons'
import { surfaceLabel, type LoadedSurface, type SurfacePosition } from '../lib/global-surfaces'
import { SurfacePresence, type PresenceScopeProps } from './block-presence'

export type SurfaceAccess = { ok: true } | { ok: false; reason: string }

/** The page scope the band reads presence from, and the navigator's labels for "editing Nav links". */
export type SurfaceBandPresence = PresenceScopeProps & { labelFor?: (blockKey: string) => string | null }

export interface SurfaceBandProps {
  position: SurfacePosition
  /** The surfaces pinned at this edge. */
  surfaces: LoadedSurface[]
  /** The surface being edited, if any (the page otherwise). */
  active: string | null
  /** Globals with unsaved changes. */
  dirty: ReadonlySet<string>
  /** Whether this member may save a given surface - the server's rule, restated. */
  access: (global: string) => SurfaceAccess
  /** The surface whose save is in flight. */
  saving: string | null
  onEnter: (global: string) => void
  onLeave: () => void
  onSave: (global: string) => void
  onDiscard: (global: string) => void
  /** Present when the band should say who else is in each surface right now. */
  presence?: SurfaceBandPresence
}

const BTN = 'h-6 px-2 rounded text-[11px] font-medium disabled:opacity-50 disabled:cursor-not-allowed'

/**
 * One row per surface. Above the canvas for the header, below for the
 * footer; nothing at all when the workspace declares none at that edge, so a
 * site without shared surfaces sees no chrome for a feature it does not use.
 */
export function SurfaceBand({
  position, surfaces, active, dirty, access, saving, onEnter, onLeave, onSave, onDiscard, presence,
}: SurfaceBandProps) {
  if (surfaces.length === 0) return null
  return (
    <div
      data-studio-surface-band={position}
      className={clsx(
        'shrink-0 flex flex-col bg-surface-sunken',
        position === 'header' ? 'border-b border-border' : 'border-t border-border',
      )}
    >
      {surfaces.map(({ surface, blocks }) => {
        const g = surface.global
        const editing = active === g
        const unsaved = dirty.has(g)
        const may = access(g)
        const busy = saving === g
        return (
          <div
            key={g}
            data-studio-surface={g}
            className={clsx(
              'flex items-center gap-2 px-3 h-8 text-[11px]',
              editing ? 'bg-accent-muted/60 text-fg' : 'text-fg-muted',
            )}
          >
            <IconGlobe className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
            <span className="font-medium truncate">{surfaceLabel(surface)}</span>
            <span className="text-fg-subtle shrink-0" title="A global: one copy, every page renders it">
              shared across every page
            </span>
            <span className="text-fg-subtle shrink-0 tabular-nums">
              {blocks.length} {blocks.length === 1 ? 'block' : 'blocks'}
            </span>
            {editing && (
              <span className="shrink-0 px-1.5 rounded bg-accent-muted text-accent-fg font-medium">Editing</span>
            )}
            {unsaved && (
              <span
                className="shrink-0 px-1.5 rounded bg-warning-muted text-warning font-medium"
                title="The preview shows the saved version until you save"
              >
                Unsaved
              </span>
            )}
            {!may.ok && (
              <span className="flex items-center gap-1 shrink-0 text-fg-subtle" title={may.reason}>
                <IconLock className="size-3" aria-hidden />
                read only
              </span>
            )}
            {presence && (
              <SurfacePresence objectId={presence.objectId} currentMemberId={presence.currentMemberId} global={g} labelFor={presence.labelFor} />
            )}
            <span className="flex-1" />
            {unsaved && (
              <>
                <button
                  type="button"
                  onClick={() => onDiscard(g)}
                  disabled={busy}
                  className={clsx(BTN, 'text-fg-muted hover:text-fg hover:bg-surface-hover')}
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => onSave(g)}
                  disabled={busy || !may.ok}
                  title={may.ok
                    ? `Save ${surface.label} - goes live on every page at once, there is no draft`
                    : may.reason}
                  className={clsx(BTN, 'bg-accent text-fg-inverted hover:opacity-90')}
                >
                  {busy ? 'Saving…' : `Save ${position}`}
                </button>
              </>
            )}
            {editing ? (
              <button
                type="button"
                onClick={onLeave}
                className={clsx(BTN, 'flex items-center gap-1 text-fg-muted hover:text-fg hover:bg-surface-hover')}
              >
                <IconArrowLeft className="size-3" aria-hidden />
                Back to page
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onEnter(g)}
                title={may.ok ? `Edit the ${position} every page shares` : `${may.reason} You can look, not change.`}
                className={clsx(BTN, 'text-accent-fg hover:bg-accent-muted')}
              >
                {may.ok ? 'Edit' : 'View'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

export interface SurfacePinProps {
  label: string
  count: number
  /** Shared surfaces say so; the page pin does not. */
  shared?: boolean
  unsaved?: boolean
  onOpen: () => void
}

/**
 * A pinned row in the navigator for a document that is NOT the one being
 * edited - the header above the page's tree, the footer below it, or the
 * page itself while a surface is open. Clicking opens it.
 */
export function SurfacePin({ label, count, shared, unsaved, onOpen }: SurfacePinProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-studio-surface-pin=""
      className="w-full flex items-center gap-2 px-2 h-7 rounded-md text-left text-xs text-fg-muted hover:text-fg hover:bg-surface-hover"
    >
      {shared ? <IconGlobe className="size-3.5 shrink-0 text-fg-subtle" aria-hidden /> : <IconArrowLeft className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />}
      <span className="flex-1 min-w-0 truncate font-medium">{label}</span>
      {shared && <span className="text-[10px] text-fg-subtle shrink-0">shared</span>}
      {unsaved && <span className="size-1.5 rounded-full bg-warning shrink-0" title="Unsaved changes" />}
      <span className="text-[10px] text-fg-subtle tabular-nums shrink-0">{count}</span>
    </button>
  )
}
