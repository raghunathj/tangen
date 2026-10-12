/**
 * File Name: preview-handler.ts
 * Purpose: Implements Next.js App Router GET route handlers for enabling and disabling Tangen content preview mode, validating tokens against the Tangen API.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Dynamically imports next/headers to support both Next.js 14 (sync draftMode) and 15+ (async draftMode); gracefully no-ops outside the Next.js runtime.
 */
const PREVIEW_COOKIE = 'tangen_preview_token'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Extracts the ?token= query parameter from a URL string, returning null if absent or empty.
 * @param url - The full request URL string
 * @returns The token string or null
 */
export function extractToken(url: string): string | null {
  const token = new URL(url).searchParams.get('token')
  return token?.trim() || null
}

/**
 * Builds a Set-Cookie header value that stores the preview token as an HttpOnly cookie.
 * @param token - The preview token to store
 * @returns A Set-Cookie header string
 */
export function buildPreviewCookie(token: string): string {
  return `${PREVIEW_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`
}

/**
 * Builds a Set-Cookie header value that clears the preview token cookie by setting Max-Age=0.
 * @returns A Set-Cookie header string that expires the preview cookie
 */
export function buildClearPreviewCookie(): string {
  return `${PREVIEW_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Configuration for the Tangen preview handler — specifies the API endpoint, shared secret, and redirect logic.
 */
export interface PreviewHandlerConfig {
  apiUrl: string
  secret: string
  redirect: (req: Request) => string
}

/**
 * Validates and normalises a PreviewHandlerConfig, stripping trailing slashes from apiUrl.
 * @param config - Raw config from the caller
 * @returns Validated and normalised config
 */
export function buildPreviewHandlerConfig(config: PreviewHandlerConfig): PreviewHandlerConfig {
  if (!config.apiUrl) throw new Error('createPreviewHandler: apiUrl is required')
  if (!config.secret) throw new Error('createPreviewHandler: secret is required')
  if (typeof config.redirect !== 'function') throw new Error('createPreviewHandler: redirect must be a function')
  return {
    ...config,
    apiUrl: config.apiUrl.replace(/\/+$/, ''),
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * Creates a Next.js App Router GET handler that validates a Tangen preview token, enables draft mode, and redirects the browser to the preview URL.
 * @param config - Preview handler configuration (apiUrl, secret, redirect)
 * @returns An async GET route handler for use in app/api/preview/route.ts
 */
export function createPreviewHandler(config: PreviewHandlerConfig) {
  const { apiUrl, secret, redirect } = buildPreviewHandlerConfig(config)

  return async function GET(req: Request): Promise<Response> {
    const token = extractToken(req.url)
    if (!token) {
      return new Response('Missing token', { status: 400 })
    }

    // Validate the token with the Tangen API
    let validateRes: Response
    try {
      validateRes = await fetch(`${apiUrl}/api/v1/preview/validate?token=${encodeURIComponent(token)}`, {
        headers: { Authorization: `Bearer ${secret}` },
      })
    } catch {
      return new Response('Failed to reach Tangen API', { status: 502 })
    }

    if (!validateRes.ok) {
      return new Response('Invalid or expired preview token', { status: 401 })
    }

    // Enable Next.js draft mode
    try {
      const { draftMode } = await import('next/headers')
      const dm = draftMode()
      // Support both Next.js 14 (sync) and 15+ (async) draftMode
      if (dm && typeof (dm as any).then === 'function') {
        (await (dm as any)).enable()
      } else {
        (dm as any).enable()
      }
    } catch {
      // Not running inside Next.js runtime — no-op (useful in tests / standalone)
    }

    const redirectPath = redirect(req)
    return new Response(null, {
      status: 307,
      headers: {
        Location: redirectPath,
        'Set-Cookie': buildPreviewCookie(token),
      },
    })
  }
}

/**
 * Next.js App Router GET handler that disables draft mode, clears the preview cookie, and redirects to /.
 */
export const disablePreview = async function GET(_req: Request): Promise<Response> {
  try {
    const { draftMode } = await import('next/headers')
    const dm = draftMode()
    if (dm && typeof (dm as any).then === 'function') {
      (await (dm as any)).disable()
    } else {
      (dm as any).disable()
    }
  } catch {
    // Not in Next.js runtime — no-op
  }

  return new Response(null, {
    status: 307,
    headers: {
      Location: '/',
      'Set-Cookie': buildClearPreviewCookie(),
    },
  })
}
