/**
 * File Name: media.ts
 * Purpose: The media capability: the asset library, uploads, transforms and
 *          the public serve path.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The most expensive single tree measured in the API on
 *          2026-08-27 (17.9 MB in isolation, image handling included), which
 *          is why it is the first capability to be separated.
 *
 *          `loadMedia()` is the LEAN path's resolver and is the only place
 *          these modules are named dynamically; the full path hands the same
 *          modules in statically from index.ts. Both then build the identical
 *          capability object, so there is one description of what media mounts
 *          and where, not two.
 *
 *          Nothing here may import `../routes/media/*` statically. One such
 *          import would put the whole tree back into every lean boot while the
 *          rest of the design still looked correct, which is exactly what the
 *          reachability gate exists to catch.
 */
import type { ServerCapability } from './types'
import { registerMediaIngest } from '../services/media-ingest-contract'
import { mediaAvailability } from '../runtime/availability'

/** The route modules media mounts. Shape shared by both resolution paths. */
export interface MediaModules {
  ingest: any
  staticRoute: any
  transform: any
  serve: any
  upload: any
  localize: any
  list: any
  update: any
  del: any
  folders: any
}

/** The lean path's resolver: the only dynamic naming of the media tree. */
export async function loadMedia(): Promise<MediaModules> {
  // Sequential rather than Promise.all: these modules share a dependency
  // graph, and resolving them concurrently let one observe another
  // mid-evaluation during an earlier attempt at this work.
  const staticMod = await import('../routes/media/static')
  const transform = await import('../routes/media/transform')
  const serve = await import('../routes/media/serve')
  const upload = await import('../routes/media/upload')
  const localize = await import('../routes/media/localize')
  const list = await import('../routes/media/list')
  const update = await import('../routes/media/update')
  const del = await import('../routes/media/delete')
  const folders = await import('../routes/media/folders')
  const ingest = await import('../services/media-ingest')
  return { staticRoute: staticMod, transform, serve, upload, localize, list, update, del, folders, ingest }
}

/** What media mounts, and where. One description, both paths. */
export function mediaCapability(m: MediaModules): ServerCapability {
  return {
    // sharp is native: a wrong-platform build or a missing install fails to load.
    availability: () => mediaAvailability(),
    // Media owns ingestion; a surface that needs it (AI image generation)
    // resolves it through the contract rather than importing this tree, so a
    // server without media never loads sharp.
    register: () => {
      registerMediaIngest({
        ingest: (ctx, req) => m.ingest.ingestMediaBuffer(ctx as never, req as never),
        folderFor: (db, workspaceId, name) =>
          m.ingest.findOrCreateFolder(db, workspaceId, name),
      })
    },
    mountPublic: (app) => app
      .use(m.staticRoute.mediaStaticRoute)
      .use(m.transform.mediaTransformRoute)
      .use(m.serve.mediaServeRoute),
    mountAuthenticated: (app) => app
      .use(m.upload.mediaUploadRoute)
      .use(m.localize.mediaLocalizeRoutes)
      .use(m.list.mediaListRoute)
      .use(m.list.mediaAssetDetailRoute)
      .use(m.update.mediaUpdateRoute)
      .use(m.del.mediaDeleteRoute)
      .use(m.folders.mediaFoldersRoute),
  }
}
