/**
 * File Name: delivery.ts
 * Purpose: The platform's delivery contract - the three methods a published
 *          artifact's bytes travel through. The canonical home, imported by
 *          the platform delivery route, by the store that resolves a backend,
 *          and restated by `ctx.delivery`.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Types only, deliberately. The contract belongs to the
 *          PLATFORM and used to live in @tangen/studio-compiler, which meant
 *          `packages/api` imported Studio code on the one path that exists to
 *          keep working when Studio is disabled.
 *
 *          No implementation travels with it: a value exported here reaches
 *          the public surface of @tangen/cms, and a site developer has no use
 *          for a delivery backend. Core's own backends live beside their
 *          resolver in the API; @tangen/studio-compiler keeps its key-value
 *          one, and it retires with Studio.
 */

/**
 * Storage behind the delivery layer.
 *
 * Three methods on purpose: a filesystem directory, an S3 bucket, an R2
 * bucket and an in-memory map can all satisfy this, which is what keeps
 * self-hosting a first-class case rather than a degraded one.
 */
export interface DeliveryProvider {
  read(path: string): Promise<string | null>
  write(path: string, body: string): Promise<void>
  list(prefix: string): Promise<string[]>
}

/**
 * The minimum a key-value store must do to stand behind a DeliveryProvider.
 * Matches ExtensionStore structurally, so a store binds to it without this
 * contract knowing what an extension is.
 */
export interface KeyValueStore {
  get(key: string): Promise<Record<string, unknown> | undefined>
  put(key: string, data: Record<string, unknown>): Promise<void>
  list(prefix?: string): Promise<Array<{ key: string; data: Record<string, unknown> }>>
}
