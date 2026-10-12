/**
 * File Name: studio-css-gate.ts
 * Purpose: The store-side gate on a block's custom CSS. Studio keeps a
 *          block's raw CSS under the reserved `_studio.css` key (X-T1), and
 *          it saves through the platform's object create and update routes
 *          like any other block value. The Studio panel gates the box under
 *          `studio:creative` and the compiler refuses anything unsafe, but
 *          neither stops a member WITHOUT the grant from writing the key
 *          through the API. This does: a non-blank `_studio.css` that the
 *          row did not already hold, at any depth, needs the capability.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Called from routes/objects/update.ts and create.ts
 *          with the request's permissions and member id, before the content
 *          hooks run - the same `hasCapability` the Studio routes consult,
 *          so an admin passes, a member needs the grant, and an API key is
 *          held to the same rule (no member, no capability; an admin key
 *          passes). The seam is the route rather than an extension
 *          `beforeChange` hook because the hook context carries the actor's
 *          role but not the resolved permission bundle, and a hook cannot
 *          answer a capability question without re-resolving roles.
 *
 *          "Unchanged" is judged by VALUE, not by block key: every non-blank
 *          CSS string the stored row holds anywhere is allowed to appear
 *          anywhere in the next row, so an editor without the grant can
 *          reorder, move or duplicate sections that already carry CSS, and
 *          can blank one (removing CSS widens nothing). What they cannot do
 *          is make a CSS string the row did not have before. Blank and
 *          whitespace-only values are not CSS and never count.
 *
 *          The capability name is Studio's, declared in its manifest. The
 *          platform names it here because the reserved key is a platform
 *          contract (`_studio` is kept through pruning and localization);
 *          a workspace without Studio has nothing writing the key, and a
 *          member who somehow does is refused, which is the safe side.
 */
import { hasCapability, type MemberAccessContext } from './member-access'
import { RequestError } from './errors'
import { getExtensionCapabilities } from '../hooks/app-hooks-registry'

/** The platform gate a capability declares to allow raw CSS on a block (`gates: ['content.rawCss']` in a manifest). */
export const RAW_CSS_GATE = 'content.rawCss'

/**
 * The capabilities that open the raw-CSS gate, as the REGISTERED manifests
 * declare them (K7: core names the gate, never an extension's capability).
 * Empty when no installed extension declares one, which refuses raw CSS -
 * the safe side, since nothing legitimate is writing the key then.
 */
export function rawCssCapabilities(): string[] {
  return getExtensionCapabilities().filter((c) => (c as { gates?: string[] }).gates?.includes(RAW_CSS_GATE)).map((c) => c.id)
}

/** The reserved per-block bag Studio writes under; `css` inside it is the raw CSS. */
const STUDIO_KEY = '_studio'

/** Every non-blank `_studio.css` under a value, at any depth, trimmed, in document order. */
export function collectStudioCss(value: unknown): string[] {
  const out: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { for (const item of node) walk(item); return }
    if (!node || typeof node !== 'object') return
    const rec = node as Record<string, unknown>
    const bag = rec[STUDIO_KEY]
    if (bag && typeof bag === 'object' && !Array.isArray(bag)) {
      const css = (bag as Record<string, unknown>).css
      if (typeof css === 'string' && css.trim() !== '') out.push(css.trim())
    }
    for (const [k, v] of Object.entries(rec)) {
      if (k === STUDIO_KEY) continue
      walk(v)
    }
  }
  walk(value)
  return out
}

/** The CSS strings `next` carries that `prev` (the stored row, or null on create) did not hold anywhere. */
export function newStudioCss(prev: unknown, next: unknown): string[] {
  const incoming = collectStudioCss(next)
  if (incoming.length === 0) return []
  const held = new Set(collectStudioCss(prev))
  return incoming.filter((css) => !held.has(css))
}

/**
 * Throws 403 when the write would introduce or change a non-blank
 * `_studio.css` and the caller does not hold `studio:creative`.
 * @param ctx - The request's permissions and member id (an API key has none).
 * @param prevData - The stored row, or null on create.
 * @param nextData - The values about to be written.
 */
export function assertStudioCssAllowed(
  ctx: MemberAccessContext,
  prevData: Record<string, unknown> | null,
  nextData: Record<string, unknown>,
): void {
  const added = newStudioCss(prevData, nextData)
  if (added.length === 0) return
  const capabilities = rawCssCapabilities()
  // The gate id itself is never a capability anyone holds: listing it only lets an admin member pass when nothing declares the gate.
  if ([RAW_CSS_GATE, ...capabilities].some((cap) => hasCapability(ctx, cap as never))) return
  const wants = capabilities.length ? capabilities.join(' or ') : 'a capability that opens raw CSS (none is installed here)'
  throw new RequestError(
    'FORBIDDEN',
    `Adding or changing a block's custom CSS requires the ${wants} permission - the rest of the page can be saved once the CSS is left as it was`,
    403,
  )
}
