/**
 * File Name: folders.ts
 * Purpose: Manages media folder trees — lists all folders as a nested tree
 *   rooted at a synthetic root node, and creates new folders with optional
 *   parent validation.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, drizzle-orm, @tangen/db, Node.js crypto
 */
import { randomBytes } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { mediaFolders } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { assertMediaPermission } from '../../lib/permissions'
import type { MediaFolder } from '@tangen/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FolderTreeNode {
  id: string | null
  name: string
  parentId: string | null
  children: FolderTreeNode[]
}

export interface CreateFolderPayload {
  name: string
  parentId: string | null
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Converts a flat list of folders into a nested tree rooted at a synthetic
 * root node. Orphaned nodes (whose parent is not in the list) are attached
 * directly to the root.
 * @param folders - Flat array of folders with id, name, and parentId
 * @returns A root FolderTreeNode whose children form the full hierarchy
 */
export function buildFolderTree(folders: Pick<MediaFolder, 'id' | 'name' | 'parentId'>[]): FolderTreeNode {
  const nodeMap = new Map<string, FolderTreeNode>()

  // Build node map
  for (const f of folders) {
    nodeMap.set(f.id, { id: f.id, name: f.name, parentId: f.parentId, children: [] })
  }

  const root: FolderTreeNode = { id: null, name: 'Root', parentId: null, children: [] }

  // Wire up parent-child relationships
  for (const f of folders) {
    const node = nodeMap.get(f.id)!
    if (!f.parentId) {
      root.children.push(node)
    } else {
      const parent = nodeMap.get(f.parentId)
      if (parent) {
        parent.children.push(node)
      } else {
        // Orphaned node (parent not found) — attach to root
        root.children.push(node)
      }
    }
  }

  return root
}

/**
 * Validates and normalises the request body for folder creation.
 * @param body - Raw request body (expected to be an object with a name field)
 * @returns A CreateFolderPayload with trimmed name and nullable parentId
 */
export function buildCreateFolderPayload(body: unknown): CreateFolderPayload {
  if (!body || typeof body !== 'object') {
    throw new RequestError('VALIDATION_ERROR', 'Request body must be an object')
  }
  const b = body as Record<string, unknown>

  const rawName = b.name
  if (rawName === undefined || rawName === null) {
    throw new RequestError('VALIDATION_ERROR', 'Missing required field: name')
  }
  if (typeof rawName !== 'string') {
    throw new RequestError('VALIDATION_ERROR', 'name must be a string')
  }
  const name = rawName.trim()
  if (!name) {
    throw new RequestError('VALIDATION_ERROR', 'name must not be empty')
  }
  if (name.length > 100) {
    throw new RequestError('VALIDATION_ERROR', 'name must not exceed 100 characters')
  }

  const parentId = (b.parentId as string | null | undefined) ?? null

  return { name, parentId }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * Registers GET /api/v1/media/folders and POST /api/v1/media/folders.
 * GET returns the full folder hierarchy as a nested tree. POST creates a new
 * folder, validating the parent's existence within the same workspace/env.
 * @param app - Elysia application instance
 * @returns The mutated Elysia app with folder routes registered
 */
export const mediaFoldersRoute = (app: Elysia) =>
  app
    .get('/api/v1/media/folders', async (ctx: any) => {
      const { db, workspaceId } = ctx

      const rows = await db
        .select()
        .from(mediaFolders)
        .where(and(eq(mediaFolders.workspaceId, workspaceId)))
        .orderBy(mediaFolders.name)

      const folders: Pick<MediaFolder, 'id' | 'name' | 'parentId'>[] = rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        parentId: r.parentId ?? null,
      }))

      return { data: buildFolderTree(folders) }
    })

    .post('/api/v1/media/folders', async (ctx: any) => {
      const { body, db, workspaceId, set } = ctx
      assertMediaPermission(ctx.permissions, 'write')

      const payload = buildCreateFolderPayload(body)

      // Validate parentId exists in this workspace/env if provided
      if (payload.parentId) {
        const [parent] = await db
          .select({ id: mediaFolders.id })
          .from(mediaFolders)
          .where(
            and(
              eq(mediaFolders.id, payload.parentId),
              eq(mediaFolders.workspaceId, workspaceId),
              ),
          )
          .limit(1)

        if (!parent) {
          throw new RequestError('NOT_FOUND', `Parent folder "${payload.parentId}" not found`, 404)
        }
      }

      const id = `mfld_${randomBytes(10).toString('hex')}`
      const now = new Date()

      await db.insert(mediaFolders).values({
        id,
        workspaceId,
        name: payload.name,
        parentId: payload.parentId,
        createdAt: now,
      })

      const folder: MediaFolder = {
        id,
        workspaceId,
        name: payload.name,
        parentId: payload.parentId,
        createdAt: now.toISOString(),
      }

      set.status = 201
      return { folder }
    })
