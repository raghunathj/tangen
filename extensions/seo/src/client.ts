/**
 * File Name: client.ts
 * Purpose: The SEO extension's OWN client SDK (plan-seo-next Phase 6). A Tangen
 *          SDK plugin - the site mounts it with
 *          `createClient({ plugins: [seoPlugin] })` and calls
 *          `client.seo.resolve(type, id, locale)`. It uses only the generic
 *          `http` transport the seam hands it, so nothing SEO-specific lives in
 *          the core SDK. Published data only, keyed off the client's API key.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/sdk is a peer dependency - the consuming site
 *          already has it. Import only the plugin seam, never core internals.
 */
import { defineClientPlugin, TangenError } from '@tangen/sdk'
import type { ResolvedSeo } from './contract'

export interface SeoClientApi {
  /**
   * The resolved SEO for one object, precedence already applied. `{ data: null }`
   * when the object has no published SEO. Pass a locale for a localized site.
   */
  resolve(type: string, id: string, locale?: string): Promise<{ data: ResolvedSeo | null }>
  /**
   * Every enabled redirect, resolved to a URL - what a site needs to build its
   * own redirect map (a Next.js `redirects()`, an edge middleware) instead of
   * asking per request. A destination the app cannot place is left out.
   */
  redirects(): Promise<{ data: Array<{ from: string; to: string; status: 301 | 302 }> }>
}

/** The SEO client SDK, mounted at `client.seo`. */
export const seoPlugin = defineClientPlugin('seo', ({ http }): SeoClientApi => ({
  async resolve(type, id, locale) {
    const q = new URLSearchParams({ type, id, ...(locale ? { locale } : {}) })
    try {
      return (await http.get(`/ext/seo/resolve?${q.toString()}`)) as { data: ResolvedSeo }
    } catch (e) {
      // A 404 (no published SEO for this object) is a normal answer, not an error.
      if (e instanceof TangenError && e.status === 404) return { data: null }
      throw e
    }
  },
  async redirects() {
    return (await http.get('/ext/seo/redirects.json')) as { data: Array<{ from: string; to: string; status: 301 | 302 }> }
  },
}))
