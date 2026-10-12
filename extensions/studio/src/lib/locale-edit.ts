/**
 * File Name: locale-edit.ts
 * Purpose: What may be edited while viewing a non-default locale.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Only fields marked `localized` have a per-locale
 *          overlay. Everything else - spacing, alignment, structure - is ONE
 *          value shared by every language, so editing it while looking at
 *          French would silently change English too, and the writer would
 *          believe they had only touched French.
 *
 *          Locking those props is therefore not a limitation to apologise
 *          for; it is the thing that keeps translation from corrupting the
 *          source.
 */
import { isLocalizableFieldType, type SubField } from '@tangen/types'

export interface LocaleContext {
  enabled: boolean
  defaultLocale: string
  /** null = the default locale. */
  activeLocale: string | null
  /**
   * Whether Studio can WRITE this locale's overlay. The page decides: the
   * type must have a side table (something marked localized) and the
   * member's role must be allowed the locale. Absent or false, everything
   * locks while translating, because a write would either be refused or
   * land on the source language.
   */
  canWriteOverlay?: boolean
  /** Why the overlay cannot be written, when the page knows. */
  writeRefusal?: string
}

/**
 * Whether one field has a translation of its own. The platform keeps the
 * flag in `config.localized` and only gives a side column to the types that
 * can hold one (text, richtext, number...): media localizes at the asset
 * level and a container is translated through its sub-fields, so neither
 * counts here even when flagged - the server would refuse the overlay.
 */
export function isLocalizedField(field: SubField | undefined): boolean {
  if (!field) return false
  const flagged = (field.config as { localized?: unknown } | undefined)?.localized === true
    || (field as { localized?: unknown }).localized === true
  return flagged && isLocalizableFieldType(String(field.fieldType))
}

/** True when the editor is looking at a locale other than the default. */
export function isTranslating(ctx: LocaleContext): boolean {
  if (!ctx.enabled) return false
  const active = ctx.activeLocale
  return !!active && active !== ctx.defaultLocale
}

/**
 * The row fields of a repeater that have a translation of their own. A
 * repeater is not a localizable TYPE - there is no side column for the whole
 * array - but its rows hold text that is, and the overlay keeps a map under
 * the repeater prop keyed by row `_key` (docs/localization.md). Empty for
 * anything that is not a repeater.
 */
export function localizedRowFields(field: SubField | undefined): SubField[] {
  if (!field || field.fieldType !== 'repeater') return []
  const rows = (field.config as { fields?: unknown } | undefined)?.fields
  if (!Array.isArray(rows)) return []
  return (rows as SubField[]).filter((sf) => isLocalizedField(sf))
}

export interface Editability {
  editable: boolean
  /** Why it is locked - written for the person who clicked it. */
  reason?: string
  /**
   * How an editable prop is written while translating: as one overlay
   * `value`, or row by row (`rows`) for a repeater whose rows carry
   * localized text. Absent when not translating.
   */
  via?: 'value' | 'rows'
}

/** Whether one prop may be edited in the locale currently being viewed. */
export function localeEditability(field: SubField, ctx: LocaleContext): Editability {
  if (!field) return { editable: false }
  if (!isTranslating(ctx)) return { editable: true }

  // No overlay to write to - nothing is editable in another locale, or the
  // write would be refused, or worse, land on the source language.
  if (ctx.canWriteOverlay !== true) {
    return {
      editable: false,
      reason: ctx.writeRefusal
        ?? `${ctx.activeLocale} cannot be translated here. Switch to ${ctx.defaultLocale} to edit.`,
    }
  }

  if (isLocalizedField(field)) return { editable: true, via: 'value' }
  if (localizedRowFields(field).length > 0) return { editable: true, via: 'rows' }
  return {
    editable: false,
    reason: `"${field.label || field.name}" is shared by every language. Switch to ${ctx.defaultLocale} to change it.`,
  }
}

/**
 * A prop bound to a loop record holds the binding, not words. A translation
 * typed over it would be one row's literal text for EVERY row, so while
 * translating a bound prop locks and says where the words actually live.
 * Null for literal text, so the caller falls through to the normal rule.
 */
export function boundTranslationLock(value: unknown, defaultLocale: string): Editability | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (typeof (value as { $bind?: unknown }).$bind !== 'string') return null
  return {
    editable: false,
    reason: `This text comes from the record it is bound to. Translate the record, or unbind it in ${defaultLocale}.`,
  }
}
