/**
 * File Name: index.ts
 * Purpose: Public entry point for the @tangen/sdk package — re-exports the client
 * factory, query builder, and globals accessor so consumers can import everything
 * from a single path.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Barrel file — no runtime logic; see ./client, ./query-builder, ./globals-accessor.
 */
export { createClient, TangenError } from './client'
export { defineClientPlugin } from './client'
export type {
  ClientConfig, TangenClient, HttpClient, RequestOptions, SearchOptions, SearchResult,
  KnowledgeSearchHit, KnowledgeAskResult, KnowledgeQueryOptions, KnowledgeAskStreamEvent,
  LocalesInfo, TangenClientPlugin, PluginContext, PluginApis,
} from './client'
export { ObjectQueryBuilder } from './query-builder'
export type { PublishPlan, PublishPlanNode } from './query-builder'
export { GlobalsAccessor } from './globals-accessor'
export { observeRequests, observeInFlight, parseServerTiming, parseQmId, registerQmDetailFetcher, getQmDetailFetcher } from './observe'
export type {
  ObservedRequest, ObservedServerTiming, RequestObserver, InFlightObserver,
  QmRequestDetail, QmQueryDetail, QmDetailFetcher,
} from './observe'
export { createSsrRequestCollector, renderSsrTimingsTag, SSR_TIMINGS_TAG_ID } from './ssr'
export type { SsrRequestCollector, SsrTimingsPayload } from './ssr'
export { pickVariant, getOrCreateVisitorId } from './variants'
export type { VariantExperiment, VisitorIdResult } from './variants'
export {
  fetchPreviewObject, onLivePreview, isLivePreview, isLivePreviewMessage,
  notifyPreviewNavigation, notifyPreviewNotEditable, isPreviewNavigateMessage, onPreviewCommand,
  PREVIEW_MESSAGE_TYPE, PREVIEW_READY_TYPE, PREVIEW_CONSOLE_TYPE, PREVIEW_NAVIGATE_TYPE, PREVIEW_COMMAND_TYPE,
} from './preview'
export type {
  LivePreviewObject, LivePreviewMessage, FetchPreviewObjectOptions, OnLivePreviewOptions,
  PreviewNavigateInfo, PreviewNavigateMessage,
} from './preview'
export { isInternalLink, isExternalLink, isLinkResolved, linkSuffix } from './link'
export type {
  ResolvedLink, ResolvedInternalLink, ResolvedExternalLink,
  LinkValue, InternalLinkValue, ExternalLinkValue, LinkKind, LinkQuery,
} from './link'
export type {
  MediaAccessor, MediaAsset, MediaListOptions, MediaListResult, MediaTransform,
} from './media'
