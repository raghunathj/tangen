/**
 * File Name: globals-accessor.ts
 * Purpose: Provides GlobalsAccessor — a typed helper for reading and writing workspace-level global (Options/Metafield) data via the Tangen SDK HTTP client.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends on the HttpClient interface from client.ts.
 */
import type { HttpClient } from './client'
import { TangenError } from './errors'

/**
 * Accessor for a named workspace global — exposes get, patch (merge-update), and set (full-replace) over the Tangen globals API.
 */
export class GlobalsAccessor<T = Record<string, unknown>> {
  constructor(
    private readonly http: HttpClient,
    private readonly name: string,
  ) {}

  /**
   * Reads all field values for this global.
   * @returns The stored field values as a plain record
   * @throws TangenError(403) when the API key lacks the globals:read scope.
   */
  get(): Promise<T> {
    return this.request('read', () => this.http.get(`/globals/${encodeURIComponent(this.name)}`))
  }

  /**
   * Shallow-merges the given data into this global's stored values.
   * @param data - Partial field values to merge
   * @returns The updated stored values
   * @throws TangenError(403) when the API key lacks the globals:write scope.
   */
  patch(data: Partial<T>): Promise<T> {
    return this.request('write', () => this.http.patch(`/globals/${encodeURIComponent(this.name)}`, data))
  }

  /**
   * Fully replaces this global's stored values with the given data.
   * @param data - Complete field values to write
   * @returns The updated stored values
   * @throws TangenError(403) when the API key lacks the globals:write scope.
   */
  set(data: T): Promise<T> {
    return this.request('write', () => this.http.put(`/globals/${encodeURIComponent(this.name)}`, data))
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
