/**
 * File Name: roles.ts
 * Purpose: Custom role CRUD — workspace-defined roles whose permission
 *          bundles flow through the same engine as built-ins and API keys.
 *          GET also reports the built-in roles with their compiled bundles
 *          so the admin can display the full matrix.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: role writes invalidate the middleware's redis cache
 *          (roleCacheKey) so permission edits apply on the next request.
 *          Deleting a role that members or env-overrides still reference
 *          409s — reassign first.
 */
import { Elysia } from 'elysia'
import { randomBytes } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { roles, members } from '@tangen/db'
import { BUILT_IN_ROLES, isBuiltInRole, permissionsForRole, compileRoleSeed } from '@tangen/types'
import type { MemberPermissions } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { requireCapability, requireAnyCapability } from '../../lib/member-access'
import { roleCacheKey, invalidateMemberPermissions } from '../../middleware/auth'
import { assertMemberJwt } from './manage'

const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/
const RESERVED_SLUGS = new Set([...BUILT_IN_ROLES, 'superadmin'])

export interface RolePayload {
  slug: string
  name: string
  description?: string | null
  permissions: MemberPermissions
}

/** Validates a role create/update body. */
export function buildRolePayload(body: unknown, opts: { requireSlug?: boolean } = {}): RolePayload {
  const b = body as Record<string, unknown>
  const slug = ((b?.slug as string | undefined) ?? '').trim().toLowerCase()
  const name = ((b?.name as string | undefined) ?? '').trim()

  if (opts.requireSlug !== false) {
    if (!slug || !SLUG_PATTERN.test(slug)) {
      throw new RequestError('VALIDATION_ERROR', 'slug must be a lowercase slug (a-z, 0-9, -, _)', 422)
    }
    if (RESERVED_SLUGS.has(slug)) {
      throw new RequestError('VALIDATION_ERROR', `"${slug}" is a built-in role name`, 422)
    }
  }
  if (!name) throw new RequestError('VALIDATION_ERROR', 'name is required', 422)

  const permissions = (b?.permissions ?? {}) as MemberPermissions
  if (typeof permissions !== 'object' || Array.isArray(permissions)) {
    throw new RequestError('VALIDATION_ERROR', 'permissions must be an object', 422)
  }
  if ((permissions as { admin?: boolean }).admin) {
    throw new RequestError('VALIDATION_ERROR', 'Custom roles cannot grant blanket admin - use the built-in admin role', 422)
  }

  return {
    slug,
    name,
    description: ((b?.description as string | undefined) ?? '').trim() || null,
    permissions,
  }
}

function builtInRoleDtos() {
  return BUILT_IN_ROLES.map((slug) => ({
    slug,
    name: slug[0].toUpperCase() + slug.slice(1),
    description: null,
    builtIn: true,
    permissions: permissionsForRole(slug),
  }))
}

export const memberRolesRoutes = (app: Elysia) =>
  app
    .get('/api/v1/roles', async (ctx: any) => {
      const { db, workspaceId, memberId } = ctx
      assertMemberJwt(memberId)
      requireAnyCapability({ permissions: ctx.permissions, memberId, memberRole: ctx.memberRole }, ['manage:members', 'manage:roles'])

      const rows = await db.select().from(roles).where(eq(roles.workspaceId, workspaceId))
      const project = (ctx.workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === workspaceId)
      const codeSlugs = new Set<string>((project?.roles ?? []).map((r: any) => r.slug))
      const codeRoles = (project?.roles ?? []).map((r: any) => ({
        slug: r.slug, name: r.name, description: r.description ?? null,
        builtIn: false, source: 'code',
        permissions: compileRoleSeed(r),
      }))
      return {
        data: [
          // Code seeds may override editor/viewer — drop the shadowed built-ins
          ...builtInRoleDtos().filter((b) => !codeSlugs.has(b.slug)),
          ...codeRoles,
          ...rows.map((r: any) => ({
            slug: r.slug, name: r.name, description: r.description,
            builtIn: false, permissions: r.permissions ?? {},
            createdAt: r.createdAt, updatedAt: r.updatedAt,
          })),
        ],
      }
    })

    .post('/api/v1/roles', async (ctx: any) => {
      const { db, redis, workspaceId, memberId, permissions, body, set } = ctx
      assertMemberJwt(memberId)
      requireCapability({ permissions, memberId }, 'manage:roles')

      const payload = buildRolePayload(body)
      const [existing] = await db
        .select()
        .from(roles)
        .where(and(eq(roles.workspaceId, workspaceId), eq(roles.slug, payload.slug)))
        .limit(1)
      if (existing) throw new RequestError('CONFLICT', `Role "${payload.slug}" already exists`, 409)

      const id = `rol_${randomBytes(6).toString('hex')}`
      await db.insert(roles).values({
        id, workspaceId,
        slug: payload.slug, name: payload.name,
        description: payload.description, permissions: payload.permissions,
      })
      if (redis) { try { await redis.del(roleCacheKey(workspaceId, payload.slug)) } catch { /* ignore */ } }

      set.status = 201
      return { slug: payload.slug, name: payload.name, description: payload.description, builtIn: false, permissions: payload.permissions }
    })

    .patch('/api/v1/roles/:slug', async (ctx: any) => {
      const { db, redis, workspaceId, memberId, permissions, params, body } = ctx
      assertMemberJwt(memberId)
      requireCapability({ permissions, memberId }, 'manage:roles')

      if (isBuiltInRole(params.slug)) {
        throw new RequestError('BAD_REQUEST', 'Built-in roles cannot be edited', 400)
      }
      {
        const project = (ctx.workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === workspaceId)
        if ((project?.roles ?? []).some((r: any) => r.slug === params.slug)) {
          throw new RequestError('CONFLICT', 'This role is defined in code - edit its defineRole() in your roles file and restart', 409)
        }
      }
      const payload = buildRolePayload({ ...(body as object), slug: params.slug })
      const [row] = await db
        .select()
        .from(roles)
        .where(and(eq(roles.workspaceId, workspaceId), eq(roles.slug, params.slug)))
        .limit(1)
      if (!row) throw new RequestError('NOT_FOUND', 'Role not found', 404)

      await db.update(roles)
        .set({ name: payload.name, description: payload.description, permissions: payload.permissions, updatedAt: new Date() })
        .where(eq(roles.id, row.id))
      if (redis) { try { await redis.del(roleCacheKey(workspaceId, params.slug)) } catch { /* ignore */ } }
      // Every holder of this role just changed what it may do; the seam is
      // how an open realtime connection learns to re-check.
      invalidateMemberPermissions()

      return { slug: params.slug, name: payload.name, description: payload.description, builtIn: false, permissions: payload.permissions }
    })

    .delete('/api/v1/roles/:slug', async (ctx: any) => {
      const { db, redis, workspaceId, memberId, permissions, params, set } = ctx
      assertMemberJwt(memberId)
      requireCapability({ permissions, memberId }, 'manage:roles')

      if (isBuiltInRole(params.slug)) {
        throw new RequestError('BAD_REQUEST', 'Built-in roles cannot be deleted', 400)
      }
      {
        const project = (ctx.workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === workspaceId)
        if ((project?.roles ?? []).some((r: any) => r.slug === params.slug)) {
          throw new RequestError('CONFLICT', 'This role is defined in code - remove it from app/roles.ts', 409)
        }
      }
      const assigned = await db
        .select()
        .from(members)
        .where(and(eq(members.workspaceId, workspaceId), eq(members.role, params.slug)))
      if (assigned.length > 0) {
        throw new RequestError('CONFLICT',
          `Role is still assigned to ${assigned.length} member(s) - reassign them first`, 409)
      }

      await db.delete(roles).where(and(eq(roles.workspaceId, workspaceId), eq(roles.slug, params.slug)))
      if (redis) { try { await redis.del(roleCacheKey(workspaceId, params.slug)) } catch { /* ignore */ } }
      invalidateMemberPermissions()

      set.status = 204
      return null
    })
