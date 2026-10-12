/**
 * File Name: extension-publisher.ts
 * Purpose: `ctx.realtime.publish` - how an extension server reaches
 *          connected clients: a declared channel, a type, a small data
 *          object, handed to the process hub so it is retained, dispatched
 *          locally and forwarded to the other processes.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: R4 of tasks/plan-realtime.md (section 4.8) and the
 *          architecture's sections 26-27: the server publishes without
 *          knowing whether Core is on memory, Postgres or Redis, and never
 *          starts its own transport. The hub is resolved per call (not at
 *          construction) because the extension ctx is built before the
 *          realtime plugin mounts in some boots and the hub may be swapped
 *          in tests; the publisher therefore holds a function, not a hub.
 *
 *          Three refusals are deliberate. An undeclared channel throws
 *          (rejects) rather than publishing to a topic nobody may
 *          subscribe to, so a typo surfaces in the extension's own logs. A
 *          payload over EXTENSION_EVENT_MAX_BYTES throws because realtime
 *          signals and does not replicate (section 12): an extension that
 *          wants to ship a document should publish the id and let the
 *          client fetch. A runtime with no hub (the CLI, a worker process
 *          that mounted no server) resolves to null with a debug line so
 *          the extension's own work is not failed by a missing surface.
 */
import { getLogger } from '@tangen/logging'
import type { RealtimeHub } from './hub'
import type { RealtimeEnvelope } from './router'
import { getExtensionChannel } from './extension-channels'
import { getRealtimeHub } from './transport'

const log = () => getLogger(['tangen', 'api', 'realtime', 'ext'])

/** The most an extension envelope's `data` may serialise to. */
export const EXTENSION_EVENT_MAX_BYTES = 16 * 1024
const TYPE_RE = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,79}$/

export interface ExtensionPublishInput {
  /** A channel name the manifest declares (`realtime.channels[].name`). */
  channel: string
  /** The envelope type clients switch on (`sink.tick`, `import.progress`). */
  type: string
  /** Ids, counters, changed names. Never documents. Default `{}`. */
  data?: Record<string, unknown>
}

export interface ExtensionRealtime {
  publish(input: ExtensionPublishInput): Promise<RealtimeEnvelope | null>
}

export interface ExtensionRealtimeScope {
  extensionId: string
  workspaceId: string
  /** The hub to publish through; defaults to the process hub the plugin installed. */
  hub?: () => RealtimeHub | null
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype

/**
 * Builds the `realtime` seam of one extension ctx (one workspace x env).
 * @param scope - Which extension publishes, for which workspace and environment.
 */
export function createExtensionRealtime(scope: ExtensionRealtimeScope): ExtensionRealtime {
  const resolveHub = scope.hub ?? getRealtimeHub
  return {
    async publish(input) {
      const channel = typeof input?.channel === 'string' ? input.channel : ''
      const declared = channel ? getExtensionChannel(scope.extensionId, channel) : null
      if (!declared) {
        throw new Error(`extension "${scope.extensionId}" cannot publish on realtime channel "${channel}": declare it in the manifest (realtime.channels) first`)
      }
      if (typeof input.type !== 'string' || !TYPE_RE.test(input.type)) {
        throw new Error(`extension "${scope.extensionId}" realtime event type ${JSON.stringify(input.type)} must match ${TYPE_RE}`)
      }
      const data = input.data === undefined ? {} : input.data
      if (!isPlainObject(data)) throw new Error(`extension "${scope.extensionId}" realtime event data must be a plain object`)
      const bytes = Buffer.byteLength(JSON.stringify(data))
      if (bytes > EXTENSION_EVENT_MAX_BYTES) {
        throw new Error(`extension "${scope.extensionId}" realtime event on "${channel}" is ${bytes} bytes; the limit is ${EXTENSION_EVENT_MAX_BYTES} bytes - publish ids and let the client fetch`)
      }
      const hub = resolveHub()
      if (!hub) {
        log().debug(`extension "${scope.extensionId}" published on "${channel}" with no realtime hub mounted; dropped`)
        return null
      }
      // The hub builds the channel from the topic: a workspace-scoped
      // declaration lands under the `_` env segment through authorize.ts.
      return hub.publish({ workspaceId: scope.workspaceId }, `ext:${scope.extensionId}:${channel}`, input.type, data)
    },
  }
}
