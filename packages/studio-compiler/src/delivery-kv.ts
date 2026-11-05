/**
 * File Name: delivery-kv.ts
 * Purpose: A Delivery Provider over any key-value store, for Studio's own
 *          extension store.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The CONTRACT moved to @tangen/types, because it is the
 *          platform's: the delivery route reads artifacts through it and has
 *          to keep doing so when this package is gone. This adapter stays
 *          here, because its one remaining consumer is the Studio extension
 *          and it retires with Studio. Core no longer imports it; the legacy
 *          reader that used to is now local to the API's delivery store.
 *
 *          Keys are namespaced because the same table holds `class:`,
 *          `preset:` and `tag:` rows. A published artifact must never be able
 *          to overwrite a class, and delivery must never become a reader for
 *          all of them.
 */
import type { DeliveryProvider, KeyValueStore } from '@tangen/types'

export type { KeyValueStore }

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
