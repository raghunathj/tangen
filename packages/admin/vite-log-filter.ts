/**
 * File Name: vite-log-filter.ts
 * Purpose: Which of Vite's dev-server errors are a browser going away rather
 *   than something wrong.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Its own module so it can be tested. Importing
 *          vite.config.ts to reach the predicate would run the whole config:
 *          it loads the root .env, resolves the consumer-mode app root and
 *          pulls in every plugin.
 */

/**
 * The write that lost a race with a closing socket. A proxied WebSocket ends
 * this way on every ordinary reload, so these are not faults.
 */
const DISCONNECT = /\b(EPIPE|ECONNRESET|ECONNABORTED|ERR_STREAM_WRITE_AFTER_END|ERR_STREAM_DESTROYED)\b/

/**
 * True when a dev-server error is a proxied socket losing its peer.
 *
 * The realtime socket (`/api/v1/realtime`) upgrades through the dev proxy, so
 * closing the tab, reloading, or an HMR reconnect mid-frame leaves a write
 * with nowhere to go. Vite reports that as an ERROR with a stack, which puts
 * ten lines that read like a fault in front of someone who pressed Cmd-R.
 *
 * Deliberately narrow on BOTH halves. A proxy error that is not a disconnect
 * still prints, because `ECONNREFUSED` on this proxy means the API is not
 * running, and that is the whole answer to "why is the admin empty?".
 */
export function isBenignProxyDisconnect(message: string, errorMessage?: string): boolean {
  const isProxySocket = /ws proxy socket error|http proxy error/i.test(message)
  if (!isProxySocket) return false
  return DISCONNECT.test(`${message} ${errorMessage ?? ''}`)
}
