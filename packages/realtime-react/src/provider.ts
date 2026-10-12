/**
 * File Name: provider.ts
 * Purpose: RealtimeProvider and useRealtime - how a React tree shares ONE
 *          realtime client, and how every hook in this package finds it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: tasks/realtime-client-architecture.md sections 8 and
 *          16-18: one connection per tab, many logical subscriptions, so
 *          the client is created once (outside React, or in a module) and
 *          handed down through context rather than created per component.
 *          Every hook also accepts a `client` option, which wins over the
 *          context: the admin passes its per-environment client that way,
 *          and a site with two Tangen environments on one page can too.
 *          A hook that finds neither throws at render with the fix in the
 *          message, because a silent no-op would look like a dead server.
 *
 *          `client: null` is deliberately distinct from "no client option":
 *          it means "nothing to bind right now" (the admin before the
 *          environment is known) and makes the hook inert rather than a
 *          thrown error; the context is not consulted in that case.
 */
import { createContext, createElement, useContext, type ReactNode } from 'react'
import type { RealtimeClient } from '@tangen/realtime'

const RealtimeContext = createContext<RealtimeClient | null>(null)

export interface RealtimeProviderProps {
  client: RealtimeClient
  children?: ReactNode
}

/** Makes one realtime client available to every hook below it. */
export function RealtimeProvider({ client, children }: RealtimeProviderProps) {
  return createElement(RealtimeContext.Provider, { value: client }, children)
}

/** Options every hook shares: an explicit client beats the provider's. */
export interface ClientOption {
  /** The client to bind; `null` makes the hook inert. Omit to use the provider's. */
  client?: RealtimeClient | null
}

/**
 * The client a hook should use: the explicit option when the caller passed
 * one (null included), else the provider's, else an error naming the fix.
 * @param opts - The hook's options, or nothing.
 * @param hook - The calling hook's name, for the message.
 */
export function useResolvedClient(opts: ClientOption | undefined, hook: string): RealtimeClient | null {
  const fromContext = useContext(RealtimeContext)
  if (opts && 'client' in opts) return opts.client ?? null
  if (fromContext) return fromContext
  throw new Error(`${hook} needs a RealtimeProvider above it, or a { client } option`)
}

/**
 * The realtime client in scope: the one passed in, else the provider's.
 * Throws when there is neither, because every other hook would too.
 */
export function useRealtime(client?: RealtimeClient): RealtimeClient {
  const resolved = useResolvedClient(client ? { client } : undefined, 'useRealtime')
  return resolved as RealtimeClient
}
