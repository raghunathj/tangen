/**
 * File Name: types.ts
 * Purpose: Defines the FeatureDefinition interface that describes a toggleable
 *          optional feature (e.g. auth, forms) managed by the Tangen CLI.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None
 */

/** Describes a self-contained optional feature that the CLI can enable or disable in a Tangen project. */
export interface FeatureDefinition {
  /** Extra line printed after enabling (install steps etc.). */
  postEnableHint?: string
  /** Unique identifier used on the CLI, e.g. 'auth', 'forms' */
  key: string
  /** Human-readable name shown in CLI output, e.g. 'Site Auth' */
  label: string
  /** One-line description shown in `tangen enable --list` */
  description: string
  /** Path to the config file to scaffold, relative to the app dir — e.g. 'config/auth.ts' */
  configFile: string
  /** Name of the exported config variable, e.g. 'authConfig' */
  configImportName: string
  /** Key injected into tangen.config's defineConfig({ ... }), e.g. 'auth' */
  configKey: string
  /** Full content of the scaffolded config file */
  configTemplate: string
  /** Ordered list of Drizzle migration tags to apply when enabling this feature */
  migrations: string[]
  /** DB table names — shown in the `tangen disable` confirmation prompt */
  tables: string[]
  /** SQL executed when the developer chooses to drop tables on disable */
  dropSql: string
}
