import { defineWorkspace } from '@tangen/cms'
import schema from '../../content-objects'
import components from '../../components'
import globals from '../../globals'
import extensions from '../../config/extensions'
import routes from '../../api'
import { localizationConfig } from '../../config/localization'
import { formsConfig } from '../../config/forms'
// tangen:imports

/**
 * "Northwind Systems" master workspace config
 *
 * Extensions and routes defined here are inherited by every child workspace.
 * A child can extend, exclude, or add to them via its own
 * app/workspaces/<slug>/workspace.config.ts.
 *
 * Custom routes live in app/api/ — add new files there and export them from
 * app/api/index.ts. They are served under /api/v1/custom/<path>.
 */
export default defineWorkspace({
  name: 'Northwind Systems',
  workspaceId: 'wsp_northwind_systems',

  // ── Schemas ───────────────────────────────────────────────────────────────────
  // Imported in-process so field-level behavior (hooks, dynamic options,
  // validate functions) reaches the API. Structure still flows through
  // `tangen push` into the database.
  schemas: schema.types,

  // ── Reusable components ──────────────────────────────────────────────────────
  // app/components/index.ts — the schema builder maintains this registry.
  components,

  // ── Globals ──────────────────────────────────────────────────────────────────
  // app/globals/index.ts - site-wide content an editor owns.
  globals,

  // ── Extensions ───────────────────────────────────────────────────────────────
  // Declared in app/config/extensions.ts. All child workspaces inherit these
  // unless they call excludeExtensions. Installing and enabling is per
  // deployment and lives in its database - declaring one here only makes it
  // available.
  extensions,

  // ── Routes ───────────────────────────────────────────────────────────────────
  // Loaded from app/api/index.ts. All child workspaces inherit these unless they
  // call excludeRouteGroups. Assign a 'group' to each route in app/api/ so
  // children can selectively exclude them.
  routes,

  // ── Features ─────────────────────────────────────────────────────────────────
  // `tangen enable <feature>` wires optional packages (graphql, forms, auth, …)
  // in right here. Keep the marker below so enabling stays deterministic.
    localization: localizationConfig,
    forms: formsConfig,
  // tangen:features
})
