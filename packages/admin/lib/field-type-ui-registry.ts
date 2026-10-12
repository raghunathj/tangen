/**
 * File Name: field-type-ui-registry.ts
 * Purpose: Re-exports the virtual custom-field-type UI registry built at build/dev
 *   time by vite-plugin-field-type-ui. field-control consults it in its default case
 *   to render an extension-contributed input for a custom field type.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The `virtual:tangen/field-type-ui` module is resolved by
 *   vite-plugin-field-type-ui.ts. Type declaration lives in src/vite-env.d.ts.
 */
export { FIELD_TYPE_UI } from 'virtual:tangen/field-type-ui'
