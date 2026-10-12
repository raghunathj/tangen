/**
 * File Name: index.ts
 * Purpose: The framework kernel's execution model, in one import for the API.
 *
 * Author: Raghunath J
 * License: MIT
 */
export { memberActor, apiKeyActor, identityActor, siteUserActor, systemActor, extensionActor, isRecordedKind, attributionIdOf, hookActorOf, legacyIdentityOf, actorFromContext, type LegacyIdentityContext } from './actor'
export { compileGrants, isPrivilegedGrant, PRIVILEGED_GRANT_PATTERNS, FACILITY_FAMILIES, type CompiledGrants } from './grants'
export { declareContributionPoint, contributionPoint, listContributionPoints, contribute, withdrawContributions, contributions, contributionOf, contributionWarnings, CORE_CONTRIBUTION_POINTS, type ContributionPointDef, type ContributionPoint, type Contribution, type ContributionsOptions } from './contributions'
export { gateExtensionCtx } from './gate'
export { provideService, getService, listServices, instantiateService, serviceValue, unfulfilledServices, parseServiceRef, SERVICES_POINT, type ProvidedService, type ResolvedService, type ServiceScope, type ServiceDispatch } from './services'
export { intersectAuthority, dispatchExecution } from './intersect'
export { declareFilterPoint, filterPoint, listFilterPoints, registerFilter, applyFilter, listFilterRegistrations, filterContention, inspectExtensionFilters, filterEngineStats, Filters, FilterRejected, FilterFailed, CORE_FILTER_POINTS, FILTERS_POINT, type FilterPointDef, type FilterPoint, type FilterRegistration, type FilterContext, type FilterTrace, type ApplyFilterOptions } from './filters'
// The registry the contribution reader walks, for the testkit's fake peers and platform tooling.
export { registerExtensionManifest, registerExtensionServer, resetExtensionRegistry, listExtensionServerIds, getExtensionManifest, getExtensionServer } from '../hooks/app-hooks-registry'
export { decide, requireDecision, type PolicyAction, type Decision, type DecisionCode } from './policy'
export { readViewOf, isPublicView, type ReadView, type ResolvedReadView } from './read-view'
export { expandCapabilities } from './capabilities'
export { resolveExecutionWorkspace, type WorkspaceResolution } from './workspace'
export { baseLocaleContext, resolveLocaleContext } from './locale'
export { createExecution, requestExecution, isKernelExecution, assertKernelExecution, CORRELATION_HEADER } from './execution'
export { buildEvent, recordEvent, emitRecorded, attributionOf, type DomainEventInput, type RecordedEvent, type Writer } from './events'
export { registerSiteIdentity, resetSiteIdentity, listSiteIdentityRegistrations, siteIdentityFor, resolveSiteUser, resolveSiteUserAcross, siteTokenOf, type SiteIdentityRegistration } from './site-identity'
