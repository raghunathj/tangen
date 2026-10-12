/**
 * File Name: field-behavior.ts
 * Purpose: The behavior overlay — extracts field-level functions (hooks,
 *          validate, dynamic options) from workspace projects' in-process code
 *          schemas and exposes them for lookup against DB-loaded schemas.
 *          The DB remains the source of truth for structure; this registry is
 *          the source of truth for behavior (Payload-style inline functions).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Built once from WorkspaceProject.schemas at server start
 *          (workspace configs import the content schema barrel in-process, so
 *          functions survive — unlike the push path's JSON boundary).
 *          Code-side fields register under their current name AND every
 *          previousName alias, so behavior still resolves when the DB schema
 *          lags a code rename (push not yet run).
 */
import type {
  WorkspaceProject, FieldHooks, FieldValidateFn, DynamicOptionsFn,
  ObjectTypeDefinition, FieldBehaviorContext,
} from '@tangen/types'

export interface FieldBehavior {
  hooks?: FieldHooks
  validate?: FieldValidateFn
  optionsFn?: DynamicOptionsFn
}

export type BehaviorRegistry = Map<string, FieldBehavior>

function key(workspaceId: string, typeName: string, fieldName: string): string {
  return `${workspaceId}:${typeName}:${fieldName}`
}

/**
 * Builds the behavior registry from every project's code schema.
 * Fields without any behavior are not registered.
 */
export function buildBehaviorRegistry(projects: WorkspaceProject[]): BehaviorRegistry {
  const registry: BehaviorRegistry = new Map()

  for (const project of projects) {
    for (const type of project.schemas ?? []) {
      for (const field of type.fields ?? []) {
        const behavior: FieldBehavior = {}
        if (field.hooks) behavior.hooks = field.hooks
        if (field.validate) behavior.validate = field.validate
        if (field.dynamicOptions) behavior.optionsFn = field.dynamicOptions
        if (!behavior.hooks && !behavior.validate && !behavior.optionsFn) continue

        registry.set(key(project.workspaceId, type.name, field.name), behavior)
        // Alias old names so behavior resolves when the DB hasn't seen a rename yet
        for (const oldName of field.previousName ?? []) {
          registry.set(key(project.workspaceId, type.name, oldName), behavior)
        }
      }
    }
  }

  return registry
}

/**
 * Looks up behavior for a (DB-schema) field. Returns undefined when the code
 * schema declares nothing for it — callers treat that as "no behavior".
 */
export function lookupBehavior(
  registry: BehaviorRegistry,
  workspaceId: string,
  typeName: string,
  fieldName: string,
): FieldBehavior | undefined {
  return registry.get(key(workspaceId, typeName, fieldName))
}

/**
 * True when the type has ANY field with the given behavior kind — read paths
 * use this to skip per-row work entirely for behavior-less types.
 */
export function typeHasBehavior(
  registry: BehaviorRegistry,
  workspaceId: string,
  typeName: string,
  kind: keyof FieldBehavior,
): boolean {
  const prefix = `${workspaceId}:${typeName}:`
  for (const [k, v] of registry) {
    if (k.startsWith(prefix) && v[kind]) return true
  }
  return false
}

/** True when any field of the type declares the given hook (beforeChange/afterRead). */
export function typeHasFieldHook(
  registry: BehaviorRegistry,
  workspaceId: string,
  typeName: string,
  hook: keyof FieldHooks,
): boolean {
  const prefix = `${workspaceId}:${typeName}:`
  for (const [k, v] of registry) {
    if (k.startsWith(prefix) && v.hooks?.[hook]) return true
  }
  return false
}

type CtxBase = Omit<FieldBehaviorContext, 'row'>

/**
 * Runs field-level beforeChange hooks over the values present in `values`
 * (absent fields are untouched — partial updates stay partial). Field hooks
 * run BEFORE type-level contentHooks. Returns the (possibly new) values map;
 * passthrough by reference when the type declares no beforeChange hooks.
 */
export async function applyFieldBeforeChange(
  registry: BehaviorRegistry,
  workspaceId: string,
  typeDef: Pick<ObjectTypeDefinition, 'name' | 'fields'>,
  values: Record<string, unknown>,
  ctxBase: CtxBase,
): Promise<Record<string, unknown>> {
  if (!typeHasFieldHook(registry, workspaceId, typeDef.name, 'beforeChange')) return values

  const out: Record<string, unknown> = { ...values }
  for (const field of typeDef.fields ?? []) {
    if (!(field.name in out)) continue
    const hook = lookupBehavior(registry, workspaceId, typeDef.name, field.name)?.hooks?.beforeChange
    if (!hook) continue
    out[field.name] = await hook(out[field.name], { ...ctxBase, row: out })
  }
  return out
}

/**
 * Runs field-level afterRead hooks over a row. Synchronous by contract (read
 * paths are hot); passthrough by reference when the type declares none.
 */
export function applyFieldAfterRead(
  registry: BehaviorRegistry,
  workspaceId: string,
  typeDef: Pick<ObjectTypeDefinition, 'name' | 'fields'>,
  row: Record<string, unknown>,
  ctxBase: CtxBase,
): Record<string, unknown> {
  if (!typeHasFieldHook(registry, workspaceId, typeDef.name, 'afterRead')) return row

  const out: Record<string, unknown> = { ...row }
  for (const field of typeDef.fields ?? []) {
    const hook = lookupBehavior(registry, workspaceId, typeDef.name, field.name)?.hooks?.afterRead
    if (!hook) continue
    out[field.name] = hook(out[field.name], { ...ctxBase, row })
  }
  return out
}

/**
 * Runs inline field validate functions (publish path) and returns an error map
 * keyed by field name — merged with the standard field-validator output.
 */
export function applyFieldValidate(
  registry: BehaviorRegistry,
  workspaceId: string,
  typeDef: Pick<ObjectTypeDefinition, 'name' | 'fields'>,
  values: Record<string, unknown>,
  ctxBase: CtxBase,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of typeDef.fields ?? []) {
    const validate = lookupBehavior(registry, workspaceId, typeDef.name, field.name)?.validate
    if (!validate) continue
    const err = validate(values[field.name], { ...ctxBase, row: values })
    if (err) errors[field.name] = err
  }
  return errors
}

// ── Active registry singleton ─────────────────────────────────────────────────
// Set once by createServer; read by local-client and routes so custom-route
// handlers get hook behavior without threading the registry everywhere
// (same pattern as index.ts's module-level _projects).

let activeRegistry: BehaviorRegistry = new Map()

export function setActiveBehaviorRegistry(registry: BehaviorRegistry): void {
  activeRegistry = registry
}

export function getActiveBehaviorRegistry(): BehaviorRegistry {
  return activeRegistry
}
