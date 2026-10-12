/**
 * File Name: hook-utils.ts
 * Purpose: Utility helpers for content hooks — extractText for rich text and
 *   forType for per-type hook scoping.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Imports ContentHooks, ContentHookCtx, ContentDeleteCtx from content-hooks.
 */

import type { ContentHooks, ContentHookCtx, ContentDeleteCtx } from './content-hooks'
import type { ContentName, ContentRow } from './registry'

/**
 * Declare per-type content hooks with the row typed from the registry — so
 * `ctx.nextData`/`prevData`/`savedData` are the content type's fields (typos
 * are compile errors) when `tangen types` has run, and loose otherwise.
 * Identity at runtime; returns the loose ContentHooks so composeContentHooks
 * accepts it. Co-locate in content-objects/<type>/hooks.ts.
 *
 * @example
 * export default defineContentHooks('post', {
 *   beforeChange(ctx) { ctx.nextData.subtitle /* typed *\/ },
 * })
 */
export function defineContentHooks<K extends ContentName>(
  _type: K,
  hooks: ContentHooks<ContentRow<K>>,
): ContentHooks {
  return hooks as ContentHooks
}

// ─── extractText ─────────────────────────────────────────────────────────────

/**
 * Extract plain text from a TipTap/ProseMirror JSON richtext field value.
 * Walks all nodes recursively, concatenating text leaves with single spaces.
 * Returns '' on null, undefined, or any malformed input — never throws.
 *
 * @example
 * const text = extractText(ctx.nextData.body)
 * const words = text.split(/\s+/).filter(Boolean).length
 */
export function extractText(json: unknown): string {
  if (!json || typeof json !== 'object') return ''
  try {
    return _walk(json as Record<string, unknown>).trim()
  } catch {
    return ''
  }
}

function _walk(node: Record<string, unknown>): string {
  if (node.type === 'text' && typeof node.text === 'string') {
    return node.text
  }
  const children = node.content
  if (!Array.isArray(children)) return ''
  return children
    .map((child) => {
      const text = _walk(child as Record<string, unknown>)
      // Block-level nodes get a space separator so words don't run together
      const isBlock = ['paragraph', 'heading', 'blockquote', 'listItem', 'codeBlock'].includes(
        (child as Record<string, unknown>).type as string,
      )
      return isBlock ? text + ' ' : text
    })
    .join('')
}

// ─── forType ─────────────────────────────────────────────────────────────────

/**
 * Wrap hooks so they only execute for a specific content type.
 * Eliminates the boilerplate `if (ctx.typeName !== 'post') return` in every hook.
 *
 * @example
 * // content/post/hooks.ts
 * export default forType('post', {
 *   async beforeChange(ctx) {
 *     const text = extractText(ctx.nextData.body)
 *     const words = text.split(/\s+/).filter(Boolean).length
 *     return { readingMinutes: Math.max(1, Math.ceil(words / 200)) }
 *   },
 * })
 */
export function forType(typeName: string, hooks: ContentHooks): ContentHooks {
  const result: ContentHooks = {}

  if (hooks.beforeChange) {
    const fn = hooks.beforeChange
    result.beforeChange = (ctx: ContentHookCtx) =>
      ctx.typeName === typeName ? fn(ctx) : undefined
  }

  if (hooks.afterChange) {
    const fn = hooks.afterChange
    result.afterChange = (ctx: ContentHookCtx & { savedData: Record<string, unknown> }) =>
      ctx.typeName === typeName ? fn(ctx) : undefined
  }

  if (hooks.beforeDelete) {
    const fn = hooks.beforeDelete
    result.beforeDelete = (ctx: ContentDeleteCtx) =>
      ctx.typeName === typeName ? fn(ctx) : undefined
  }

  if (hooks.afterDelete) {
    const fn = hooks.afterDelete
    result.afterDelete = (ctx: ContentDeleteCtx) =>
      ctx.typeName === typeName ? fn(ctx) : undefined
  }

  return result
}

/**
 * Composes several ContentHooks objects into one — the convention for the
 * site's app/hooks/index.ts barrel (per-object hooks + cross-type hooks).
 *
 * Semantics mirror the platform runner exactly: hooks run sequentially in
 * the order given; beforeChange partial results merge with later hooks
 * overriding earlier keys on conflict; a throwing beforeChange/beforeDelete
 * aborts the whole chain (after* errors propagate to the runner, which logs
 * them without failing the write).
 */
export function composeContentHooks(...hookSets: ContentHooks[]): ContentHooks {
  const sets = hookSets.filter(Boolean)
  if (sets.length === 1) return sets[0]
  return {
    beforeChange: async (ctx) => {
      const mutations: Record<string, unknown> = {}
      for (const set of sets) {
        if (!set.beforeChange) continue
        const result = await set.beforeChange(ctx)
        if (result && typeof result === 'object') Object.assign(mutations, result)
      }
      return Object.keys(mutations).length > 0 ? mutations : undefined
    },
    afterChange: async (ctx) => {
      for (const set of sets) await set.afterChange?.(ctx)
    },
    beforeDelete: async (ctx) => {
      for (const set of sets) await set.beforeDelete?.(ctx)
    },
    afterDelete: async (ctx) => {
      for (const set of sets) await set.afterDelete?.(ctx)
    },
  }
}
