/**
 * File Name: use-locale-drafts.ts
 * Purpose: Per-locale inline translation drafts for the object editor (R5 of the
 *          SRP refactor): the drafts map seeded from the loaded i18n side-table
 *          values, dirty-locale tracking, single-field and BL-4 container-overlay
 *          draft updates, and saveDirtyLocales (the per-locale PATCH fan-out that
 *          runs as part of Save/Publish).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: i18nMap/i18nLoaded stay with the editor's load path and are
 * passed in; saveDirtyLocales refreshes the map through setI18nMap so the
 * drafts-init effect re-seeds translation inputs after every save. The
 * setLocaleContainerSubRef / setLocaleContainerPathRef latest-refs are returned
 * because the editor's memoized blockLocaleCtx closures must read the newest
 * draft state without re-minting their identity (FieldControl memo contract).
 * The path setter serves nested containers (a kit heading inside a section):
 * the overlay shape is the platform's nested map (docs/localization.md).
 */
import { useEffect, useRef, useState } from 'react'
import { adminFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { buildLocaleSavePayload, setOverlayPath } from '@/lib/editor'

export interface UseLocaleDraftsOpts {
  /** null when localization is disabled for the workspace. */
  localesInfo: { defaultLocale: string; locales: Array<{ code: string }> } | null
  i18nLoaded: boolean
  i18nMap: Record<string, Record<string, unknown>>
  setI18nMap: (updater: (m: Record<string, Record<string, unknown>>) => Record<string, Record<string, unknown>>) => void
  /** Localized top-level fields of the current type (name is all we read). */
  localizedFields: Array<{ name: string }>
  /** BL-4: container fields (component/repeater) with localized sub-fields. */
  localizedContainers: string[]
  /** False when the type has no i18n side table — nothing can be saved. */
  typeIsLocalizable: boolean
  typeName: string
}

export function useLocaleDrafts(opts: UseLocaleDraftsOpts) {
  const {
    localesInfo, i18nLoaded, i18nMap, setI18nMap,
    localizedFields, localizedContainers, typeIsLocalizable, typeName, } = opts

  const [localeDrafts, setLocaleDrafts] = useState<Record<string, Record<string, unknown>>>({})
  const [dirtyLocales, setDirtyLocales] = useState<Set<string>>(new Set())

  // Initialize per-locale drafts from the loaded translations map
  useEffect(() => {
    if (!i18nLoaded || !localesInfo) return
    const drafts: Record<string, Record<string, unknown>> = {}
    for (const l of localesInfo.locales) {
      if (l.code === localesInfo.defaultLocale) continue
      const entry = i18nMap[l.code] ?? {}
      drafts[l.code] = {
        title: entry.__title ?? '',
        ...Object.fromEntries(localizedFields.map((f) => [f.name, entry[f.name] ?? null])),
        ...Object.fromEntries(localizedContainers.map((name) => [name, entry[name] ?? {}])),
      }
    }
    setLocaleDrafts(drafts)
    setDirtyLocales(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18nLoaded, i18nMap, localesInfo?.defaultLocale, localizedFields, localizedContainers])

  /** BL-4: one translated sub-value inside a block/row — nested draft update. */
  function setLocaleContainerSub(locale: string, container: string, rowKey: string, sub: string, value: unknown) {
    setLocaleDrafts((d) => {
      const cur = (d[locale]?.[container] ?? {}) as Record<string, Record<string, unknown>>
      const entry = { ...(cur[rowKey] ?? {}), [sub]: value }
      return { ...d, [locale]: { ...(d[locale] ?? {}), [container]: { ...cur, [rowKey]: entry } } }
    })
    setDirtyLocales((prev) => new Set(prev).add(locale))
  }

  /**
   * One translated sub-value at a NESTED address inside a container - a
   * heading in a section in a container, a button label in a row column:
   * `path` is `[blockKey, slot, blockKey, ..., sub]`. Functional update, so
   * a scoped ctx deep in the tree never writes over a sibling's keystroke.
   */
  function setLocaleContainerPath(locale: string, container: string, path: string[], value: unknown) {
    setLocaleDrafts((d) => ({
      ...d,
      [locale]: { ...(d[locale] ?? {}), [container]: setOverlayPath(d[locale]?.[container], path, value) },
    }))
    setDirtyLocales((prev) => new Set(prev).add(locale))
  }

  function setLocaleField(locale: string, name: string, value: unknown) {
    setLocaleDrafts((d) => ({ ...d, [locale]: { ...(d[locale] ?? {}), [name]: value } }))
    setDirtyLocales((prev) => new Set(prev).add(locale))
  }

  // Latest setLocaleContainerSub without effects - the editor's memoized ctx
  // closures read through this ref so they never go stale.
  const setLocaleContainerSubRef = useRef(setLocaleContainerSub)
  setLocaleContainerSubRef.current = setLocaleContainerSub
  const setLocaleContainerPathRef = useRef(setLocaleContainerPath)
  setLocaleContainerPathRef.current = setLocaleContainerPath

  /** Persists every dirty locale's inline drafts (runs as part of Save). */
  async function saveDirtyLocales(objectId: string) {
    if (dirtyLocales.size === 0) return
    // No side table for this type — nothing can be saved. Drop the dirty marks so a
    // stray locale draft never triggers an endless failing autosave.
    if (!typeIsLocalizable) { setDirtyLocales(new Set()); return }
    // Independent side-table rows - save all locales concurrently instead of
    // serializing up to 5 round-trips per Save.
    await Promise.allSettled([...dirtyLocales].map(async (locale) => {
      const draft = localeDrafts[locale] ?? {}
      const payload = buildLocaleSavePayload(draft, localizedFields, localizedContainers)
      try {
        await adminFetch(`/objects/${typeName}/${objectId}?locale=${locale}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
        const entry: Record<string, unknown> = {}
        if (payload.title) entry.__title = payload.title
        for (const f of localizedFields) {
          if (payload[f.name] !== null && payload[f.name] !== undefined) entry[f.name] = payload[f.name]
        }
        // BL-4: container overlays must survive the map refresh — the drafts-init
        // effect re-seeds ALL translation inputs from this map after every save.
        for (const name of localizedContainers) {
          if (payload[name] !== null && payload[name] !== undefined) entry[name] = payload[name]
        }
        setI18nMap((m) => ({ ...m, [locale]: entry }))
      } catch (e: any) {
        toast.error(`Could not save ${locale} translation`, e.message)
      }
    }))
    // Clear dirty marks even when saves failed - the autosave effect re-fires
    // on dirtyLocales, so leaving them set would retry a permanent error forever.
    setDirtyLocales(new Set())
  }

  return {
    localeDrafts, dirtyLocales,
    setLocaleField, setLocaleContainerSub, setLocaleContainerSubRef,
    setLocaleContainerPath, setLocaleContainerPathRef,
    saveDirtyLocales,
  }
}
