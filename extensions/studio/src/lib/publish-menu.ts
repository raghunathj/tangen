/**
 * File Name: publish-menu.ts
 * Purpose: Which lifecycle actions a page offers, given its status.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Studio deliberately does NOT adopt the object editor's
 *          `useObjectLifecycle`: that hook takes thirty-odd options wired to
 *          the editor's own state (dirty locales, panel data, slug editing,
 *          versions) which Studio has no equivalent of. The ENDPOINTS are
 *          the shared thing, and they are few.
 */

export type PublishActionId =
  | 'publish' | 'schedule' | 'unschedule' | 'unpublish' | 'archive' | 'restore'

export interface PublishAction {
  id: PublishActionId
  label: string
  /** Styled apart, and confirmed before running. */
  destructive?: boolean
}

/**
 * The menu for a status. Actions that cannot apply are ABSENT rather than
 * disabled - a menu of greyed-out entries makes people hunt for the state
 * that would enable them.
 */
export function publishActions(status: string, canPublish: boolean): PublishAction[] {
  // Every entry here changes what the public sees.
  if (!canPublish) return []

  if (status === 'archived') {
    // Publishing straight from archived would resurrect a page silently;
    // restoring first makes the intent explicit.
    return [{ id: 'restore', label: 'Restore to draft' }]
  }

  const primary: PublishAction = status === 'published'
    ? { id: 'publish', label: 'Republish' }
    : { id: 'publish', label: 'Publish' }

  const middle: PublishAction[] = status === 'published'
    ? [{ id: 'unpublish', label: 'Unpublish' }]
    : status === 'scheduled'
      ? [{ id: 'unschedule', label: 'Cancel schedule' }]
      : [{ id: 'schedule', label: 'Schedule…' }]

  return [primary, ...middle, { id: 'archive', label: 'Archive', destructive: true }]
}

/** Extension ids and path segments we are willing to build a URL from. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/

/**
 * The admin URL for a publish-policy action. The path comes FROM the
 * extension, so it is validated rather than trusted: an extension must only
 * ever be able to reach its own mount, never climb out of it into another
 * extension's routes or the platform's.
 */
export function policyActionPath(extensionId: string, path: string): string | null {
  if (!SAFE_SEGMENT.test(String(extensionId ?? ''))) return null

  const clean = String(path ?? '').trim()
  if (clean === '' || clean.startsWith('/')) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return null   // a scheme leaves the origin

  const segments = clean.split('/')
  if (!segments.every((seg) => SAFE_SEGMENT.test(seg))) return null

  return `/admin/ext/${extensionId}/${segments.join('/')}`
}
