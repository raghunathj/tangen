/**
 * File Name: delivery-kv.ts
 * Purpose: A Delivery Provider over any key-value store.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Lives here rather than in the Studio extension because
 *          TWO sides need it and neither may depend on the other: the
 *          extension writes artifacts when a designer publishes, and the
 *          PLATFORM delivery route reads them when a visitor arrives. If this
 *          lived in the extension, the platform route would import extension
 *          code - and a published page would stop working the moment Studio
 *          was disabled, which is the exact guarantee the route exists to
 *          keep.
 *
 *          The store is typed structurally, so it binds to the extension
 *          store without this package depending on @tangen/types.
 *
 *          Keys are namespaced because the same table holds `class:`,
 *          `preset:` and `tag:` rows. A published artifact must never be able
 *          to overwrite a class, and delivery must never become a reader for
 *          all of them.
 */
import type { DeliveryProvider } from './delivery'

/** The minimum a store must do. Matches ExtensionStore structurally. */
export interface KeyValueStore {
  get(key: string): Promise<Record<string, unknown> | undefined>
  put(key: string, data: Record<string, unknown>): Promise<void>
  list(prefix?: string): Promise<Array<{ key: string; data: Record<string, unknown> }>>
}

/** Keeps artifacts away from every other kind of row. */
export const DELIVERY_NAMESPACE = 'delivery:'

/**
 * The store key for a delivery path.
 *
 * Traversal is refused rather than normalised: a path climbing out of the
 * namespace could reach a class row, and quietly rewriting it into something
 * valid would hide that intent instead of reporting it.
 */
function keyFor(path: string): string {
  if (path.includes('..') || path.startsWith('/')) {
    throw new Error(`Delivery path "${path}" would reach outside the delivery namespace`)
  }
  return `${DELIVERY_NAMESPACE}${path}`
}

/** A Delivery Provider backed by a key-value store. */
export function kvDelivery(store: KeyValueStore): DeliveryProvider {
  return {
    async read(path) {
      const row = await store.get(keyFor(path))
      const body = (row as { body?: unknown } | undefined)?.body
      // Missing reads as null so an unpublished route is a 404, not a 500.
      return typeof body === 'string' ? body : null
    },

    async write(path, body) {
      // Wrapped in an object because the store holds JSON rows, not strings.
      await store.put(keyFor(path), { body })
    },

    async list(prefix) {
      const rows = await store.list(keyFor(prefix))
      return rows.map((r) => r.key.slice(DELIVERY_NAMESPACE.length))
    },
  }
}
