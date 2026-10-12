/**
 * File Name: index.ts
 * Purpose: The framework-neutral Studio runtime - the visual-edit overlay and
 *          the admin/site message protocol.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: No framework, on purpose. The overlay is DOM plus
 *          postMessage, so a React, Vue or Astro site can all support
 *          click-in-preview without one of them being forced on the others.
 *          React is the first ADAPTER, not the definition of the runtime.
 */
export {
  enableStudioOverlay, setPublishedStylesEnabled, isStudioPreview, tangenBlockAttrs,
  instanceKey, templateKeyOf, isInstanceKey, STUDIO_INSTANCE_SEP,
  STUDIO_STYLES_TYPE, isStudioStylesMessage,
  isStudioSelectMessage, isStudioHighlightMessage,
  isStudioOverlayMessage, isStudioReadyMessage, isStudioGeometryMessage,
  isStudioMeasureMessage, isStudioMeasuredMessage,
  STUDIO_SELECT_TYPE, STUDIO_HIGHLIGHT_TYPE, TANGEN_BLOCK_ATTR,
  STUDIO_OVERLAY_TYPE, STUDIO_READY_TYPE, STUDIO_GEOMETRY_TYPE,
  STUDIO_MEASURE_TYPE, STUDIO_MEASURED_TYPE,
  STUDIO_OVERLAY_CAPABILITIES,
} from './studio'
export type {
  StudioSelectMessage, StudioHighlightMessage, StudioOverlayOptions,
  StudioOverlayMessage, StudioReadyMessage, StudioGeometryMessage, StudioBlockRect,
  StudioMeasureMessage, StudioMeasuredMessage, StudioTextStyle,
} from './studio'
export { observeInView, IN_VIEW_ATTR } from './in-view'
export type { ObserveOptions } from './in-view'
export {
  loadInteractionsTier2, applyInteractionsTier2, INTERACTIONS_TIER2_MODULE,
} from './tier2-loader'
export type { Tier2LoadOptions, Tier2ApplyOptions, Tier2Applied } from './tier2-loader'
export type {
  DeliveredTier2Declaration, Tier2Module, Tier2Scope, Tier2Control,
} from './tier2-types'
export {
  resolvePage, resolveSurfaces, resolveVersion, routePointerUrl, pageUrl, stylesheetUrl,
  DELIVERY_MOUNT, SURFACES_ROUTE,
} from './delivery-client'
export type {
  DeliveredPage, DeliveredRuntime, DeliveredInteraction, DeliveredSurface, DeliveredSurfaces,
  DeliveredInstances,
  DeliveryTarget, VersionedTarget, ResolveOptions,
} from './delivery-client'
