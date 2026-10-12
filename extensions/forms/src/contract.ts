/**
 * File Name: contract.ts
 * Purpose: The browser-safe Forms contract: the definition types, the
 *          condition and validation logic the embed runtime and the server
 *          share, the JSON schema and validator a definition must satisfy,
 *          and the code-first helpers (`defineForm`, `defineFormHooks`). Sites
 *          import from `@tangen/ext-forms`; the admin pages and the embed
 *          runtime import from here.
 *
 * Author: Raghunath J
 * License: MIT
 */
export * from './contract/types'
export * from './contract/phone'
export * from './contract/logic'
export * from './contract/definition'
export * from './contract/define'
