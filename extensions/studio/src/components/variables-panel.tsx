/**
 * File Name: variables-panel.tsx
 * Purpose: The Variables panel - the workspace's design tokens, applying one
 *          to the selected block, and (T-T4) EDITING them: token values per
 *          family and the font families with their source, written through
 *          the workspace theme (T-T1).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Reads the EFFECTIVE tokens the page already fetched
 *          (GET tokens = defaults + the config seed + the stored theme), so
 *          the panel and the inspector's token pickers can never disagree
 *          about what exists or what a slot is worth.
 *
 *          Every row says where its value comes from - Custom (the store),
 *          From config (the site's seed) or Runtime default (nobody declared
 *          one; the runtime stylesheet's value renders). The old panel
 *          showed a guessed preview for that last case; naming it is the
 *          honest half of making the panel editable, because "Reset to
 *          config" has to mean something a designer can predict.
 *
 *          Editing is offered only when the page hands in the writers
 *          (`onSetToken`, `onSetFont`); without them the panel is the
 *          read-only reference it always was. A save goes to the server and
 *          the page reloads the tokens, so the row the designer sees after
 *          a save is what the store holds - never an optimistic guess that
 *          the stale-write guard might refuse a moment later.
 *
 *          A colleague's theme write is heard live: the panel subscribes to
 *          `studio:classes` (the topic the theme rides, because a token
 *          restyles every page and names no page) and shows "Priya changed
 *          bg-brand, reload to see it" with one Reload. Own writes are
 *          suppressed by actor and by the save this panel just issued, the
 *          conventions of the object editor's ChangedElsewhereNotice and the
 *          Style panel's design notice. Nothing reloads on its own: the
 *          stale-write guard stays the integrity mechanism.
 *
 *          Pure state lives in lib/theme-panel.ts and lib/theme-notice.ts;
 *          this file only draws it.
 */
import { useCallback, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { useRealtime, type RealtimeEvent } from '@/kit'
import { GOOGLE_FONTS } from '@tangen/studio-schema'
import { TOKEN_FAMILIES, type StudioTokens, type TokenFamily, type FontToken } from '../tokens'
import { paletteSwatchCss } from '../lib/style-panel'
import {
  tokenRows, fontRows, fontSourceOf, sourceLabel, tokenInputError, buildFont, FONT_SOURCES,
  type TokenRow, type FontRow, type FontSourceKind, type FontSource, type FontDraft,
} from '../lib/theme-panel'
import {
  isThemeChangeElsewhere, themeNoticeFromEvent, recordThemeChange, formatThemeNotice, type ThemeNotice,
} from '../lib/theme-notice'

interface VariablesPanelProps {
  tokens: StudioTokens
  /** Slot -> effective value, keyed as the runtime reads it (bg-brand, ...). */
  values?: Record<string, string>
  /** The effective fonts, config seed under the stored theme. */
  fonts?: FontToken[]
  /** What the store holds: var names and `font:<name>` entries. */
  overridden?: string[]
  /** Null disables applying - the panel still reads as a reference. */
  canApply: boolean
  onApply: (family: TokenFamily, slot: string) => void
  /** Writes one token value; null resets it to the config value. Absent means read-only. */
  onSetToken?: (varName: string, value: string | null) => void | Promise<void>
  /** Writes one font; null resets it. Absent means read-only. */
  onSetFont?: (name: string, font: FontSource | null) => void | Promise<void>
  /** The environment the page is looking at; absent, the panel hears no theme changes. */
  /** The signed-in member, so their own theme writes coming back are not "elsewhere". */
  currentMemberId?: string | null
  /** Re-reads the tokens after a colleague's write; the notice's Reload calls it. */
  onReload?: () => void | Promise<void>
}

const FAMILY_LABEL: Record<TokenFamily, string> = {
  palette: 'Colours',
  space: 'Spacing',
  type: 'Text sizes',
  radius: 'Corners',
  width: 'Widths',
}

/** The visual for one slot - the same language the token pickers speak. */
function Sample({ row }: { row: TokenRow }) {
  const at = row.at
  switch (row.family) {
    case 'palette':
      return (
        <span
          className="size-4 rounded border border-border-strong shrink-0"
          style={{ background: row.half === 'fg' ? `var(--tg-fg-${row.slot}, ${row.value ?? 'transparent'})` : paletteSwatchCss(row.slot) }}
        />
      )
    case 'space':
      return (
        <span className="flex items-center h-4 w-4 shrink-0">
          <span className="rounded-sm bg-accent-muted border border-accent/40 w-full" style={{ height: `${2 + at * 10}px` }} />
        </span>
      )
    case 'type':
      return (
        <span className="w-4 shrink-0 leading-none text-fg-muted" style={{ fontSize: `${8 + at * 6}px` }}>Aa</span>
      )
    case 'radius':
      return (
        <span
          className="size-4 shrink-0 bg-surface-sunken border border-border-strong"
          style={{ borderRadius: `${at * 8}px` }}
        />
      )
    case 'width':
      return (
        <span className="flex items-center h-4 w-4 shrink-0">
          <span className="h-1 rounded-full bg-accent-muted border border-accent/40" style={{ width: `${4 + at * 12}px` }} />
        </span>
      )
  }
}

/** The small word beside a value saying where it came from. */
function SourceMark({ source }: { source: TokenRow['source'] | FontRow['source'] }) {
  return (
    <span
      className={clsx('shrink-0 text-[9px] uppercase tracking-wide', source === 'override' ? 'text-accent-fg' : 'text-fg-subtle')}
      title={sourceLabel(source)}
      data-source={source}
    >
      {source === 'override' ? 'custom' : source === 'config' ? 'config' : 'default'}
    </span>
  )
}

/** One token's inline editor: a value box (a colour picker too for palette), Save, Reset. */
function TokenEditor({ row, onSave, onReset, onClose }: {
  row: TokenRow
  onSave: (value: string) => void
  onReset: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(row.value ?? '')
  const error = draft.trim() === '' ? null : tokenInputError(row.varName, draft)
  const isColour = row.family === 'palette'
  const hex = /^#[0-9a-fA-F]{6}$/.test(draft.trim()) ? draft.trim() : '#000000'
  return (
    <div className="pl-6 pr-1 pb-1.5 space-y-1" data-testid={`token-editor-${row.varName}`}>
      <div className="flex items-center gap-1">
        {isColour && (
          <input
            type="color"
            value={hex}
            onChange={(e) => setDraft(e.target.value)}
            title="Pick a colour"
            className="size-(--tg-control-h) shrink-0 rounded-md border border-border bg-surface p-0.5 cursor-pointer"
          />
        )}
        <input
          value={draft}
          aria-label={`Value for ${row.varName}`}
          placeholder={row.source === 'runtime' ? 'runtime default' : ''}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
          className="flex-1 min-w-0 h-(--tg-control-h) rounded-md border border-border bg-surface px-1.5 font-mono text-[11px] text-fg focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      {error && <p className="text-[10px] text-danger" role="alert">{error}</p>}
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={!!error || draft.trim() === '' || draft.trim() === (row.value ?? '')}
          onClick={() => onSave(draft.trim())}
          className="h-6 px-2 rounded-md bg-accent text-white text-[11px] font-medium disabled:opacity-50"
        >
          Save
        </button>
        {row.source === 'override' && (
          <button type="button" onClick={onReset} className="h-6 px-2 rounded-md border border-border text-[11px] text-fg-muted hover:bg-surface-hover">
            Reset to config
          </button>
        )}
        <button type="button" onClick={onClose} className="h-6 px-2 rounded-md text-[11px] text-fg-subtle hover:bg-surface-hover">
          Cancel
        </button>
      </div>
    </div>
  )
}

/** One font's editor: the source picker and the field for that source. */
function FontEditor({ name, initial, isOverride, onSave, onReset, onClose }: {
  name: string
  initial?: FontToken
  isOverride: boolean
  onSave: (font: FontSource) => void
  onReset: () => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<FontSourceKind>(initial ? fontSourceOf(initial) : 'google')
  const [draft, setDraft] = useState<FontDraft>({
    google: initial?.google ?? '',
    stack: initial?.stack ?? '',
    files: (initial?.files ?? []).map((f) => [f.url, f.weight, f.style].filter((v) => v !== undefined).join(' ')).join('\n'),
  })
  const built = buildFont(kind, draft)
  const error = 'error' in built ? built.error : null
  const field = 'h-(--tg-control-h) w-full rounded-md border border-border bg-surface px-1.5 text-[11px] text-fg focus:outline-none focus:ring-1 focus:ring-accent'
  return (
    <div className="pl-1 pr-1 pb-1.5 space-y-1" data-testid={`font-editor-${name}`}>
      <select
        value={kind}
        aria-label={`Source for ${name}`}
        onChange={(e) => setKind(e.target.value as FontSourceKind)}
        className={clsx(field, 'appearance-none cursor-pointer')}
      >
        {FONT_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      {kind === 'google' && (
        <select
          value={draft.google ?? ''}
          aria-label={`Google family for ${name}`}
          onChange={(e) => setDraft({ ...draft, google: e.target.value })}
          className={clsx(field, 'appearance-none cursor-pointer')}
        >
          <option value="">Pick a family</option>
          {GOOGLE_FONTS.map((f) => <option key={f.name} value={f.name}>{f.name} ({f.category})</option>)}
        </select>
      )}
      {kind === 'stack' && (
        <input
          value={draft.stack ?? ''}
          aria-label={`System stack for ${name}`}
          placeholder="Georgia, serif"
          onChange={(e) => setDraft({ ...draft, stack: e.target.value })}
          className={clsx(field, 'font-mono')}
        />
      )}
      {kind === 'files' && (
        <textarea
          value={draft.files ?? ''}
          aria-label={`Files for ${name}`}
          rows={3}
          placeholder={'/fonts/brand-regular.woff2 400\n/fonts/brand-bold.woff2 700'}
          onChange={(e) => setDraft({ ...draft, files: e.target.value })}
          className="w-full rounded-md border border-border bg-surface px-1.5 py-1 font-mono text-[11px] text-fg focus:outline-none focus:ring-1 focus:ring-accent"
        />
      )}
      {error && <p className="text-[10px] text-fg-subtle">{error}</p>}
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={!!error}
          onClick={() => { if ('font' in built) onSave(built.font) }}
          className="h-6 px-2 rounded-md bg-accent text-white text-[11px] font-medium disabled:opacity-50"
        >
          Save
        </button>
        {isOverride && (
          <button type="button" onClick={onReset} className="h-6 px-2 rounded-md border border-border text-[11px] text-fg-muted hover:bg-surface-hover">
            Reset to config
          </button>
        )}
        <button type="button" onClick={onClose} className="h-6 px-2 rounded-md text-[11px] text-fg-subtle hover:bg-surface-hover">
          Cancel
        </button>
      </div>
    </div>
  )
}

/** The strip above the rows: one line per entry a colleague changed, and one Reload. */
export function ThemeChangeNotices({ notices, onReload }: { notices: readonly ThemeNotice[]; onReload: () => void }) {
  if (notices.length === 0) return null
  return (
    <div
      className="mx-1 mt-2 rounded-md border border-warning/40 bg-warning-muted px-2 py-1.5 space-y-1"
      role="status"
      data-testid="theme-notices"
    >
      {notices.map((n) => (
        <p key={n.name} className="text-[11px] text-fg">{formatThemeNotice(n)}</p>
      ))}
      <button
        type="button"
        onClick={onReload}
        className="h-6 px-2 rounded-md border border-border bg-surface text-[11px] font-medium text-fg hover:bg-surface-hover"
      >
        Reload
      </button>
    </div>
  )
}

export function VariablesPanel({
  tokens, values, fonts, overridden, canApply, onApply, onSetToken, onSetFont, currentMemberId, onReload,
}: VariablesPanelProps) {
  const editable = !!onSetToken
  const [editing, setEditing] = useState<string | null>(null)
  const [editingFont, setEditingFont] = useState<string | null>(null)
  const [newFont, setNewFont] = useState('')
  const fontList = fontRows(fonts ?? [], overridden ?? [])

  // ── Theme changes heard live ──────────────────────────────────────────────
  // A token is workspace-wide: a colleague's write lands in the store while
  // this panel still holds the old rev, and the NEXT save here is refused
  // as stale. The bus says so first. A write this panel issues is stamped,
  // so its own echo (which can arrive before the response) is never a notice.
  const [notices, setNotices] = useState<ThemeNotice[]>([])
  const saveIssuedAtRef = useRef<number | null>(null)
  const onThemeEvent = useCallback((event: RealtimeEvent) => {
    if (!isThemeChangeElsewhere(event, { currentMemberId: currentMemberId ?? null, saveIssuedAt: saveIssuedAtRef.current })) return
    setNotices((list) => recordThemeChange(list, themeNoticeFromEvent(event)))
  }, [currentMemberId])
  useRealtime('studio:classes', onThemeEvent, { enabled: true })
  const setToken = onSetToken
    ? (varName: string, value: string | null) => { saveIssuedAtRef.current = Date.now(); return onSetToken(varName, value) }
    : undefined
  const setFont = onSetFont
    ? (name: string, font: FontSource | null) => { saveIssuedAtRef.current = Date.now(); return onSetFont(name, font) }
    : undefined
  const reload = () => { setNotices([]); void onReload?.() }

  return (
    <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-2" data-editable={editable ? 'true' : 'false'}>
      <ThemeChangeNotices notices={notices} onReload={reload} />
      {!canApply && (
        <p className="px-1 py-2 text-[11px] text-fg-subtle">
          Select a block to apply a variable to it.{editable ? ' Click a value to change it for the whole workspace.' : ''}
        </p>
      )}
      {TOKEN_FAMILIES.map((family) => {
        const rows = tokenRows(family, tokens, values ?? {}, overridden ?? [])
        if (rows.length === 0) return null
        return (
          <div key={family} className="mb-2">
            <p className="px-1 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
              {FAMILY_LABEL[family]}
            </p>
            {rows.map((row) => (
              <div key={row.varName}>
                <div className="w-full flex items-center gap-2 px-1.5 py-1 rounded">
                  <button
                    type="button"
                    disabled={!canApply}
                    onClick={() => onApply(family, row.slot)}
                    title={canApply ? `Apply ${row.slot}` : row.slot}
                    className={clsx(
                      'flex items-center gap-2 min-w-0 flex-1 text-left',
                      'text-(length:--tg-text-label) text-fg',
                      canApply ? 'hover:bg-surface-hover' : 'cursor-default opacity-70',
                    )}
                  >
                    <Sample row={row} />
                    <span className="flex-1 min-w-0 truncate">
                      {row.slot}{row.half ? <span className="text-fg-subtle"> / {row.half === 'bg' ? 'background' : 'text'}</span> : null}
                    </span>
                  </button>
                  {/* The value, or an honest "default" when nobody declared one. */}
                  <button
                    type="button"
                    disabled={!editable}
                    onClick={() => setEditing(editing === row.varName ? null : row.varName)}
                    title={editable ? `Change ${row.varName}` : row.value ?? sourceLabel(row.source)}
                    className={clsx(
                      'shrink-0 max-w-28 truncate text-[10px] tabular-nums rounded px-1',
                      row.value ? 'text-fg-subtle' : 'text-fg-subtle italic',
                      editable ? 'hover:bg-surface-hover cursor-pointer' : 'cursor-default',
                    )}
                    data-varname={row.varName}
                  >
                    {row.value ?? 'default'}
                  </button>
                  <SourceMark source={row.source} />
                </div>
                {editable && editing === row.varName && (
                  <TokenEditor
                    row={row}
                    onSave={(v) => { setEditing(null); void setToken?.(row.varName, v) }}
                    onReset={() => { setEditing(null); void setToken?.(row.varName, null) }}
                    onClose={() => setEditing(null)}
                  />
                )}
              </div>
            ))}
          </div>
        )
      })}

      {/* Fonts: named faces the stylesheet LOADS, each from one source. */}
      <div className="mb-2">
        <p className="px-1 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Fonts</p>
        {fontList.length === 0 && (
          <p className="px-1.5 py-1 text-[11px] text-fg-subtle">No fonts declared. The runtime's system stack renders.</p>
        )}
        {fontList.map((row) => (
          <div key={row.name}>
            <div className="w-full flex items-center gap-2 px-1.5 py-1 rounded">
              <span className="flex-1 min-w-0 truncate text-(length:--tg-text-label) text-fg" style={{ fontFamily: `var(--tg-font-${row.name})` }}>
                {row.name}
              </span>
              <button
                type="button"
                disabled={!onSetFont}
                onClick={() => setEditingFont(editingFont === row.name ? null : row.name)}
                title={onSetFont ? `Change ${row.name}` : row.summary}
                className={clsx('shrink-0 max-w-32 truncate text-[10px] text-fg-subtle rounded px-1', onSetFont ? 'hover:bg-surface-hover cursor-pointer' : 'cursor-default')}
                data-font={row.name}
              >
                {row.summary}
              </button>
              <SourceMark source={row.source} />
            </div>
            {onSetFont && editingFont === row.name && (
              <FontEditor
                name={row.name}
                initial={row.font}
                isOverride={row.source === 'override'}
                onSave={(font) => { setEditingFont(null); void setFont?.(row.name, font) }}
                onReset={() => { setEditingFont(null); void setFont?.(row.name, null) }}
                onClose={() => setEditingFont(null)}
              />
            )}
          </div>
        ))}
        {onSetFont && (
          <div className="px-1.5 pt-1 space-y-1">
            {editingFont === '__new__' ? (
              <FontEditor
                name={newFont}
                isOverride={false}
                onSave={(font) => { setEditingFont(null); void setFont?.(newFont, font); setNewFont('') }}
                onReset={() => setEditingFont(null)}
                onClose={() => setEditingFont(null)}
              />
            ) : (
              <div className="flex items-center gap-1">
                <input
                  value={newFont}
                  aria-label="New font name"
                  placeholder="Name, like Display"
                  onChange={(e) => setNewFont(e.target.value)}
                  className="flex-1 min-w-0 h-(--tg-control-h) rounded-md border border-border bg-surface px-1.5 text-[11px] text-fg focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <button
                  type="button"
                  disabled={!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(newFont) || fontList.some((f) => f.name === newFont)}
                  onClick={() => setEditingFont('__new__')}
                  className="h-(--tg-control-h) px-2 rounded-md border border-border text-[11px] text-fg-muted hover:bg-surface-hover disabled:opacity-50"
                >
                  Add font
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
