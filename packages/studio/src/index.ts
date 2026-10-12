/**
 * File Name: index.ts
 * Purpose: Compatibility shim. @tangen/studio was split into three packages
 *          with clear ownership; this keeps existing imports working.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The split happened while the schema was still
 *          dependency-free, because every extension added first raises the
 *          migration cost. Nothing here reimplements anything - it only
 *          re-exports, so there is one implementation and no drift.
 *
 * @deprecated Import from the owning package instead:
 *   - schema, style values, style properties, fonts -> `@tangen/studio-schema`
 *   - stylesheet rendering and hashing               -> `@tangen/studio-compiler`
 *   - the edit overlay and message protocol          -> `@tangen/studio-runtime`
 */
export * from '@tangen/studio-schema'
export * from '@tangen/studio-compiler'
export * from '@tangen/studio-runtime'

/**
 * The compiler and the runtime BOTH define this, deliberately: the compiler
 * emits the attribute into a paused animation and the runtime sets it, and
 * neither package may depend on the other. `export *` therefore leaves the
 * name ambiguous, and a bundler refuses the module rather than picking one -
 * which broke a real site build, not just a type check.
 *
 * The values are identical. The RUNTIME's is the one a site uses, so that is
 * the one this shim resolves to.
 */
export { IN_VIEW_ATTR } from '@tangen/studio-runtime'
