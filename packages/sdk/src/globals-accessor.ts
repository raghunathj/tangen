/**
 * File Name: globals-accessor.ts
 * Purpose: Provides GlobalsAccessor — a typed helper for reading and writing workspace-level global (Options/Metafield) data via the Tangen SDK HTTP client.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends on the HttpClient interface from client.ts.
 */
import type { LocaleCode } from '@tangen/types'
import type { HttpClient } from './client'
import { TangenError } from './errors'

/**
 * Accessor for a named workspace global — exposes get, patch (merge-update), and set (full-replace) over the Tangen globals API.
 */
export class GlobalsAccessor<T = Record<string, unknown>> {
  constructor(
    private readonly http: HttpClient,
    private readonly name: string,
    private readonly localeCode?: string,
  ) {}

  /**
   * Serve this global's fields in the given locale (per-field fallback to the
   * default locale is the route's own). `'all'` answers every locale's values
   * at once, which is what the route serves for a translation tool.
   *
   * Returns a NEW accessor, like ObjectQueryBuilder.locale, so the accessor it
   * is called on keeps serving the default locale and one reference can serve
   * several locales in the same render.
   * @param code - A locale code from the workspace config, or 'all'.
   */
  locale(code: LocaleCode | 'all'): GlobalsAccessor<T> {
    return new GlobalsAccessor<T>(this.http, this.name, code)
  }

  /**
   * This global's path, with the locale as a query parameter when one was
   * chosen. The locale is encoded, so a value carrying an `&` cannot smuggle a
   * second parameter onto the request.
   */
  private path(): string {
    const base = `/globals/${encodeURIComponent(this.name)}`
    return this.localeCode ? `${base}?locale=${encodeURIComponent(this.localeCode)}` : base
  }

  /**
   * Reads all field values for this global.
   * @returns The stored field values as a plain record
   * @throws TangenError(403) when the API key lacks the globals:read scope.
   */
  get(): Promise<T> {
    return this.request('read', () => this.http.get(this.path()))
  }

  /**
   * Shallow-merges the given data into this global's stored values. Under
   * `.locale(code)` this writes that locale's translation of the given keys.
   * @param data - Partial field values to merge
   * @returns The updated stored values
   * @throws TangenError(403) when the API key lacks the globals:write scope.
   */
  patch(data: Partial<T>): Promise<T> {
    return this.request('write', () => this.http.patch(this.path(), data))
  }

  /**
   * Fully replaces this global's stored values with the given data.
   *
   * A full replace has no per-locale form: the route refuses PUT with a locale
   * (422) and names PATCH as the way to write a translation. That rule is left
   * where it is enforced rather than copied here, so the two cannot drift.
   * @param data - Complete field values to write
   * @returns The updated stored values
   * @throws TangenError(403) when the API key lacks the globals:write scope.
   */
  set(data: T): Promise<T> {
    return this.request('write', () => this.http.put(this.path(), data))
  }

  /**
   * Runs an HTTP call and, on a 403, rethrows with a remediation hint naming
   * the exact scope the API key is missing — the raw permission error is easy
   * to miss when it surfaces deep in a page render.
   */
  private async request<R>(action: 'read' | 'write', call: () => Promise<R>): Promise<R> {
    try {
      return await call()
    } catch (err) {
      if (err instanceof TangenError && err.status === 403) {
        throw new TangenError(
          `Access to global "${this.name}" was denied - this API key needs the "globals:${action}" scope. ` +
            `Grant it in Settings → API Keys (Globals), then retry.`,
          403,
          err.code,
        )
      }
      throw err
    }
  }
}
