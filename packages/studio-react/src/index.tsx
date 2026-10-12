/**
 * File Name: index.tsx
 * Purpose: Public entry point for @tangen/studio-react - the rendering
 *          runtime that lets any React site server-render Tangen Studio
 *          Builder Kit block trees: import { StudioBlocks } and the
 *          stylesheet '@tangen/studio-react/styles.css'.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Bundler-agnostic and server-component-safe: nothing on
 *          this entry carries 'use client', imports next/astro, or touches
 *          browser globals. The only client island (kit.video) is a separate
 *          leaf module the dispatcher renders with serializable props.
 */
/**
 * The Studio client core, re-exported so a React site installs ONE package
 * and gets the visual-edit overlay alongside the renderer. The core itself
 * (@tangen/studio) carries no framework dependency, so non-React sites use
 * it directly.
 */
export {
  enableStudioOverlay, isStudioPreview, tangenBlockAttrs,
  isStudioSelectMessage, isStudioHighlightMessage,
  isStudioOverlayMessage, isStudioReadyMessage,
  STUDIO_SELECT_TYPE, STUDIO_HIGHLIGHT_TYPE, TANGEN_BLOCK_ATTR,
  STUDIO_OVERLAY_TYPE, STUDIO_READY_TYPE, STUDIO_OVERLAY_CAPABILITIES,
} from '@tangen/studio'
export type {
  StudioSelectMessage, StudioHighlightMessage, StudioOverlayOptions,
  StudioOverlayMessage, StudioReadyMessage,
} from '@tangen/studio'

export { StudioBlocks } from './render'
/**
 * For a site's own component override: the scoped class a declared Style
 * Part wears, so the override can put it on the element it wants reachable.
 */
export { partClassNames, wornClasses } from './parts'
/**
 * The delivery surface: hand it a resolved artifact and it renders the
 * published page, versioned stylesheet and all. Studio has its OWN runtime -
 * the general Client SDK is deliberately not repurposed for this, so a site
 * that never uses Studio pays nothing for it.
 */
export { StudioPage } from './page'
export type { StudioPageProps } from './page'
export {
  resolvePage, resolveVersion, stylesheetUrl, pageUrl, routePointerUrl, DELIVERY_MOUNT,
} from '@tangen/studio-runtime'
export type {
  DeliveredPage, DeliveredRuntime, DeliveredInteraction, DeliveryTarget, VersionedTarget,
  DeliveredTier2Declaration,
} from '@tangen/studio-runtime'
export { INTERACTIONS_TIER2_MODULE } from '@tangen/studio-runtime'
export { InteractionsTier2Runtime, mountInteractionsTier2 } from './interactions-tier2'
export { collectLoopQueries, resolveStudioData } from './loop'
export { RichText } from './richtext'
export type {
  BlockNode,
  BlockComponent,
  ComponentsMap,
  StudioBlocksProps,
  UnknownBlockMode,
} from './types'
export type { LoopQuerySpec, LoopResult, LoopData, QueryResolver } from './loop'
export { isBinding, resolveBinding, bindBlock } from './binding'
export type { BindingDescriptor } from './binding'
