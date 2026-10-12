/**
 * File Name: crud.ts
 * Purpose: The pure half of form definitions: the slug, the create body,
 *          the defaults, the response sanitiser. The routes live in
 *          ./server.ts as the extension's admin routes.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { RequestError } from './errors'
import { safeRedirectTarget } from './contract'
import type { FormField, FormSettings } from './contract'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Converts a human-readable form name into a URL-safe slug.
 * Lowercases the input, strips non-alphanumeric characters, and replaces whitespace with hyphens.
 * @param name - The raw form name to slugify.
 * @returns A lowercase, hyphen-separated slug string.
 */
export function slugifyFormName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

const DEFAULT_SETTINGS: FormSettings = {
  notifications: [],
  uniqueBy: null,
}

/**
 * Constructs the default field set for a new form row, including a derived slug and
 * empty fields/settings collections.
 * @param input - Form creation parameters (name, workspaceId, optional slug).
 * @returns A complete set of default values ready to be inserted into the forms table.
 */
/** The keys `POST /forms` understands. Anything else is a mistake worth naming. */
const CREATE_FORM_KEYS = new Set(['name', 'slug', 'fields', 'settings', 'isLive'])

/**
 * Reads a create-form body into a row. This used to be `{ name }` and nothing
 * else: a caller who posted a complete definition got 200, an id, and an empty
 * form. Settings MERGE over the defaults so a caller who sets one need not
 * restate the rest, and an unknown key is refused rather than dropped.
 */
export function readCreateFormBody(
  body: unknown,
  ctx: { workspaceId: string},
): ReturnType<typeof buildFormDefaults> {
  const b = (body ?? {}) as Record<string, unknown>
  const unknown = Object.keys(b).filter((k) => !CREATE_FORM_KEYS.has(k))
  if (unknown.length) {
    throw new RequestError(
      'VALIDATION_ERROR',
      `Unknown form ${unknown.length > 1 ? 'keys' : 'key'} ${unknown.map((k) => `"${k}"`).join(', ')}. ` +
      `Supported: ${[...CREATE_FORM_KEYS].sort().join(', ')}.`,
      400,
    )
  }
  if (!b.name || typeof b.name !== 'string') {
    throw new RequestError('VALIDATION_ERROR', 'name is required', 400)
  }
  const defaults = buildFormDefaults({
    name: b.name, workspaceId: ctx.workspaceId, slug: typeof b.slug === 'string' && b.slug ? b.slug : undefined,
  })
  const settings = { ...defaults.settings, ...(b.settings as object ?? {}) }
  assertSafeConfirmationRedirects(settings)
  return {
    ...defaults,
    fields: Array.isArray(b.fields) ? (b.fields as FormField[]) : defaults.fields,
    settings,
    isLive: typeof b.isLive === 'boolean' ? b.isLive : defaults.isLive,
  }
}

/**
 * Refuses a confirmation redirect the embed must not navigate to.
 *
 * pickConfirmation already drops an unsafe target so nothing reaches the
 * browser, which is the gate that matters. This is the other end: stored
 * settings stay clean, and an author who typed something unusable is told at
 * the moment they typed it rather than wondering why the redirect never fires.
 */
export function assertSafeConfirmationRedirects(settings: unknown): void {
  const list = (settings as { confirmations?: Array<Record<string, unknown>> } | undefined)?.confirmations
  if (!Array.isArray(list)) return
  for (const [index, confirmation] of list.entries()) {
    const url = confirmation?.redirectUrl
    if (url === undefined || url === null || url === '') continue
    if (safeRedirectTarget(url) === null) {
      throw new RequestError(
        'VALIDATION_ERROR',
        `Confirmation ${index + 1}: a redirect must be a relative path ("/thanks") or an http(s) URL. ` +
        `The form embed navigates the top window to it, so other schemes are refused.`,
        422,
      )
    }
  }
}

export function buildFormDefaults(input: {
  name: string
  workspaceId: string
  slug?: string
}): {
  name: string
  slug: string
  isLive: boolean
  workspaceId: string
  fields: FormField[]
  settings: FormSettings
} {
  return {
    name: input.name,
    slug: input.slug ?? slugifyFormName(input.name),
    isLive: false,
    workspaceId: input.workspaceId,
    fields: [],
    settings: { ...DEFAULT_SETTINGS },
  }
}

/**
 * Strips or masks any write-only fields from FormSettings before returning them in API
 * responses. Currently a passthrough — placeholder for future secret sanitisation.
 * @param settings - Raw FormSettings from the database.
 * @returns The sanitised FormSettings safe for API responses.
 */
export function sanitizeSettings(settings: FormSettings): FormSettings {
  return settings
}

