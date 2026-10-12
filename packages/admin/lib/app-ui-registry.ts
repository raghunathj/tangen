/**
 * File Name: app-ui-registry.ts
 * Purpose: Re-exports the virtual app-UI component registry and bulk-action map provided by the Vite plugin at build time.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The `virtual:tangen/app-ui-registry` module is resolved at build/dev time by vite-plugin-app-ui.ts. Type declarations live in src/vite-env.d.ts.
 */
// Resolved at build/dev time by vite-plugin-app-ui; types in src/vite-env.d.ts.
// Live re-export bindings — never copy into consts here: the virtual module
// imports app/admin pages, and those pages import @/kit → AdminDataList →
// this file, so an eager `const x = imported` hits the TDZ mid-cycle.
export { APP_UI_REGISTRY, APP_BULK_ACTIONS } from 'virtual:tangen/app-ui-registry'
