/**
 * File Name: writes.ts
 * Purpose: MCP write tools — create/update (always available when writes
 *          are on; creations are ALWAYS drafts) plus publish/unpublish,
 *          which only exist in write mode 'full'. Field-level mcp:false is
 *          enforced by REJECTING writes that name hidden fields — never by
 *          silently dropping them.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The host injects the write operations (Tangen's
 *          LocalClient create/update + the real publish handler), so
 *          validation, field hooks, and content hooks all fire exactly as
 *          they do for the admin.
 */
import type { McpWriteMode } from '@tangen/types'
import { rejectedWriteFields } from './exposure'
import { keyCanObjects } from './permissions'
import type { McpToolDef } from './protocol'
import type { McpToolContext } from './tools'

/** Write operations the host provides. All should throw descriptive errors. */
export interface McpWriteOps {
  /** Called after every successful write for audit trails (best-effort). */
  audit?: (event: { action: 'created' | 'updated' | 'published' | 'unpublished'; typeName: string; objectId: string; title?: string }) => void
  /** Create a DRAFT object (status is not caller-controllable). */
  create: (typeName: string, title: string, values: Record<string, unknown>) => Promise<Record<string, unknown>>
  /** Update fields/title/slug — never status. */
  update: (typeName: string, id: string, updates: Record<string, unknown>) => Promise<Record<string, unknown>>
  /** Publish transition (full mode only) — host runs the real publish pipeline. */
  publish?: (typeName: string, id: string) => Promise<Record<string, unknown>>
  /** Unpublish transition (full mode only). */
  unpublish?: (typeName: string, id: string) => Promise<Record<string, unknown>>
}

/** K2: refuses a transition the action policy says is unavailable, naming every reason and the alternative. */
async function assertActionAvailable(ctx: McpToolContext, typeName: string, id: string, actionId: 'publish' | 'unpublish'): Promise<void> {
  if (!ctx.actions) return
  const policy = await ctx.actions(typeName, id)
  const action = policy.actions.find((a) => a.id === actionId)
  if (!action || action.available) return
  const alternatives = policy.actions.filter((a) => a.replaces === actionId && a.available).map((a) => a.label)
  throw new Error(`Cannot ${actionId} ${typeName} ${id}: ${action.blockers.map((b) => b.reason).join('; ')}${alternatives.length ? `. Available instead: ${alternatives.join(', ')}` : ''}`)
}

function exposedTypeOrThrow(ctx: McpToolContext, name: unknown) {
  const t = ctx.types.find((x) => x.name === name && x.mcp !== false)
  if (!t) throw new Error(`Unknown or unexposed type: ${String(name)}. Use list_types to see what is available.`)
  return t
}

function assertWritable(ctx: McpToolContext, typeName: string) {
  if (!keyCanObjects(ctx.permissions, 'write', typeName)) {
    throw new Error(`This API key has no write grant for type "${typeName}".`)
  }
}

function assertNoHiddenFields(ctx: McpToolContext, typeName: string, payload: Record<string, unknown>) {
  const type = ctx.types.find((t) => t.name === typeName)!
  const rejected = rejectedWriteFields(type, payload)
  if (rejected.length > 0) {
    throw new Error(
      `Field(s) not writable via MCP: ${rejected.join(', ')} (mcp: false in the schema). Remove them and retry.`,
    )
  }
}

export function buildWriteTools(
  ctx: McpToolContext,
  write: McpWriteMode,
  ops: McpWriteOps,
): McpToolDef[] {
  if (write === false) return []

  const tools: McpToolDef[] = [
    {
      name: 'create_object',
      description: 'Create a new content object. Always creates a DRAFT - publishing is a separate, gated step.',
      inputSchema: {
        type: 'object',
        required: ['type', 'title'],
        properties: {
          type: { type: 'string' },
          title: { type: 'string' },
          values: { type: 'object', description: 'Field values keyed by field name (see list_types)' },
        },
      },
      handler: async (args) => {
        const type = exposedTypeOrThrow(ctx, args.type)
        assertWritable(ctx, type.name)
        const values = (args.values as Record<string, unknown>) ?? {}
        assertNoHiddenFields(ctx, type.name, values)
        const data = await ops.create(type.name, String(args.title ?? ''), values)
        ops.audit?.({ action: 'created', typeName: type.name, objectId: String(data.id), title: String(data.title ?? '') })
        return { created: true, status: 'draft', id: data.id, title: data.title }
      },
    },
    {
      name: 'update_object',
      description: 'Update fields on an existing object (title/slug/fields - never status). The object keeps its current status.',
      inputSchema: {
        type: 'object',
        required: ['type', 'id', 'updates'],
        properties: {
          type: { type: 'string' },
          id: { type: 'string' },
          updates: { type: 'object' },
        },
      },
      handler: async (args) => {
        const type = exposedTypeOrThrow(ctx, args.type)
        assertWritable(ctx, type.name)
        const updates = (args.updates as Record<string, unknown>) ?? {}
        if ('status' in updates || 'publishedAt' in updates || 'scheduledAt' in updates) {
          throw new Error('Status cannot be changed through update_object - use publish_object/unpublish_object (write mode "full").')
        }
        assertNoHiddenFields(ctx, type.name, updates)
        const data = await ops.update(type.name, String(args.id), updates)
        ops.audit?.({ action: 'updated', typeName: type.name, objectId: String(args.id) })
        return { updated: true, id: data.id ?? args.id }
      },
    },
  ]

  if (write === 'full' && ops.publish) {
    const publish = ops.publish
    tools.push({
      name: 'publish_object',
      description: 'Publish a draft object - runs the full publish pipeline (validation, hooks). Requires a publish grant on the key.',
      inputSchema: {
        type: 'object',
        required: ['type', 'id'],
        properties: { type: { type: 'string' }, id: { type: 'string' } },
      },
      handler: async (args) => {
        const type = exposedTypeOrThrow(ctx, args.type)
        await assertActionAvailable(ctx, type.name, String(args.id), 'publish')
        const data = await publish(type.name, String(args.id))
        // No MCP-side audit here — the real publish pipeline already records
        // workspace_activity with the key's actual name
        return { published: true, id: data.id ?? args.id }
      },
    })
  }
  if (write === 'full' && ops.unpublish) {
    const unpublish = ops.unpublish
    tools.push({
      name: 'unpublish_object',
      description: 'Unpublish an object back to draft. Requires a publish grant on the key.',
      inputSchema: {
        type: 'object',
        required: ['type', 'id'],
        properties: { type: { type: 'string' }, id: { type: 'string' } },
      },
      handler: async (args) => {
        const type = exposedTypeOrThrow(ctx, args.type)
        await assertActionAvailable(ctx, type.name, String(args.id), 'unpublish')
        const data = await unpublish(type.name, String(args.id))
        // Platform unpublish pipeline audits — no duplicate row from MCP
        return { unpublished: true, id: data.id ?? args.id }
      },
    })
  }

  return tools
}
