/**
 * File Name: sealed.ts
 * Purpose: The sealed-secret envelope for connections, re-exported from
 *          @tangen/db (Extension Kernel K6.3 moved it there so the CLI's
 *          key rotation and Doctor share ONE envelope with the API).
 *
 * Author: Raghunath J
 * License: MIT
 */
export { deriveConnectionsKey, sealSecret, openSecret, unreadableConnections, rotateConnectionsKey, type SealedKey, type UnreadableConnection } from '@tangen/db'
