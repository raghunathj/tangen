/**
 * File Name: registry.ts
 * Purpose: Defines and exports the registry of optional Tangen CLI features
 *          (localization, graphql, ai), and provides lookup helpers used by
 *          enable/disable commands. Auth and Forms are extensions now.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Imports FeatureDefinition from ./types; extend FEATURE_REGISTRY
 *                     to register new optional features.
 */
import type { FeatureDefinition } from './types'

const LOCALIZATION_FEATURE: FeatureDefinition = {
  key: 'localization',
  label: 'Localization',
  description: 'Multi-locale content - enable languages, default locale, per-field translations',
  configFile: 'config/localization.ts',
  configImportName: 'localizationConfig',
  configKey: 'localization',
  configTemplate: `import { defineLocalizationConfig } from '@tangen/cms'

export const localizationConfig = defineLocalizationConfig({
  enabled: true,
  // Values in the default locale live directly in your content tables;
  // translations live in per-type side tables managed by \`tangen push\`.
  defaultLocale: 'en',
  locales: [
    { code: 'en', label: 'English' },
    // Add the languages you translate into, for example:
    // { code: 'de', label: 'Deutsch' },
  ],
})
`,
  // No migrations/tables here — <type>_i18n side tables are created by
  // `tangen push` for every type that has fields marked localized: true.
  migrations: [],
  tables: [],
  dropSql: '',
}

const GRAPHQL_FEATURE: FeatureDefinition = {
  key: 'graphql',
  label: 'GraphQL',
  description: 'GraphQL API generated from your schema - queries, relations, optional mutations',
  configFile: 'config/graphql.ts',
  configImportName: 'graphqlConfig',
  configKey: 'graphql',
  configTemplate: `import { defineGraphqlConfig } from '@tangen/cms'

export const graphqlConfig = defineGraphqlConfig({
  enabled: true,
  // mutations: true,          // opt-in create/update/publish/delete
  // introspection: true,      // schema introspection for tooling
})
`,
  // No tables — the GraphQL schema is generated per workspace×env at runtime.
  migrations: [],
  tables: [],
  dropSql: '',
  postEnableHint: 'Install the runtime once: npm i @tangen/graphql - then restart dev.',
}

const AI_FEATURE: FeatureDefinition = {
  key: 'ai',
  label: 'AI',
  description: 'Content AI - draft entries, fill fields, and generate images from a prompt',
  configFile: 'config/ai.ts',
  configImportName: 'aiConfig',
  configKey: 'ai',
  configTemplate: `import type { AIConfig } from '@tangen/cms'

/**
 * Content AI configuration.
 *
 * Content generation lives in @tangen/api core — nothing extra to install for
 * drafting entries, filling fields, or generating images. Providers listed
 * here are offered to admins; each becomes usable only once its API key
 * resolves from the environment:
 *   ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY
 * Remove a provider to hide it; set { disabled: true } to switch AI off.
 */
export const aiConfig: AIConfig = {
  providers: ['anthropic', 'openai', 'gemini'],
}
`,
  // Content AI uses the ai_settings/ai_chats system tables created at bootstrap.
  migrations: [],
  tables: [],
  dropSql: '',
  postEnableHint:
    'Next: add a provider key to .env (e.g. ANTHROPIC_API_KEY=sk-ant-… or OPENAI_API_KEY=sk-…), restart dev, then pick the provider in the admin under AI → Providers. (Knowledge/RAG and MCP agents are separate opt-ins: npm i @tangen/knowledge / @tangen/mcp.)',
}

/** Central map of all available optional features keyed by their feature key (e.g. `'auth'`, `'forms'`). */
export const FEATURE_REGISTRY: Record<string, FeatureDefinition> = {
  localization: LOCALIZATION_FEATURE,
  graphql: GRAPHQL_FEATURE,
  ai: AI_FEATURE,
}

/** Returns all registered features as a new array. */
export function listFeatures(): FeatureDefinition[] {
  return Object.values(FEATURE_REGISTRY)
}

/** Looks up a feature by its key. Returns `undefined` if not found. */
export function getFeature(key: string): FeatureDefinition | undefined {
  return FEATURE_REGISTRY[key]
}
