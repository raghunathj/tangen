/**
 * File Name: node.ts
 * Purpose: Dev-time resolution shim for the '@tangen/sdk/node' subpath - the
 *          workspace package has no top-level exports map (tests import
 *          internals by path), so bare subpath resolution lands here.
 *          Published builds resolve via publishConfig exports to
 *          dist/node-ssr.js instead and never see this file.
 *
 * Author: Raghunath J
 * License: MIT
 */
export * from './src/node-ssr'
