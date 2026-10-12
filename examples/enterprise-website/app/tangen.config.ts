import type { TangenConfig } from '@tangen/cms'

/**
 * Thin project config. The canonical setup lives in
 * app/workspaces/index.ts (the registry the API loads) and
 * app/workspaces/northwind-systems/workspace.config.ts. The CLI reads
 * workspaceId from here for setup URLs — no need to duplicate the workspace
 * list that app/workspaces/ already owns.
 */
const config: TangenConfig = {
  project: 'northwind-systems',
  name: 'Northwind Systems',
  workspaceId: 'wsp_northwind_systems',
  schema: './content-objects/index.ts',
}

export default config
