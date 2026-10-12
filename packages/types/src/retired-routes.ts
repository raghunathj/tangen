/**
 * File Name: retired-routes.ts
 * Purpose: URL forms the platform once served to OUTSIDE callers and no
 *          longer does (E.16). An externally consumed URL is an integration
 *          contract that may be stored anywhere; when one is retired it must
 *          fail on purpose - 410 Gone naming the code, the retirement and
 *          the replacement - never fall through to a 404 that looks like a
 *          typo. The gateway answers from this table and Doctor reports it,
 *          so the two never disagree. Retiring a route is the exception;
 *          docs/architecture/extension-public-contract.md says when it is
 *          allowed and what has to ship with it.
 *
 * Author: Raghunath J
 * License: MIT
 */

export interface RetiredRoute {
  /** The stable code a sender's log can search for. */
  code: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | '*'
  /** The path prefix the retired form lived under; every request beneath it is answered 410. */
  prefix: string
  /** The version and date that retired it. */
  since: string
  /** The form that replaced it, as the caller has to write it. */
  replacement: string
  /** What to do about it, in one line. */
  message: string
}

export const RETIRED_ROUTES: readonly RetiredRoute[] = [
  {
    code: 'FLOW_WEBHOOK_URL_RETIRED',
    method: '*',
    prefix: '/api/v1/hooks/flows/',
    since: 'Flows 0.1.148 (2026-09-17)',
    replacement: 'POST /api/v1/ext/flows/hooks/<token>?workspace=<workspaceId>',
    message: 'Flow webhook URLs are minted by the Flows extension now and signed with its own secret; a URL of this form will not run a flow again. Open the flow in the Admin and copy the new URL into the sender.',
  },
]
