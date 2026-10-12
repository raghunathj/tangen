/**
 * File Name: index.ts
 * Purpose: The pack's own entry. A connector pack has no Admin surface of its
 *          own - an operator reaches it through Settings, Connections, and a
 *          developer through the typed services - so this is the contract and
 *          the connector, nothing more.
 *
 * Author: Raghunath J
 * License: MIT
 */
export * from './contract'
export { googleOAuthConnector, GOOGLE_HOSTS } from './connector'
