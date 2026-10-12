/**
 * File Name: define-workspace.ts
 * Purpose: Exports the defineWorkspace helper that wraps a WorkspaceConfig for IDE inference
 *   and type safety in tangen.config.ts files.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Imports WorkspaceConfig from config.
 */

import type { WorkspaceConfig } from './config'

/**
 * Identity helper for tangen.config.ts — wraps a WorkspaceConfig to enable
 * TypeScript inference and IDE completions.
 */
export function defineWorkspace(config: WorkspaceConfig): WorkspaceConfig {
  return config
}
