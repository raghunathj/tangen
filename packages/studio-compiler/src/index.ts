/**
 * File Name: index.ts
 * Purpose: Publish-time compilation - the authoring schema becomes optimized,
 *          versioned artifacts.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: "Compiler" here means a PUBLISH-time service on Tangen
 *          infrastructure. It never implies rebuilding the customer's React or
 *          Vue application - publishing a page must not trigger a client
 *          build.
 *
 *          The ROOT export must stay browser-safe: the Studio extension
 *          imports it and the admin bundles that for the browser, so a single
 *          `node:fs` import here breaks the Studio page with a Vite
 *          externalization error. Node-only providers live behind subpaths -
 *          `@tangen/studio-compiler/fs` - and a boundary test enforces it.
 *
 *          Today it renders stylesheets. Next it gains runtime manifests,
 *          dependency resolution and versioned artifacts, which is what moves
 *          published styling off the authoring API and onto a CDN.
 */
export { renderStylesheet, declarationValueError } from './stylesheet'
export type { StylesheetInput, StyleRule, TagDefault } from './stylesheet'
export { styleHash } from './style-hash'
export {
  artifactId, artifactPath, routePointerPath, buildArtifact,
  composeCss, runtimeManifest,
  memoryDelivery, publishArtifact, resolveRoute, rollbackRoute,
} from './delivery'
export type {
  PageArtifact, PageInput, DeliveryProvider,
  RuntimeManifest, PageInteraction, PageInteractionInput,
  SurfacePosition, SurfaceInput, PublishedSurface, PublishedInstances,
} from './delivery'
export { compileStyles, classTarget } from './enforce'
export type { EnforceInput, CompiledStyles, Refusal, RuleTarget, TargetedRule } from './enforce'
export {
  compileSectionStyles, sectionsFromBlocks, WHOLE_BLOCK,
  rawCssError, safeRawCss, splitDeclarations, MAX_RAW_CSS, RAW_CSS_FORBIDDEN,
} from './section-css'
export type { SectionStyle, SectionStylesInput, CompiledSectionStyles } from './section-css'
export { compilePageStyles, topLevelBlocks, PAGE_RULE } from './page-css'
export type { PageStyle, PageBlockRef, PageStylesInput, CompiledPageStyles } from './page-css'
export { interactionCss, KEYFRAMES_CSS, IN_VIEW_ATTR } from './interaction-css'
export { kvDelivery, DELIVERY_NAMESPACE } from './delivery-kv'
export type { KeyValueStore } from './delivery-kv'
