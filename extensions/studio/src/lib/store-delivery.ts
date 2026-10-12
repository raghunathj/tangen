/**
 * File Name: store-delivery.ts
 * Purpose: Which Delivery Provider a Studio publish writes through.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A thin binding, not an implementation. The platform
 *          hands the extension its delivery store on the ctx (`ctx.delivery`):
 *          the `delivery_artifacts` table by default, a bucket when the
 *          workspace's `studio.delivery` names one. The backend is platform
 *          config and the public delivery route reads the same resolver, so
 *          the extension must not pick one of its own - a publish that wrote
 *          somewhere the route does not read would succeed and deliver
 *          nothing.
 *
 *          The extension KV store remains the FALLBACK for a runtime that
 *          predates the seam (and for tests). It still works end to end: the
 *          platform route answers a miss from those rows and migrates them
 *          on first read. The KV provider itself lives in
 *          @tangen/studio-compiler because the route may not import
 *          extension code - a published page has to keep working when Studio
 *          is disabled.
 */
import type { ExtensionStore } from '@tangen/types'
import { kvDelivery, type KeyValueStore } from '@tangen/studio-compiler'
import type { DeliveryProvider } from '@tangen/studio-compiler'

/** A Delivery Provider over an extension store - the zero-config fallback. */
export function storeDelivery(store: ExtensionStore): DeliveryProvider {
  return kvDelivery(store as unknown as KeyValueStore)
}

/** The minimum of a ctx this needs: the platform seam, or the store to fall back to. */
export interface DeliveryCtx {
  store: ExtensionStore
  delivery?: DeliveryProvider
}

/** The provider a publish writes through: the platform's store, else the extension's own. */
export function deliveryFor(ctx: DeliveryCtx): DeliveryProvider {
  return ctx.delivery ?? storeDelivery(ctx.store)
}
