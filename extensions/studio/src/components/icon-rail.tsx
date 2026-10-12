/**
 * File Name: icon-rail.tsx
 * Purpose: Studio's left icon rail - one place panels swap in and out, so
 *          the canvas stays the subject rather than losing width to stacked
 *          sidebars.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Behaviour lives in lib/panels.ts (pure, tested); this
 *          renders it. Clicking the ACTIVE panel collapses it, which is how
 *          the canvas gets its width back without hunting for a close
 *          button - the pressed state is what tells you that will happen.
 */
import { clsx } from 'clsx'
import { IconPlus, IconStack, IconFileList, IconPuzzle, IconImage, IconPalette, IconDatabase, IconShare } from '@tangen/icons'
import { STUDIO_PANELS, type PanelState, type StudioPanel } from '../lib/panels'

const ICONS: Record<string, typeof IconPlus> = {
  plus: IconPlus,
  tree: IconStack,
  pages: IconFileList,
  components: IconPuzzle,
  instances: IconShare,
  media: IconImage,
  data: IconDatabase,
  variables: IconPalette,
}

interface IconRailProps {
  state: PanelState
  onPick: (id: string) => void
  /**
   * The panels this member gets (lib/panels.ts `studioPanels`). Passed in
   * rather than filtered here, because which panels a role has is a rule and
   * rules live in the tested module, not in the renderer.
   */
  panels?: StudioPanel[]
}

export function IconRail({ state, onPick, panels = STUDIO_PANELS }: IconRailProps) {
  return (
    <nav
      aria-label="Studio panels"
      className="w-13 shrink-0 flex flex-col items-center gap-1 border-r border-border bg-surface py-2"
      style={{ width: 52 }}
    >
      {panels.map((p) => {
        const Icon = ICONS[p.icon] ?? IconPlus
        const active = state.panel === p.id && state.open
        return (
          <button
            key={p.id}
            type="button"
            title={active ? `Hide ${p.label.toLowerCase()}` : p.label}
            aria-pressed={active}
            onClick={() => onPick(p.id)}
            className={clsx(
              'relative grid place-items-center size-9 rounded-lg transition-colors',
              active ? 'bg-accent-muted text-accent-fg' : 'text-fg-subtle hover:text-fg hover:bg-surface-hover',
            )}
          >
            {active && (
              <span aria-hidden className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-accent" />
            )}
            <Icon className="size-4.5" />
          </button>
        )
      })}
    </nav>
  )
}
