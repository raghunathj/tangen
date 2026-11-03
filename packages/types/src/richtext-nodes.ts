/**
 * File Name: richtext-nodes.ts
 * Purpose: An extension contributes a richtext node by DECLARING one - slice
 *          5 of tasks/plan-editor.md. The declaration is data: a name, the
 *          attributes it carries, what it may contain, and the element it
 *          becomes. The platform renders it; nothing the extension wrote
 *          runs.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Shaped on ADMIN SLOTS (admin-slots.ts), not on the
 *          `fieldTypeUIs` convention. Slots are manifest-declared,
 *          descriptor-only, versioned, grant-gated, shape-validated and
 *          deterministically ordered; `fieldTypeUIs` has no ref, no version,
 *          no grant, last-write-wins, and is enforced by a source-text regex.
 *
 *          DEVIATION FROM THE PLAN, and the reason: the plan said to declare
 *          a `richtext.nodes@1` contribution point. A contribution point is
 *          read off the SERVER ENTRY, which exists to carry handlers - and a
 *          node declaration has no handler to carry. It also has to reach the
 *          BROWSER, so the editor can offer it. Manifest-only is therefore
 *          the honest shape, exactly as slots are, and declaring a
 *          contribution point as well would add a registry nothing reads.
 *          The `@1` in the point name survives as the vocabulary version
 *          below.
 */
import type { ContentDocAttr, ContentDocContent, ContentDocNodeSpec } from './content-doc'

/** The grant an extension must hold to contribute any richtext node. */
export const RICHTEXT_CONTRIBUTE_GRANT = 'richtext:contribute-nodes'

/** The declaration vocabulary's own major. A node declares which it speaks. */
export const RICHTEXT_NODES_VERSION = 1

export interface ExtensionRichtextNode {
  /**
   * The node's `type` in a stored document. Namespaced by the extension at
   * registration (`<extensionId>.<name>`), so two extensions cannot collide
   * and a stored document always says who owns its node.
   */
  name: string
  /** What an editor calls it. */
  label: string
  /** Where it may sit, and what it may hold. */
  group: 'block' | 'inline'
  content: ContentDocContent
  /**
   * The element it becomes. A `{attr}` hole names one of its own attrs, which
   * is the single substitution the spec allows.
   */
  tag: string
  /** No closing tag and no children. */
  void?: boolean
  attrs?: Record<string, ContentDocAttr>
  /** Which attrs reach the HTML element, mapped to the attribute name. */
  htmlAttrs?: Record<string, string>
  /** Higher offers first in the editor; default 0. Ties break by name. */
  priority?: number
}

/** A tag HTML has no business receiving from a declaration. */
const REFUSED_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base',
  'form', 'input', 'button', 'textarea', 'select', 'svg', 'math',
])

/** An attribute no declaration may map to, whatever it is called. */
const REFUSED_HTML_ATTRS = /^(on|srcdoc$|formaction$)/i

/**
 * Everything wrong with a set of declarations, as `{ path, message }` - the
 * shape `validateExtensionManifest` reports.
 *
 * Shape only. The grant is a separate question, answered by
 * `allowedRichtextNodes`, exactly as it is for slots.
 */
export function validateRichtextNodes(input: unknown): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = []
  if (input === undefined) return issues
  if (!Array.isArray(input)) {
    return [{ path: 'richtextNodes', message: 'must be an array of node declarations' }]
  }
  const seen = new Set<string>()
  input.forEach((raw, i) => {
    const at = `richtextNodes[${i}]`
    const n = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
    if (!n) { issues.push({ path: at, message: 'must be an object' }); return }

    const name = n.name
    if (typeof name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) {
      issues.push({ path: `${at}.name`, message: 'must be a camelCase name starting with a letter' })
    } else if (seen.has(name)) {
      issues.push({ path: `${at}.name`, message: `"${name}" is declared twice` })
    } else {
      seen.add(name)
    }

    if (typeof n.label !== 'string' || n.label.trim() === '') {
      issues.push({ path: `${at}.label`, message: 'must be a non-empty string' })
    }
    if (n.group !== 'block' && n.group !== 'inline') {
      issues.push({ path: `${at}.group`, message: "must be 'block' or 'inline'" })
    }
    if (!['blocks', 'inline', 'text', 'none'].includes(String(n.content))) {
      issues.push({ path: `${at}.content`, message: "must be 'blocks', 'inline', 'text' or 'none'" })
    }

    const tag = n.tag
    if (typeof tag !== 'string' || !/^[a-zA-Z][a-zA-Z0-9-]*(\{[a-zA-Z0-9_]+\})?[a-zA-Z0-9-]*$/.test(tag)) {
      issues.push({ path: `${at}.tag`, message: 'must be an HTML element name, optionally with one {attr} hole' })
    } else if (REFUSED_TAGS.has(tag.replace(/\{[^}]*\}/g, '').toLowerCase())) {
      issues.push({ path: `${at}.tag`, message: `"${tag}" cannot be declared - it executes or loads` })
    }

    if (n.htmlAttrs !== undefined) {
      const map = n.htmlAttrs && typeof n.htmlAttrs === 'object' ? (n.htmlAttrs as Record<string, unknown>) : null
      if (!map) {
        issues.push({ path: `${at}.htmlAttrs`, message: 'must be a map of attr name to HTML attribute name' })
      } else {
        for (const [key, out] of Object.entries(map)) {
          if (typeof out !== 'string' || out === '') {
            issues.push({ path: `${at}.htmlAttrs.${key}`, message: 'must be an HTML attribute name' })
          } else if (REFUSED_HTML_ATTRS.test(out)) {
            issues.push({ path: `${at}.htmlAttrs.${key}`, message: `"${out}" cannot be set from a declaration` })
          } else if (!n.attrs || !(key in (n.attrs as Record<string, unknown>))) {
            issues.push({ path: `${at}.htmlAttrs.${key}`, message: `"${key}" is not a declared attr of this node` })
          }
        }
      }
    }
  })
  return issues
}

/**
 * The declarations an extension may actually contribute: its own, namespaced,
 * only if it holds the grant, in deterministic order.
 *
 * No grant means no nodes at all - the same rule slots follow, and the same
 * reason: there is no trusted class of extension.
 */
export function allowedRichtextNodes(
  extensionId: string,
  manifest: { richtextNodes?: ExtensionRichtextNode[] } | null | undefined,
  grants: readonly string[],
): Array<ExtensionRichtextNode & { name: string }> {
  const items = manifest?.richtextNodes ?? []
  if (items.length === 0) return []
  if (!grants.includes(RICHTEXT_CONTRIBUTE_GRANT)) return []
  if (validateRichtextNodes(items).length > 0) return []
  return [...items]
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name))
    .map((n) => ({ ...n, name: `${extensionId}.${n.name}` }))
}

/** One declaration as the vocabulary holds it. */
export function richtextNodeSpec(node: ExtensionRichtextNode): ContentDocNodeSpec {
  return {
    group: node.group,
    content: node.content,
    tag: node.tag,
    ...(node.void ? { void: true } : {}),
    ...(node.attrs ? { attrs: node.attrs } : {}),
    ...(node.htmlAttrs ? { htmlAttrs: node.htmlAttrs } : {}),
  }
}
