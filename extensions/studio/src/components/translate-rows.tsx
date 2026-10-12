/**
 * File Name: translate-rows.tsx
 * Purpose: The inspector's row-translation panel: a repeater's rows, each
 *          with one control per localized row field, editing the active
 *          locale's overlay in place by row `_key`.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: While translating, a repeater cannot be edited as one
 *          value - the array is structure, shared by every language - but
 *          its rows carry text that is localized (a button's label, an
 *          accordion item's title and body). The admin's repeater editor
 *          shows one input per working locale under each row; Studio views
 *          one locale at a time, so this panel is the reverse: the rows of
 *          the base language, and under each the translation.
 *
 *          Reading and writing are the caller's, through locale-overlay.ts,
 *          so the chain this panel writes to is the same one the canvas
 *          previews by. The model (lib/translate-rows.ts) is pure and tested
 *          on its own.
 */
import type { SubField } from '@tangen/types'
import { CompactControl } from './inspector-row'
import { controlKind } from '../lib/control-kind'
import { translationRows, rowTitle, unkeyedRowsReason } from '../lib/translate-rows'
import { translationDraft, translationWrite, isInheritedTranslation } from '../lib/locale-overlay'

interface TranslateRowsProps {
  /** The base rows, as stored in the default locale. */
  rows: unknown
  /** The row fields that have a translation of their own. */
  localized: SubField[]
  /** The translation of one field on one row, or undefined when untranslated. */
  read: (rowKey: string, sub: string) => unknown
  write: (rowKey: string, sub: string, value: unknown) => void
  defaultLocale: string
  workspaceId: string
  typeName?: string
}

export function TranslateRows({ rows, localized, read, write, defaultLocale, workspaceId, typeName }: TranslateRowsProps) {
  const model = translationRows(rows)
  const note = unkeyedRowsReason(model.unkeyed, defaultLocale)
  return (
    <div className="space-y-2" data-studio-translate-rows>
      {model.rows.length === 0 && !note && (
        <p className="text-[11px] text-fg-subtle">No rows to translate yet. Add them in {defaultLocale}.</p>
      )}
      {model.rows.map((row) => (
        <div key={row.key} className="rounded-md border border-border bg-surface-sunken px-2 py-1.5 space-y-1.5">
          <p className="text-[11px] font-medium text-fg-muted truncate" title={rowTitle(row.base, localized, row.index)}>
            {rowTitle(row.base, localized, row.index)}
          </p>
          {localized.map((sf) => {
            const source = row.base[sf.name]
            const translated = read(row.key, sf.name)
            // The row opens on the source text, ready to be rewritten. An
            // untouched one stores nothing: `translationWrite` blanks a value
            // still equal to the source and the save prunes it, so the row
            // keeps falling back to the default language.
            const inherited = isInheritedTranslation(translated, source)
            return (
              <div key={sf.name} className="space-y-0.5">
                {localized.length > 1 && (
                  <span className="block text-[10px] text-fg-subtle">{sf.label || sf.name}</span>
                )}
                <CompactControl
                  field={sf}
                  kind={controlKind(sf)}
                  value={translationDraft(translated, source)}
                  onChange={(v) => write(row.key, sf.name, translationWrite(v, source))}
                  workspaceId={workspaceId}
                  typeName={typeName}
                />
                {inherited && (
                  <span className="block text-[10px] text-fg-subtle">Showing the {defaultLocale} text. Edit it to translate.</span>
                )}
              </div>
            )
          })}
        </div>
      ))}
      {note && <p className="text-[11px] text-fg-subtle">{note}</p>}
    </div>
  )
}
