/**
 * File Name: contract.ts
 * Purpose: The open contribution contract - how extensions and site
 *          developers add triggers/actions to the Flow builder. Triggers
 *          declare payloadFields so marketing gets typed pickers; actions
 *          declare configFields so the builder renders their form; both
 *          may carry a capability so only entitled members see/use them.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Extensions export these from their server entry as
 *          `flowTriggers` / `flowActions`; site developers pass them via
 *          the flows entry options in app/config/extensions.ts
 *          (defineFlowHelpers). Flows discovers both at runtime.
 *
 *          THIS FILE IS THE PUBLIC ENTRY: `@tangen/ext-flows/contract`. It
 *          must stay isomorphic - types plus one identity function, importing
 *          nothing but @tangen/types. The package ROOT is the Admin bundler's
 *          barrel: it pulls the canvas pages, which import the Admin-only
 *          `@/kit` alias, so it does not resolve outside that build. A
 *          developer wants this subpath, never the root.
 */
import type { ExtensionServerCtx } from '@tangen/types'

export interface FlowTriggerContribution {
  /** Event type ('custom:coupon.claimed', 'ext:<id>:<name>', or platform types). */
  type: string
  label: string
  description?: string
  /** RBAC capability required to SEE and USE this trigger in the builder. */
  capability?: string
  /** Typed picker hints for conditions/variables (paths relative to trigger). */
  /** Payload shape - powers the Insert-data picker AND test-run seeds; `sample` prefills the test dialog. */
  payloadFields?: Array<{ path: string; label: string; sample?: unknown }>
}

/** One declared output field of a node - powers downstream token pickers. */
export interface FlowOutputField {
  /** Dot-path within the action's output object, e.g. 'crmContactId' or 'response.status'. */
  key: string
  label?: string
  type?: 'string' | 'number' | 'boolean' | 'json' | 'array'
}

/**
 * Execution metadata handed to a contributed action's handler as its third
 * argument: which flow is running (for honest attribution, e.g. history
 * entries labeled 'Flow: <name>') and the run's trigger (so an action can
 * default to the triggering object, like the built-in content/label actions).
 */
export interface FlowActionMeta {
  flowId?: string
  flowName?: string
  /** The resolved trigger scope ({{trigger.*}}) - objectId/typeName/payload/data. */
  trigger?: Record<string, unknown>
  /**
   * A stable identity for this logical node in this execution (Phase 9B, Unit
   * 10). It is the SAME on every attempt, so a receiver that deduplicates on
   * it does the work once however many times the retry policy delivers. Use it
   * as an `Idempotency-Key`, an upsert key, or ignore it - Tangen cannot make
   * an external system idempotent, only give it what it needs to be.
   */
  idempotencyKey?: string
  /** Which attempt this is, from 1. Deliberately NOT part of the key. */
  attempt?: number
}

export interface FlowActionContribution {
  /** Action name - namespaced by convention (e.g. 'coupon_disable'). */
  name: string
  label: string
  description?: string
  capability?: string
  /**
   * Builder form fields. Beyond text, number and json, a node may ask for a
   * CONNECTION of a provider and a RESOURCE inside it (plan-connectors B3) -
   * the same two controls an extension's settings form uses, so an operator
   * learns one picker. Both store ids, never labels.
   *
   * `connector` is the provider (`google`); `capabilities` says what the node
   * will do with it, so a connection never authorized for that says so in the
   * builder rather than at the first run. A `resource` field names the
   * connector's type (`spreadsheet`), the key of the connection field it is
   * read through (`dependsOn`), and, when the type is listed within another,
   * the key of the field that supplies its parent.
   */
  configFields?: Array<{
    key: string
    label: string
    kind?: 'text' | 'number' | 'json' | 'connection' | 'resource' | 'date'
    /** `connection` and `resource`: the provider. */
    connector?: string
    /** `connection`: what the node needs the connection to be authorized for. */
    capabilities?: string[]
    /** `resource`: the connector's resource type. */
    resource?: string
    /** `resource`: the key of the `connection` field it reads through. */
    dependsOn?: string
    /** `resource`: the key of the resource field that supplies `parent`. */
    parent?: string
  }>
  /**
   * Declared output fields - what this node returns. The builder offers these
   * as `{{steps.<id>.output.<key>}}` tokens to downstream steps, and a compile
   * check can reject refs to undeclared fields. Omit for a dynamic/opaque output.
   */
  output?: FlowOutputField[]
  /**
   * Runs server-side. Extension contributions receive the CONTRIBUTOR's own
   * ctx (their store/identity/emit, via the platform registry's lazy ctx
   * builder); site helpers run with the flows ctx (whose options ARE the
   * helpers bag). `meta` carries the running flow's id/name + trigger.
   */
  handler: (config: Record<string, unknown>, ctx: ExtensionServerCtx, meta?: FlowActionMeta) => Promise<unknown> | unknown
}

/**
 * One node of a preset's graph. Structural on purpose: this file stays
 * isomorphic (it imports nothing but @tangen/types), and the engine's own
 * `FlowNodeV2` is assignable to it, so a preset may build with either.
 */
export interface FlowPresetNode {
  id: string
  /** 'trigger' | 'condition' | 'action' | 'switch' | 'transform' | 'wait' | 'loop'. */
  kind: string
  /** Canvas position - a preset lays its own graph out so the builder opens on something readable. */
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export interface FlowPresetEdge {
  id: string
  from: string
  to: string
  /** 'yes' | 'no' | 'case:<v>' | 'default' | 'body' | 'done'; absent = the single outlet. */
  outlet?: string
}

/** What a preset builds: an ordinary flow graph, which Flows then owns. */
export interface FlowPresetGraph {
  name?: string
  description?: string
  nodes: FlowPresetNode[]
  edges: FlowPresetEdge[]
}

/**
 * A one-click integration a HOST renders where the work starts - "Add Google
 * Sheets" on a form - which Flows then executes as an ordinary flow
 * (plan-connectors D1).
 *
 * The flow IS the state: it is listed, editable, retried and logged like any
 * other, and deleting it removes the destination. Nothing here is a second
 * executor, a second retry policy or a second history.
 */
export interface FlowPresetContribution {
  /** Namespaced by convention, e.g. 'google.sheets.form-submissions'. */
  id: string
  label: string
  description?: string
  /** An icon name from @tangen/icons, when the preset has no mark of its own. */
  icon?: string
  /**
   * The provider's own mark, inline as a `data:` URI, exactly as its connector
   * declares it - so a destination reads as "Google" or "Slack" wherever it
   * appears, not as a generic glyph (the user, 2026-09-19). A host renders it
   * in an `<img>`; an icon name is the fallback.
   */
  brand?: { icon?: string; color?: string }
  /** RBAC capability required to SEE and USE the preset. */
  capability?: string
  /**
   * Where it belongs: the trigger it builds on, and the KIND of thing a host
   * renders it for ('form'). A host asks for the presets of its own scope.
   */
  appliesTo: { trigger: string; scope: string }
  /** What the operator fills in before it is built - the same field kinds a node asks for, so the same pickers are used. */
  configFields?: FlowActionContribution['configFields']
  /**
   * Builds the graph, once, from the operator's answers and the concrete thing
   * it was added to (`scope.id` is that form's id). Pure: it may not write.
   */
  build: (input: { config: Record<string, unknown>; scope: { kind: string; id: string } }) => FlowPresetGraph
}

export interface FlowHelpers {
  triggers?: FlowTriggerContribution[]
  actions?: FlowActionContribution[]
  presets?: FlowPresetContribution[]
}

/** Identity builder for site developers (app/flows.ts → extensions entry options). */
export function defineFlowHelpers(helpers: FlowHelpers): FlowHelpers {
  return helpers
}
