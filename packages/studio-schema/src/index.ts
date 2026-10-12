/**
 * File Name: index.ts
 * Purpose: The canonical Tangen Studio contract.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This package depends on NOTHING, deliberately. Every
 *          other Studio package reads it - the compiler, the runtime, the
 *          admin - so it can never depend upward without creating a cycle.
 *          Keeping it dependency-free is also what keeps the published page
 *          schema framework-independent.
 */
export {
  GOOGLE_FONTS, fontStack, googleFontsUrl, isGoogleFont,
} from './google-fonts'
export type { GoogleFont, FontCategory } from './google-fonts'
export {
  STYLE_PROPERTIES, STYLE_SECTIONS, propertyById, propertiesInSection,
} from './style-properties'
export type { StyleProperty, StyleSection, StyleSectionId, StyleControl } from './style-properties'
export {
  styleValueError, isEmittableValue, isLengthValue, isNumberValue, unitOf,
} from './style-validate'
export { cascadeOrder, winningClass, compareClassNames } from './cascade'
export {
  readValue, writeValue, clearValue, hasOverride, normalizeValue, BREAKPOINTS, STATES,
} from './style-value'
export type {
  StoredValue, PropValue, StateValue, Breakpoint, StyleState, ValueAt,
} from './style-value'
export {
  styleAccess, internalPartClass, exposedParts, DANGEROUS_PROPERTIES,
} from './style-access'
export type {
  ProtectionLevel, StyleScope, StyleTargetKind, StylePart, BlockProtection,
  StyleTarget, StyleAccessInput, StyleAccess,
} from './style-access'
export {
  validateProtectionDeclaration, readProtectionDeclaration, ProtectionDeclarationError,
} from './protection-declaration'
export type { ProtectionIssue } from './protection-declaration'
export {
  INTERACTION_EVENTS, INTERACTION_ACTIONS, EASINGS,
  MAX_DURATION_MS, DEFAULT_DURATION_MS, normalizeInteraction, needsRuntime,
} from './interactions'
export type { Interaction, InteractionEvent, InteractionAction, Easing } from './interactions'
export {
  TIER2_KINDS, TIER2_CAPABILITIES, TIER2_PROPERTIES, RUNTIME_MODULES,
  VIEW_RANGES, SCROLL_AXES, STAGGER_ORIGINS,
  MAX_TIER2_STEPS, MAX_TIER2_KEYFRAMES, MAX_STAGGER_MS,
  MAX_TIMELINE_POSITION_MS, MAX_COUNT_UP, MAX_FRACTION_DIGITS,
  normalizeTier2Interaction, interactionTier, tier2Declaration,
} from './interactions-tier2'
export type {
  Tier2Interaction, Tier2Kind, Tier2Keyframe, Tier2Step, Tier2Scrub,
  Tier2Timeline, Tier2ReverseOnLeave, Tier2CountUp, Tier2Declaration,
  AnyInteraction, RuntimeModule, ViewRange, ScrollAxis, StaggerOrigin,
} from './interactions-tier2'
export {
  TOKEN_REF_FAMILIES, formatTokenRef, parseTokenRef, isTokenRef, legacyVarToRef,
  canonicalizeTokenValue, tokenRefToVar,
} from './token-ref'
export type { TokenRef, TokenRefFamily } from './token-ref'
export { contentClassName, CONTENT_CLASS_SUFFIX, textClassName, TEXT_CLASS_SUFFIX } from './content-class'
export { sectionClassName, SECTION_CLASS_PREFIX } from './section-class'
export { displayUnsupportedReason, displayOptionsFor } from './display-support'
export {
  TOKEN_FAMILIES, DEFAULT_TOKENS, mergeTokens, tokenValues, fontTokens,
} from './tokens'
export type {
  TokenFamily, StudioTokens, StudioTokensConfigLike, FontToken, FontFile,
} from './tokens'
export {
  THEME_PREFIX, THEME_FONT_PREFIX, themeKey, themeFontKey,
  parseVarName, themeValueError, readThemeFont,
} from './theme-value'
export type { ParsedVarName } from './theme-value'
export {
  INSTANCE_BLOCK_TYPE, MAX_INSTANCE_DEPTH,
  instanceIdOf, composeInstances, referencedInstances,
} from './instance-ref'
export type { InstanceTrees } from './instance-ref'
export { MAX_CLASS_NAME, normalizeClassName } from './class-name'
export { TAG_PREFIX, STUDIO_TAGS, tagByName } from './tag-defaults'
export type { StudioTag } from './tag-defaults'
