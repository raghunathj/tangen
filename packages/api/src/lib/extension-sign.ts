/**
 * File Name: extension-sign.ts
 * Purpose: A per-extension MAC, for data an extension must keep somewhere a
 *          member can reach.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `extension_data` is one table serving two jobs: an
 *          extension's own `ctx.store` and the per-object panel data the
 *          Admin route reads and writes. They share a key tuple, so a member
 *          with content write can overwrite an extension's row through
 *          /workspaces/:ws/extensions/:id/data/:objectId.
 *
 *          For cosmetic panel state that does not matter. For a SECURITY
 *          DECISION it does: the Review extension records an approval there,
 *          and its `approvedHash` was an unkeyed sha256 over the content, so
 *          an editor could compute a valid one offline and satisfy the publish
 *          gate.
 *
 *          Separating the two keyspaces is the structural fix and it is large
 *          - the table is read directly in eight files, Porter round-trips its
 *          keys - so this closes the hole from the other end instead: make the
 *          stored value unforgeable. A member can still WRITE the row; they
 *          cannot produce a value that verifies.
 *
 *          The key is derived from the deployment's JWT key, so there is no
 *          new secret to provision and no new grant to approve. It is
 *          per-extension, so one extension's MAC is not valid for another's
 *          data, and labelled, so it can never collide with a member token.
 */
import { createHmac } from 'node:crypto'
import { getJwtKey } from './jwt-secret'

/** Domain separation: this key signs extension data and nothing else. */
const LABEL = 'tangen:extension-data-mac:v1'

/**
 * A signer for one extension: hex HMAC-SHA256 over the payload, under a key
 * derived from the deployment secret and the extension id.
 *
 * Deterministic, so the two sides of a comparison agree, and side-specific, so
 * a value signed for extension A does not verify for extension B.
 */
export function signerFor(extensionId: string): (payload: string) => string {
  const key = createHmac('sha256', getJwtKey()).update(`${LABEL}:${extensionId}`).digest()
  return (payload: string) => createHmac('sha256', key).update(payload).digest('hex')
}
