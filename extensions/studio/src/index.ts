/**
 * File Name: index.ts
 * Purpose: @tangen/ext-studio - admin surface entry. Page components are
 *          resolved by name from the manifest's pages: entries.
 *
 * Author: Raghunath J
 * License: MIT
 */
export { StudioHomePage } from './pages/home'
export { StudioEditPage } from './pages/edit'

// The Builder Kit + token contract (pure data; also on the ./builder-kit
// and ./tokens subpaths for config-side imports that must not pull pages).
export { builderKitComponents, withBuilderKit } from './builder-kit'
export { DEFAULT_TOKENS, TOKEN_FAMILIES, mergeTokens, type StudioTokens, type TokenFamily } from './tokens'
