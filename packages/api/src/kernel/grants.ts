/**
 * File Name: grants.ts
 * Purpose: The extension grant compiler, re-exported for the kernel. It lives
 *          in @tangen/types (`extension-grants.ts`) because the manifest
 *          validator and the CLI's install review compile the same grants;
 *          the kernel binds the result into an actor (`extensionActor`).
 *
 * Author: Raghunath J
 * License: MIT
 */
export { compileGrants, isPrivilegedGrant, PRIVILEGED_GRANT_PATTERNS, FACILITY_FAMILIES, type CompiledGrants } from '@tangen/types'
