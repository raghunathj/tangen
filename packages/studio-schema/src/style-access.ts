/**
 * File Name: style-access.ts
 * Purpose: Style ownership - who may style what, and where a protected
 *          Block's boundary actually falls.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A Block is not protected if workspace-global CSS can
 *          still reach its internals. `.card img { width: 500px }` must not
 *          reshape a Locked Block's implementation just because its root
 *          happens to wear `.card`.
 *
 *          So access is DECLARED, never assumed. A Block author exposes named
 *          Style Parts; anything not exposed is unreachable from outside.
 *          Property-level rules matter for the same reason - even styling a
 *          public root can break a widget, because `display:none` on a
 *          checkout is a broken checkout.
 *
 *          This module is the MODEL. The compiler enforces it when generating
 *          CSS, using scoped internal class names rather than trusting naming
 *          conventions - a convention is documentation, not a boundary.
 *
 *          Shadow DOM would enforce this in the browser, and is deliberately
 *          not the default: it complicates SSR, token and typography
 *          inheritance, accessibility tooling and framework adapters.
 */

/** How much of a Block its author opens up. */
export type ProtectionLevel = 'open' | 'guided' | 'locked'

/**
 * Where a style rule comes from. Everything except `block-internal` is
 * OUTSIDE the Block, and outside is what protection constrains.
 */
export type StyleScope = 'workspace' | 'page' | 'component' | 'block-internal'

/** What a rule points at. */
export type StyleTargetKind = 'root' | 'part' | 'internal'

export interface StylePart {
  /** Property ids allowed here. Omitted means every property. */
  properties?: string[]
}

export interface BlockProtection {
  level: ProtectionLevel
  /** Named Style Parts this Block exposes, `root` included. */
  parts?: Record<string, StylePart>
}

export interface StyleTarget {
  kind: StyleTargetKind
  /** Which named part, when `kind` is `part`. */
  part?: string
}

export interface StyleAccessInput {
  /** Absent means Open - a Block opts IN to protection. */
  protection?: BlockProtection
  scope: StyleScope
  target: StyleTarget
  propertyId: string
}

export interface StyleAccess {
  allowed: boolean
  /** Why it was refused, for the panel to show rather than failing silently. */
  reason?: string
}

/**
 * Properties that can break a widget even when applied to its PUBLIC root.
 *
 * These are not banned outright - an Open Block is ordinary content and may
 * use every one of them. They are refused only where a Block author has
 * declared protection, because that author is relying on the element still
 * being laid out and visible.
 */
export const DANGEROUS_PROPERTIES: readonly string[] = Object.freeze([
  'display', 'position', 'overflow', 'height',
])

const ALLOW: StyleAccess = { allowed: true }
const deny = (reason: string): StyleAccess => ({ allowed: false, reason })

/** The parts a designer may target. Empty for Open, which exposes everything. */
export function exposedParts(protection?: BlockProtection): string[] {
  if (!protection || protection.level === 'open') return []
  return Object.keys(protection.parts ?? {})
}

/**
 * A stable, unguessable class for an internal part.
 *
 * The point is that a workspace selector cannot match it: neither the block
 * type, the part name nor the class it is reached through appears in the
 * output, so `.card .price` finds nothing. Stability matters just as much -
 * a name that changed per build would churn every published stylesheet and
 * defeat immutable caching.
 *
 * `via` is the workspace class the part is reached THROUGH. The compiler
 * emits a class aimed at a part under `internalPartClass(type, part,
 * rule.name)` and the runtime stamps `internalPartClass(type, part, worn)`
 * for every class the block wears, so the two meet exactly when the block
 * wears that class. Without it `.card` aimed at the price would restyle the
 * price of every product card on the site, including one wearing `.sale`
 * instead - and the class name a designer chose would mean nothing.
 */
export function internalPartClass(blockType: string, part: string, via: string): string {
  // FNV-1a over the triple. Dependency-free on purpose: this package must
  // stay importable everywhere, including the compiler and the browser
  // runtime. A class name cannot contain a space, so the separator cannot
  // be ambiguous.
  let h = 0x811c9dc5
  const input = `${blockType} ${part} ${via}`
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `tng_${h.toString(36)}`
}

/** Whether one style rule may be written. */
export function styleAccess(input: StyleAccessInput): StyleAccess {
  const { protection, scope, target, propertyId } = input

  // A Block styling itself is not what protection is about. Protection
  // constrains OUTSIDE reach; an author editing their own internals is the
  // normal case and must never be blocked.
  if (scope === 'block-internal') return ALLOW

  // No declaration means Open: ordinary editable content.
  if (!protection || protection.level === 'open') return ALLOW

  if (target.kind === 'internal') {
    return deny(
      'That is an internal part of a protected Block. Its author must expose it as a Style Part before it can be styled from outside.',
    )
  }

  const name = target.kind === 'root' ? 'root' : target.part
  if (!name) return deny('No Style Part was named.')

  const part = protection.parts?.[name]
  if (!part) {
    return deny(`"${name}" is not exposed as a Style Part on this Block.`)
  }

  if (DANGEROUS_PROPERTIES.includes(propertyId)) {
    return deny(
      `"${propertyId}" can break this Block's behaviour, so its author has not made it editable.`,
    )
  }

  if (part.properties && !part.properties.includes(propertyId)) {
    return deny(`"${propertyId}" is not editable on "${name}".`)
  }

  return ALLOW
}
