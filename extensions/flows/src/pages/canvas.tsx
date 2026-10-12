/**
 * File Name: canvas.tsx
 * Purpose: The visual flow builder - a React Flow canvas over FlowDefV2:
 *          draggable nodes with labeled outlets (yes/no, case/default,
 *          body/done), connect/rearrange, copy/paste, undo/redo, an
 *          inline validation panel (compileFlow errors, click-to-focus),
 *          and test-mode path highlighting. Node config edits happen in
 *          a side panel; positions persist on save.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @xyflow/react is extension-local; the page is a
 *          lazy route chunk so the base admin bundle stays flat. The
 *          linear editor remains the default for simple chains - the
 *          list page routes branched/v2-authored flows here.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ReactFlow, Background, BackgroundVariant, Controls, ControlButton, MiniMap, Handle, Position,
  MarkerType, ConnectionLineType,
  applyNodeChanges, applyEdgeChanges, addEdge,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  adminFetch, useCan, usePageTitle,
  Button, Badge, Text, Label, Input, Select, SelectItem, Callout, toast,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  useConfirm, ConfigFields, TokenInput, type TokenOption,
} from '@/kit'
import { DynamicIcon } from '@/kit'
import { useContentTypes, type ContentTypeItem, useLocaleStore } from '@/kit'
import type { FlowDefV2, FlowNodeV2, FlowNodeKind, FlowCondition, ConditionOp } from '../engine/types'
import { originBadge, type FlowOrigin } from '../provenance'
import { migrateFlow } from '../engine/migrate'
import { CodeEditor, HighlightedJson } from '../components/code'
import { compileFlow } from '../engine/compile'
import { describeSchedule, type FlowSchedule } from '../engine/schedule'

// ── Node components (labeled outlet handles) ─────────────────────────────────

const KIND_STYLE: Record<string, { border: string; label: string; badge: string }> = {
  trigger: { border: 'border-indigo-400', label: 'When', badge: 'bg-accent-muted text-accent-fg' },
  condition: { border: 'border-warning/40', label: 'If', badge: 'bg-warning-muted text-warning-fg' },
  switch: { border: 'border-warning/40', label: 'Switch', badge: 'bg-warning-muted text-warning-fg' },
  transform: { border: 'border-sky-400', label: 'Transform', badge: 'bg-sky-100 text-sky-600' },
  wait: { border: 'border-violet-400', label: 'Wait', badge: 'bg-violet-100 text-violet-600' },
  loop: { border: 'border-teal-400', label: 'For each', badge: 'bg-teal-100 text-teal-600' },
  action: { border: 'border-emerald-400', label: 'Do', badge: 'bg-success-muted text-success-fg' },
}

/** Icon name (a @tangen/icons name) per node - actions pick by sub-type. */
function iconName(kind: string, data: Record<string, unknown>): string {
  if (kind === 'action') {
    const a = String(data.action ?? '')
    return a === 'http' ? 'IconGlobe' : a === 'content' ? 'IconDatabase' : a === 'code' ? 'IconCode'
      : a === 'query' ? 'IconSearch' : a === 'email' ? 'IconMail' : a === 'run_flow' ? 'IconRepeat' : a === 'label' ? 'IconHash' : 'IconFileText'
  }
  return ({
    trigger: 'IconPlayCircle', condition: 'IconGitBranch', switch: 'IconGitBranch',
    loop: 'IconRepeat', transform: 'IconFilter', wait: 'IconClock',
  } as Record<string, string>)[kind] ?? 'IconFileText'
}

function summarize(kind: string, data: Record<string, unknown>): string {
  switch (kind) {
    case 'trigger': return `${String(data.type ?? '?')}${data.typeName ? ` (${data.typeName})` : ''}`
    case 'condition': return `${((data.conditions as unknown[]) ?? []).length} condition(s)`
    case 'switch': return `on ${String(data.path ?? '?')} · ${((data.cases as unknown[]) ?? []).length} case(s)`
    case 'transform': return `${Object.keys((data.output as object) ?? {}).length} field(s)`
    case 'wait': return `${data.days ?? 0}d ${data.hours ?? 0}h ${data.minutes ?? 0}m`
    case 'loop': return `over ${String(data.path ?? '?')}`
    case 'action': return String(data.action ?? '?')
    default: return ''
  }
}

function outletsFor(kind: string, data: Record<string, unknown>): string[] {
  if (kind === 'condition') return ['yes', 'no']
  if (kind === 'switch') return [...((data.cases as string[]) ?? []).map((c) => `case:${c}`), 'default']
  if (kind === 'loop') return ['body', 'done']
  if (kind === 'action') return ['', 'error']   // error = optional on-failure branch
  return ['']
}

const HANDLE_CLS = '!size-2.5 !bg-fg-subtle !border-2 !border-surface'

// FlowNode's per-outlet "+" calls this to open the step palette anchored at the
// click; the picked step is created below and connected after this outlet.
const NodeAddContext = createContext<((source: string, outlet: string, at: { x: number; y: number }) => void) | null>(null)

function FlowNode({ id, data, selected }: { id: string; data: { kind: string; nodeData: Record<string, unknown>; onPath?: boolean }; selected?: boolean }) {
  const kind = data.kind
  const style = KIND_STYLE[kind] ?? KIND_STYLE.action
  const outlets = outletsFor(kind, data.nodeData)
  const onAdd = useContext(NodeAddContext)
  const ring = data.onPath ? 'border-emerald-400 ring-2 ring-emerald-300'
    : selected ? 'border-indigo-400 ring-2 ring-focus/25' : 'border-border'
  return (
    <div className={`group relative rounded-xl border bg-surface min-w-[188px] shadow-sm transition-shadow hover:shadow-md ${ring}`}>
      {kind !== 'trigger' && <Handle type="target" position={Position.Top} className={HANDLE_CLS} />}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className={`grid place-items-center size-8 rounded-lg shrink-0 ${style.badge}`}>
          <DynamicIcon name={iconName(kind, data.nodeData)} className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle leading-none">{style.label}</p>
          <p className="text-sm font-medium text-fg truncate leading-tight mt-1">{summarize(kind, data.nodeData)}</p>
        </div>
      </div>
      {outlets.map((outlet, i) => (
        <Handle
          key={outlet || 'next'}
          id={outlet || undefined}
          type="source"
          position={Position.Bottom}
          className={HANDLE_CLS}
          style={{ left: `${((i + 1) / (outlets.length + 1)) * 100}%` }}
        />
      ))}
      {outlets.length > 1 && (
        <div className="flex justify-between px-3 pb-2 -mt-1">
          {outlets.map((o) => (
            <span key={o || 'next'} className={`text-[9px] font-medium ${o === 'error' ? 'text-danger' : 'text-fg-subtle'}`}>
              {o === '' ? 'next' : o === 'error' ? 'on error' : o.replace('case:', '')}
            </span>
          ))}
        </div>
      )}
      {/* "+ add next step" under each outlet (on hover) - builds the flow forward */}
      {onAdd && outlets.map((outlet, i) => (
        <button
          key={`add-${outlet || 'next'}`}
          type="button"
          title="Add the next step"
          onClick={(e) => { e.stopPropagation(); onAdd(id, outlet, { x: e.clientX, y: e.clientY }) }}
          className="nodrag nopan absolute grid place-items-center size-5 rounded-full border border-border bg-surface text-sm leading-none text-fg-subtle shadow-sm opacity-0 group-hover:opacity-100 hover:text-accent-fg hover:border-accent/50 transition-opacity"
          style={{ left: `${((i + 1) / (outlets.length + 1)) * 100}%`, bottom: -30, transform: 'translateX(-50%)' }}
        >+</button>
      ))}
    </div>
  )
}

const nodeTypes = { flowNode: FlowNode }

// Minimap tint per node kind - mirrors the KIND_STYLE accent so the map reads
// the same as the canvas at a glance.
const MINIMAP_COLOR: Record<string, string> = {
  trigger: '#818cf8', condition: '#fbbf24', switch: '#fbbf24',
  transform: '#38bdf8', wait: '#a78bfa', loop: '#2dd4bf', action: '#34d399',
}
const miniMapColor = (n: Node) => MINIMAP_COLOR[(n.data as { kind?: string })?.kind ?? 'action'] ?? '#34d399'

// ── Component palette ────────────────────────────────────────────────────────
// Concrete, directly-placeable steps (Shopify/Zapier-style catalog). Actions are
// first-class here (HTTP request, Content, Run code, Log) rather than a generic
// "Do" node the user has to reconfigure - each drops a preset action node.
// Starter snippet for a new "Run code" node so it isn't a blank box.
const SAMPLE_CODE = `// input = { trigger, steps }. Always return an object.
const amount = input.trigger?.payload?.amount ?? 0
return { tier: amount > 500 ? 'vip' : 'standard' }`

interface PaletteItem { group: string; label: string; hint: string; kind: FlowNodeKind; data: Record<string, unknown> }
const PALETTE: PaletteItem[] = [
  { group: 'Actions', label: 'HTTP request', hint: 'Call an external API', kind: 'action', data: { action: 'http', config: { method: 'POST', url: '' } } },
  { group: 'Actions', label: 'Send email', hint: 'Email via workspace mail', kind: 'action', data: { action: 'email', config: { to: '', subject: '', html: '' } } },
  { group: 'Actions', label: 'Run code', hint: 'Custom JS in a sandbox', kind: 'action', data: { action: 'code', config: { source: SAMPLE_CODE } } },
  { group: 'Actions', label: 'Log', hint: 'Write to the run log', kind: 'action', data: { action: 'log', config: { message: '' } } },
  { group: 'Content', label: 'Create / update content', hint: 'Write fields', kind: 'action', data: { action: 'content', config: {} } },
  { group: 'Content', label: 'Query / count content', hint: 'Count or list → {{count}}', kind: 'action', data: { action: 'query', config: { typeName: '', status: 'draft' } } },
  { group: 'Content', label: 'Publish content', hint: 'Publish the object', kind: 'action', data: { action: 'content', config: { op: 'publish', typeName: '', objectId: '{{trigger.objectId}}' } } },
  { group: 'Content', label: 'Unpublish content', hint: 'Move it back to draft', kind: 'action', data: { action: 'content', config: { op: 'unpublish', typeName: '', objectId: '{{trigger.objectId}}' } } },
  { group: 'Content', label: 'System Label', hint: 'Add / remove labels on any entity', kind: 'action', data: { action: 'label', config: { entityKind: 'content', typeName: '', objectId: '', entityId: '{{trigger.objectId}}', addLabels: [], removeLabels: [] } } },
  { group: 'Logic', label: 'If / condition', hint: 'Branch on yes / no', kind: 'condition', data: { conditions: [] } },
  { group: 'Logic', label: 'Switch', hint: 'Branch on a value', kind: 'switch', data: { path: 'trigger.payload.', cases: [] } },
  { group: 'Logic', label: 'For each', hint: 'Loop over an array', kind: 'loop', data: { path: 'trigger.payload.' } },
  { group: 'Data', label: 'Transform', hint: 'Reshape data for later steps', kind: 'transform', data: { output: {} } },
  { group: 'Flow', label: 'Wait / delay', hint: 'Pause before continuing', kind: 'wait', data: { minutes: 60 } },
  { group: 'Flow', label: 'Run flow', hint: 'Call another flow → {{output}}', kind: 'action', data: { action: 'run_flow', config: { flowId: '', input: {} } } },
]

// Extension/site-contributed nodes come from GET /catalog and merge into the
// palette (so a custom "Send email" / "Charge Stripe" node just appears). The
// catalog is capability-filtered + only includes installed/enabled extensions.
type CatalogField = {
  key: string; label: string
  kind?: 'text' | 'number' | 'json' | 'connection' | 'resource' | 'date'
  /** `connection`/`resource`: the provider (plan-connectors B3). */
  connector?: string
  capabilities?: string[]
  resource?: string
  dependsOn?: string
  parent?: string
}
type OutputField = { key: string; label?: string; type?: 'string' | 'number' | 'boolean' | 'json' | 'array' }
interface CatalogAction { name: string; label: string; description?: string; capability?: string; configFields?: CatalogField[]; output?: OutputField[]; contributor?: string }
interface FlowCatalog {
  triggers: Array<{ type: string; label: string; description?: string; payloadFields?: Array<{ path: string; label: string }> }>
  actions: CatalogAction[]
}

/**
 * The columns every content object has, whatever its schema declares. They are
 * flat on the row a trigger hydrates, exactly like a declared field, so they
 * are tokens in the same shape - and they are the ones an operator reaches for
 * first.
 */
const OBJECT_SYSTEM_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'id', label: 'Id' },
  { key: 'title', label: 'Title' },
  { key: 'slug', label: 'Slug' },
  { key: 'status', label: 'Status (draft / published / …)' },
  { key: 'createdAt', label: 'Created at' },
  { key: 'updatedAt', label: 'Updated at' },
  { key: 'publishedAt', label: 'Published at' },
]

/** Group a trigger by its event family for the picker (Content / Media / …). */
function triggerCategory(type: string): string {
  if (type === 'schedule') return 'Schedule'
  if (type === 'manual') return 'Manual'
  if (type === 'webhook') return 'Webhook'
  if (type.startsWith('object.')) return 'Content'
  if (type.startsWith('media.')) return 'Media'
  if (type.startsWith('member.')) return 'Members'
  if (type.startsWith('site_user.')) return 'Site users'
  if (type.startsWith('custom:')) return 'Custom events'
  if (type.startsWith('ext:')) return 'Extensions'
  return 'Other'
}

// Built-in action output shapes - contributed actions declare their own via
// the catalog's `output`. Keys are dot-paths within the node's output object.
const BUILTIN_OUTPUTS: Record<string, OutputField[]> = {
  http: [{ key: 'response.status', type: 'number' }, { key: 'response.body', type: 'json' }],
  content: [{ key: 'updated.typeName', type: 'string' }, { key: 'updated.objectId', type: 'string' }, { key: 'result', type: 'json' }],
  label: [{ key: 'entityType', type: 'string' }, { key: 'entityId', type: 'string' }],
  query: [{ key: 'count', type: 'number' }, { key: 'items', type: 'array' }],
  email: [{ key: 'sent.to', type: 'string' }, { key: 'sent.subject', type: 'string' }],
  log: [{ key: 'message', type: 'string' }],
  wait: [{ key: 'waited', type: 'number' }],
}

// Per-field form specs for built-in actions - a friendly form, with a JSON
// escape hatch (ConfigForm). Keys map straight to the action's config shape.
type CfgFieldKind = 'text' | 'number' | 'textarea' | 'select' | 'json' | 'contentType' | 'status' | 'stringList' | 'flowRef'
interface CfgField { key: string; label: string; kind: CfgFieldKind; options?: Array<{ value: string; label: string }>; placeholder?: string; emptyLabel?: string }
const opt = (...vs: string[]) => vs.map((v) => ({ value: v, label: v }))
const BUILTIN_ACTION_FIELDS: Record<string, CfgField[]> = {
  http: [
    { key: 'method', label: 'Method', kind: 'select', options: opt('POST', 'GET', 'PUT', 'PATCH', 'DELETE') },
    { key: 'url', label: 'URL', kind: 'text', placeholder: 'https://api.example.com/hook' },
    { key: 'headers', label: 'Headers', kind: 'json' },
    { key: 'body', label: 'Body', kind: 'json' },
    { key: 'secret', label: 'Signing secret (optional)', kind: 'text' },
  ],
  email: [
    { key: 'to', label: 'To', kind: 'text', placeholder: '{{trigger.data.email}}' },
    { key: 'subject', label: 'Subject', kind: 'text' },
    { key: 'html', label: 'HTML body', kind: 'textarea', placeholder: '<p>Hi {{trigger.data.name}}</p>' },
    { key: 'text', label: 'Text body (optional)', kind: 'textarea' },
  ],
  query: [
    { key: 'typeName', label: 'Content type', kind: 'contentType' },
    { key: 'status', label: 'Status', kind: 'status' },
    { key: 'limit', label: 'Limit (max 20)', kind: 'number', placeholder: '20' },
    { key: 'where', label: 'Filter (optional)', kind: 'json' },
  ],
  content: [
    { key: 'op', label: 'Operation', kind: 'select', options: [{ value: 'update', label: 'Update fields' }, { value: 'publish', label: 'Publish' }, { value: 'unpublish', label: 'Unpublish' }] },
    { key: 'typeName', label: 'Content type', kind: 'contentType', emptyLabel: 'Same as trigger (default)' },
    { key: 'objectId', label: 'Object id', kind: 'text', placeholder: 'Defaults to the triggering object' },
    { key: 'at', label: 'Publish at (optional - future, else now)', kind: 'text', placeholder: '2026-08-01T09:00:00Z' },
    { key: 'fields', label: 'Fields (update only)', kind: 'json' },
  ],
  label: [
    { key: 'entityKind', label: 'Entity', kind: 'select', options: [{ value: 'content', label: 'Content' }, { value: 'submission', label: 'Form submission' }, { value: 'member', label: 'Member' }, { value: 'media', label: 'Media' }] },
    { key: 'typeName', label: 'Content type (for Content)', kind: 'contentType', emptyLabel: 'Same as trigger (default)' },
    { key: 'entityId', label: 'Entity id', kind: 'text', placeholder: 'Defaults to the triggering object' },
    { key: 'addLabels', label: 'Add labels', kind: 'stringList', placeholder: 'flow-welcomed' },
    { key: 'removeLabels', label: 'Remove labels', kind: 'stringList' },
  ],
  run_flow: [
    { key: 'flowId', label: 'Flow to run', kind: 'flowRef' },
    { key: 'input', label: 'Input (passed as trigger.payload)', kind: 'json' },
  ],
  log: [{ key: 'message', label: 'Message', kind: 'textarea', placeholder: 'Saw {{trigger.data.title}}' }],
}

/** Output fields a node exposes to downstream {{steps.<id>.output.…}} tokens. */
function outputsForNode(kind: string, data: Record<string, unknown>, catalog: FlowCatalog | null): OutputField[] {
  if (kind === 'transform') return Object.keys((data.output as Record<string, unknown>) ?? {}).map((key) => ({ key }))
  if (kind === 'loop') return [{ key: 'items', type: 'number' }]
  if (kind === 'action') {
    const action = String(data.action ?? '')
    if (BUILTIN_OUTPUTS[action]) return BUILTIN_OUTPUTS[action]
    return catalog?.actions.find((a) => a.name === action)?.output ?? []   // code / undeclared → opaque
  }
  return []
}

// ── Graph ⇄ React Flow mapping ───────────────────────────────────────────────

function toRF(def: FlowDefV2, pathSet: Set<string>): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: def.nodes.map((n) => ({
      id: n.id, type: 'flowNode', position: n.position,
      // Every flow needs exactly one trigger - the "When" node can't be deleted.
      deletable: n.kind !== 'trigger',
      data: { kind: n.kind, nodeData: n.data, onPath: pathSet.has(n.id) },
    })),
    edges: def.edges.map((e) => ({
      id: e.id, source: e.from, target: e.to, sourceHandle: e.outlet || undefined,
      type: 'smoothstep',
      label: e.outlet?.replace('case:', '') || undefined,
      animated: pathSet.has(e.from) && pathSet.has(e.to),
      markerEnd: { type: MarkerType.ArrowClosed },
    })),
  }
}

function fromRF(def: FlowDefV2, nodes: Node[], edges: Edge[]): FlowDefV2 {
  return {
    ...def,
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: (n.data as { kind: FlowNodeKind }).kind,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      data: (n.data as { nodeData: Record<string, unknown> }).nodeData,
    })),
    edges: edges.map((e) => ({
      id: e.id, from: e.source, to: e.target,
      ...(e.sourceHandle ? { outlet: e.sourceHandle } : {}),
    })),
  }
}

const newId = (kind: string) => `${kind}_${Math.random().toString(36).slice(2, 8)}`

// Auto-arrange: longest-path layering from the roots (no dagre dep). Each node's
// layer = its longest distance from a root; nodes in a layer spread horizontally,
// layers stack vertically. Returns new positions keyed by node id.
function autoLayout(nodes: Node[], edges: Edge[]): Map<string, { x: number; y: number }> {
  const children = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const n of nodes) indeg.set(n.id, 0)
  for (const e of edges) {
    children.set(e.source, [...(children.get(e.source) ?? []), e.target])
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
  }
  const depth = new Map<string, number>()
  const q = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id)
  for (const id of q) depth.set(id, 0)
  const left = new Map(indeg)
  let i = 0
  while (i < q.length) {                     // Kahn's + longest-path relaxation
    const id = q[i++]
    const d = depth.get(id) ?? 0
    for (const c of children.get(id) ?? []) {
      depth.set(c, Math.max(depth.get(c) ?? 0, d + 1))
      left.set(c, (left.get(c) ?? 0) - 1)
      if ((left.get(c) ?? 0) === 0) q.push(c)
    }
  }
  const byDepth = new Map<number, string[]>()
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0
    byDepth.set(d, [...(byDepth.get(d) ?? []), n.id])
  }
  const X = 260, Y = 150
  const pos = new Map<string, { x: number; y: number }>()
  for (const [d, ids] of byDepth) {
    const span = (ids.length - 1) * X
    ids.forEach((id, k) => pos.set(id, { x: 320 + k * X - span / 2, y: 40 + d * Y }))
  }
  return pos
}

// ── The page ─────────────────────────────────────────────────────────────────

export function FlowCanvasPage() {
  const { workspaceId, flowId } = useParams<{ workspaceId: string; flowId: string }>()
  const navigate = useNavigate()
  const { hasCapability, me } = useCan()
  const canManage = hasCapability('manage:flows' as never)

  const [def, setDef] = useState<FlowDefV2 | null>(null)
  const [origin, setOrigin] = useState<FlowOrigin | null>(null)
  // `google` is an id; "Google connectors" is what an operator calls it. The
  // extensions list is readable by any member (the sidebar is built from it).
  const [extensionNames, setExtensionNames] = useState<Record<string, string>>({})
  const extensionName = useCallback((id: string) => extensionNames[id], [extensionNames])
  const [loadError, setLoadError] = useState(false)
  // The canvas has no page header, so publish the flow name for the tab title.
  usePageTitle(def?.name)
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [pathSet, setPathSet] = useState<Set<string>>(new Set())
  const [testStatus, setTestStatus] = useState<string | null>(null)
  const [testOpen, setTestOpen] = useState(false)
  const [testSeed, setTestSeed] = useState('')
  const [testResult, setTestResult] = useState<{ status: string; ms: number; log: Array<{ step: string; action: string; ok: boolean; ms: number; output?: unknown; error?: string }> } | null>(null)
  const [testRunning, setTestRunning] = useState(false)
  const [testDry, setTestDry] = useState(true)
  const [saving, setSaving] = useState(false)
  const [catalog, setCatalog] = useState<FlowCatalog | null>(null)
  const [runMenuOpen, setRunMenuOpen] = useState(false)
  const { confirm, confirmDialog } = useConfirm()
  const [editingName, setEditingName] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const history = useRef<Array<{ nodes: Node[]; edges: Edge[] }>>([])
  const future = useRef<Array<{ nodes: Node[]; edges: Edge[] }>>([])
  const clipboard = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null)

  useEffect(() => {
    adminFetch<{ data: Array<{ id: string; name: string }> }>('/extensions')
      .then((r) => setExtensionNames(Object.fromEntries((r.data ?? []).map((e) => [e.id, e.name]))))
      .catch(() => {})
    adminFetch<{ data: FlowDefV2 & { origin?: FlowOrigin } }>(`/admin/ext/flows/flows/${flowId}`)
      .then((r) => {
        setOrigin(r.data.origin ?? null)
        const v2 = migrateFlow(r.data as never)
        // Rescue: a flow that somehow lost its trigger gets a default one back
        // (the palette has no trigger to add manually).
        if (!v2.nodes.some((n) => n.kind === 'trigger')) {
          v2.nodes = [
            { id: newId('trigger'), kind: 'trigger', position: { x: 160, y: 40 }, data: { type: 'object.published' } },
            ...v2.nodes,
          ]
        }
        setDef(v2)
        const rf = toRF(v2, new Set())
        setNodes(rf.nodes)
        setEdges(rf.edges)
      })
      .catch(() => setLoadError(true))
  }, [flowId])

  // The palette is registry-driven: built-in nodes ∪ whatever extensions/site
  // helpers contribute (capability- and enablement-filtered server-side).
  useEffect(() => {
    // Feature gate (P1c): hide triggers for features this deployment has off - a
    // "Form submitted" trigger with Forms disabled can never fire; same for
    // site-user triggers without Site Auth.
    Promise.all([
      adminFetch<{ data: FlowCatalog }>('/admin/ext/flows/catalog'),
      adminFetch<{ extensions?: { forms?: boolean; auth?: boolean } }>('/route-resources').catch(() => ({ extensions: { forms: true, auth: true } })),
    ])
      .then(([cat, res]) => {
        const formsOn = res.extensions?.forms !== false
        const authOn = res.extensions?.auth !== false
        setCatalog({
          ...cat.data,
          triggers: cat.data.triggers.filter((t) =>
            (formsOn || t.type !== 'form.submitted') && (authOn || !t.type.startsWith('site_user.'))),
        })
      })
      .catch(() => setCatalog({ triggers: [], actions: [] }))
  }, [])

  const snapshot = useCallback(() => {
    history.current.push({ nodes: structuredClone(nodes), edges: structuredClone(edges) })
    if (history.current.length > 50) history.current.shift()
    future.current = []
  }, [nodes, edges])

  const undo = useCallback(() => {
    const prev = history.current.pop()
    if (!prev) return
    future.current.push({ nodes, edges })
    setNodes(prev.nodes); setEdges(prev.edges)
  }, [nodes, edges])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    history.current.push({ nodes, edges })
    setNodes(next.nodes); setEdges(next.edges)
  }, [nodes, edges])

  const copy = useCallback(() => {
    const sel = nodes.filter((n) => n.selected)
    if (!sel.length) return
    const ids = new Set(sel.map((n) => n.id))
    clipboard.current = {
      nodes: structuredClone(sel),
      edges: structuredClone(edges.filter((e) => ids.has(e.source) && ids.has(e.target))),
    }
    toast.success(`Copied ${sel.length} node(s)`)
  }, [nodes, edges])

  const paste = useCallback(() => {
    const clip = clipboard.current
    if (!clip) return
    snapshot()
    const idMap = new Map(clip.nodes.map((n) => [n.id, newId((n.data as { kind: string }).kind)]))
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      ...clip.nodes
        .filter((n) => (n.data as { kind: string }).kind !== 'trigger')   // one trigger per flow
        .map((n) => ({ ...n, id: idMap.get(n.id)!, position: { x: n.position.x + 40, y: n.position.y + 40 }, selected: true })),
    ])
    setEdges((es) => [
      ...es,
      ...clip.edges
        .filter((e) => idMap.has(e.source) && idMap.has(e.target))
        .map((e) => ({ ...e, id: newId('e'), source: idMap.get(e.source)!, target: idMap.get(e.target)! })),
    ])
  }, [snapshot])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack undo/copy/paste while typing in a field - let the browser
      // handle text editing (Cmd+Z there undoes the text, not the canvas).
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && e.shiftKey) { e.preventDefault(); redo() }
      else if (k === 'z') { e.preventDefault(); undo() }
      else if (k === 'c') copy()
      else if (k === 'v') paste()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, copy, paste])

  const current = useMemo(() => (def ? fromRF(def, nodes, edges) : null), [def, nodes, edges])
  // Pass contributed action names so the builder's live validation doesn't flag
  // extension/site actions (e.g. sink_echo) as "unknown".
  const compiled = useMemo(
    () => (current ? compileFlow(current, { extraActions: (catalog?.actions ?? []).map((a) => a.name) }) : null),
    [current, catalog],
  )

  const onNodesChange = useCallback((c: NodeChange[]) => setNodes((ns) => {
    // Belt-and-suspenders: never let a remove change take out the trigger node.
    const triggerIds = new Set(ns.filter((n) => (n.data as { kind?: string }).kind === 'trigger').map((n) => n.id))
    const safe = c.filter((ch) => !(ch.type === 'remove' && triggerIds.has(ch.id)))
    return applyNodeChanges(safe, ns)
  }), [])
  const onEdgesChange = useCallback((c: EdgeChange[]) => { setEdges((es) => applyEdgeChanges(c, es)) }, [])
  const onConnect = useCallback((c: Connection) => {
    snapshot()
    setEdges((es) => addEdge({ ...c, id: newId('e'), type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } }, es))
  }, [snapshot])

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  // The step palette opens anchored at a node's "+"; the pick is connected after
  // that source outlet. addAfter = which outlet; palettePos = where to render.
  const [addAfter, setAddAfter] = useState<{ source: string; outlet: string } | null>(null)
  const [palettePos, setPalettePos] = useState<{ x: number; y: number } | null>(null)
  // Built-in nodes ∪ contributed actions from the catalog (each drops a preset
  // action node whose `action` is the contributed name → executor runContributed).
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const contributed: PaletteItem[] = (catalog?.actions ?? []).map((a) => ({
      group: a.contributor && a.contributor !== 'site' ? 'Integrations' : 'Custom',
      label: a.label, hint: a.description ?? 'Custom action', kind: 'action',
      data: { action: a.name, config: {} },
    }))
    return [...PALETTE, ...contributed]
  }, [catalog])
  const paletteGroups = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase()
    const items = q ? paletteItems.filter((p) => (p.label + ' ' + p.hint + ' ' + p.group).toLowerCase().includes(q)) : paletteItems
    return items.reduce<Record<string, PaletteItem[]>>((acc, it) => { (acc[it.group] ??= []).push(it); return acc }, {})
  }, [paletteQuery, paletteItems])

  const closePalette = useCallback(() => { setPaletteOpen(false); setPaletteQuery(''); setAddAfter(null); setPalettePos(null) }, [])
  const openAddPalette = useCallback((source: string, outlet: string, at: { x: number; y: number }) => {
    setAddAfter({ source, outlet }); setPalettePos(at); setPaletteQuery(''); setPaletteOpen(true)
  }, [])

  const addNode = (item: PaletteItem) => {
    snapshot()
    const id = newId(item.kind)
    const src = addAfter ? nodes.find((n) => n.id === addAfter.source) : undefined
    const position = src
      ? { x: Math.round(src.position.x), y: Math.round(src.position.y + 130) }
      : { x: 160 + Math.random() * 60, y: 140 + nodes.length * 70 }
    setNodes((ns) => [...ns, { id, type: 'flowNode', position, data: { kind: item.kind, nodeData: structuredClone(item.data) } }])
    if (addAfter) {
      // Connect the new step after the chosen outlet - builds the flow forward.
      setEdges((es) => [...es, {
        id: newId('e'), source: addAfter.source, target: id, type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed }, ...(addAfter.outlet ? { sourceHandle: addAfter.outlet } : {}),
      }])
    }
    setSelected(id)
    closePalette()
  }

  const tidy = useCallback(() => {
    snapshot()
    const pos = autoLayout(nodes, edges)
    setNodes((ns) => ns.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n)))
    toast.success('Tidied up')
  }, [nodes, edges, snapshot])

  const save = async () => {
    if (!current) return
    setSaving(true)
    try {
      await adminFetch(`/admin/ext/flows/flows/${flowId}`, { method: 'PATCH', body: JSON.stringify(current) })
      toast.success('Saved')
      setDef(current)
    } catch (e) {
      toast.error('Save failed', (e as Error).message)
    } finally { setSaving(false) }
  }

  // Turn on/off from the builder - saves the current graph WITH the new
  // enabled state in one PATCH (enabling compiles server-side and rejects a
  // broken flow, so what turns on is exactly what's on the canvas). Turning
  // off cancels runs parked at a Wait - warn first.
  const toggleEnabled = async () => {
    if (!current || !def) return
    if (def.enabled) {
      let waiting = 0
      try {
        const r = await adminFetch<{ meta?: { total: number } }>('/admin/ext/flows/runs', undefined, { flowId: flowId!, status: 'waiting', limit: '1' })
        waiting = r.meta?.total ?? 0
      } catch { /* count is best-effort */ }
      if (waiting > 0 && !(await confirm({
        title: 'Turn off this flow?',
        description: `${waiting} run${waiting === 1 ? ' is' : 's are'} waiting on a delay - turning off cancels ${waiting === 1 ? 'it' : 'them'}.`,
        variant: 'destructive',
      }))) return
    }
    const next = { ...current, enabled: !def.enabled }
    setSaving(true)
    try {
      await adminFetch(`/admin/ext/flows/flows/${flowId}`, { method: 'PATCH', body: JSON.stringify(next) })
      toast.success(next.enabled ? 'Flow turned on' : 'Flow turned off')
      setDef(next)
    } catch (e) {
      toast.error(def.enabled ? 'Could not turn off' : 'Could not turn on', (e as Error).message)
    } finally { setSaving(false) }
  }

  // "Test run" opens a dialog: edit the dummy trigger data the flow will see
  // ({{trigger.data.*}} / {{trigger.payload.*}}), run, then inspect every
  // node's output inline. Seed is derived from the trigger's content type.
  const openTest = () => {
    const trigNode = nodes.find((n) => (n.data as { kind?: string }).kind === 'trigger')
    const nd = ((trigNode?.data as { nodeData?: Record<string, unknown> })?.nodeData ?? {}) as Record<string, unknown>
    const tType = String(nd.type ?? '')
    const seed: Record<string, unknown> = {}
    if (tType.startsWith('object.')) {
      const t = contentTypes.find((x) => x.name === String(nd.typeName ?? ''))
      const data: Record<string, unknown> = { id: 'obj_test', status: tType === 'object.published' ? 'published' : 'draft' }
      for (const f of t?.fields ?? []) data[f.name] = sampleFieldValue(f.name, f.fieldType)
      seed.data = data
      seed.labels = []
    } else if (tType === 'form.submitted') {
      seed.payload = { formSlug: 'contact', values: { email: 'test@example.com', message: 'Sample message' } }
    } else if (tType.startsWith('member.')) {
      seed.payload = { email: 'member@example.com', name: 'Sample Member' }
    } else if (tType.startsWith('site_user.')) {
      seed.payload = { userId: 'au_test', email: 'user@example.com', name: 'Sample User', provider: 'password' }
    } else if (tType === 'media.uploaded') {
      seed.payload = { objectId: 'med_test', filename: 'sample.jpg', mimeType: 'image/jpeg' }
    } else {
      // Contributed/custom trigger: seed from its declared payload fields
      // (a declared `sample` wins over the generic placeholder).
      const ct = (catalog?.triggers ?? []).find((t) => t.type === tType)
      const payload: Record<string, unknown> = {}
      for (const pf of ct?.payloadFields ?? []) {
        const path = pf.path.replace(/^payload\./, '').split('.')
        let cursor = payload
        for (let i = 0; i < path.length - 1; i++) cursor = (cursor[path[i]] ??= {}) as Record<string, unknown>
        cursor[path[path.length - 1]] = pf.sample !== undefined ? pf.sample : `Sample ${pf.label.toLowerCase()}`
      }
      seed.payload = payload
    }
    setTestSeed(JSON.stringify(seed, null, 2))
    setTestResult(null)
    setTestOpen(true)
  }

  const runTest = async () => {
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(testSeed) } catch { toast.error('Dummy data is not valid JSON'); return }
    setTestRunning(true)
    try {
      await adminFetch(`/admin/ext/flows/flows/${flowId}`, { method: 'PATCH', body: JSON.stringify(current) })
      const r = await adminFetch<{ data: NonNullable<typeof testResult> & { path?: string[] } }>(
        `/admin/ext/flows/flows/${flowId}/test`, { method: 'POST', body: JSON.stringify({ trigger: parsed, dryRun: testDry }) },
      )
      setPathSet(new Set(r.data.path ?? []))
      setTestStatus(r.data.status)
      setTestResult(r.data)
    } catch (e) {
      toast.error('Test run failed', (e as Error).message)
    } finally { setTestRunning(false) }
  }

  // "Run now" - save, then fire a REAL manual run (durable, shows in Runs).
  const runNow = async () => {
    try {
      await adminFetch(`/admin/ext/flows/flows/${flowId}`, { method: 'PATCH', body: JSON.stringify(current) })
      await adminFetch(`/admin/ext/flows/flows/${flowId}/run`, { method: 'POST', body: JSON.stringify({}) })
      toast.success('Run queued', 'Watch it in Settings → Jobs → Runs.')
    } catch (e) {
      toast.error('Run failed', (e as Error).message)
    }
  }

  // Reflect the last test-run path as highlight on the LIVE nodes/edges. We do
  // NOT re-derive the whole array each render (via toRF) - that would replace the
  // node objects React Flow tracks and strip its drag/select state, breaking
  // dragging + connecting. Only touch a node/edge when its highlight changes.
  useEffect(() => {
    setNodes((ns) => ns.map((n) => ((n.data as { onPath?: boolean }).onPath === pathSet.has(n.id)
      ? n : { ...n, data: { ...(n.data as object), onPath: pathSet.has(n.id) } })))
    setEdges((es) => es.map((e) => {
      const on = pathSet.has(e.source) && pathSet.has(e.target)
      return e.animated === on ? e : { ...e, animated: on }
    }))
  }, [pathSet])

  const selectedNode = nodes.find((n) => n.id === selected)

  // Tokens the selected node may reference: the trigger + every UPSTREAM step's
  // declared outputs. Same ancestor rule the compiler enforces, so the picker
  // never offers a ref that would fail compile.
  const contentTypes = useContentTypes()
  // Localization is a workspace fact, and the tokens that only make sense
  // with it on are offered only then.
  const localesEnabled = useLocaleStore((l) => l.enabled)
  const availableTokens = useMemo(() => {
    if (!selectedNode) return [] as Array<{ token: string; label: string; group: string }>
    const preds: Record<string, string[]> = {}
    for (const e of edges) (preds[e.target] ??= []).push(e.source)
    const anc = new Set<string>()
    const stack = [...(preds[selectedNode.id] ?? [])]
    while (stack.length) { const p = stack.pop()!; if (anc.has(p)) continue; anc.add(p); stack.push(...(preds[p] ?? [])) }
    const tokens: Array<{ token: string; label: string; group: string }> = []
    for (const n of nodes) {
      if (!anc.has(n.id)) continue
      const kind = (n.data as { kind: string }).kind
      const nd = (n.data as { nodeData: Record<string, unknown> }).nodeData
      if (kind === 'trigger') {
        const tType = String(nd.type ?? '')
        tokens.push({ token: '{{trigger.objectId}}', label: 'Object id', group: 'Trigger' })
        const tn = String(nd.typeName ?? '')
        const t = contentTypes.find((x) => x.name === tn)
        for (const f of (t?.fields ?? [])) tokens.push({ token: `{{trigger.data.${f.name}}}`, label: f.name, group: 'Content fields' })
        if (tType.startsWith('object.')) {
          tokens.push({ token: '{{trigger.typeName}}', label: 'Content type', group: 'Trigger' })
          tokens.push({ token: '{{trigger.labels}}', label: 'System labels', group: 'Trigger' })
          // Every object has these, whatever its schema declares - and they
          // were missing from the picker entirely (the user, 2026-09-19), so
          // the commonest tokens of all (title, slug, status) had to be
          // guessed at.
          for (const sys of OBJECT_SYSTEM_FIELDS) {
            tokens.push({ token: `{{trigger.data.${sys.key}}}`, label: sys.label, group: 'Content fields' })
          }
          if (tType === 'object.updated') {
            tokens.push({ token: '{{trigger.changed}}', label: 'Changed fields', group: 'Trigger' })
            tokens.push({ token: '{{trigger.prev.title}}', label: 'prev.<field> (old value)', group: 'Trigger' })
          }
          // With localization on, a write names the translation it targeted,
          // and `trigger.data` is resolved IN that locale (the base row when
          // it targeted none). A condition can therefore run a flow for one
          // language only.
          // A type that is not localized never names a locale on a write, so
          // the token would always be empty for it.
          if (localesEnabled && (t?.localized !== false)) {
            tokens.push({ token: '{{trigger.locale}}', label: 'Locale written (empty for the base row)', group: 'Content fields' })
          }
        }
        // Whatever the trigger DECLARES it carries. A contributed trigger
        // (Forms' form.submitted) already lists its payload fields for the
        // test-run seed, so the same declaration offers real paths here -
        // `trigger.submission.values` rather than one generic token.
        for (const f of catalog?.triggers.find((x) => x.type === tType)?.payloadFields ?? []) {
          tokens.push({ token: `{{trigger.${f.path}}}`, label: f.label, group: 'Trigger' })
        }
        continue
      }
      const label = KIND_STYLE[kind]?.label ?? kind
      const nodeLabel = kind === 'action' ? String(nd.action ?? label) : label
      for (const f of outputsForNode(kind, nd, catalog)) {
        tokens.push({ token: `{{steps.${n.id}.output.${f.key}}}`, label: `${nodeLabel} · ${f.key}`, group: 'Steps' })
      }
    }
    return tokens
  }, [selectedNode, nodes, edges, catalog, contentTypes, localesEnabled])

  if (loadError) {
    return (
      <div className="p-6 max-w-md mx-auto text-center space-y-3 pt-16">
        <DynamicIcon name="IconProhibited" className="size-8 mx-auto text-fg-subtle" />
        <p className="text-lg font-semibold text-fg">Flow not found</p>
        <Text variant="help">It may have been deleted. Its past runs remain under All runs.</Text>
        <Button variant="secondary" onClick={() => navigate(`/${workspaceId}/extensions/flows`)}>← Back to flows</Button>
      </div>
    )
  }
  if (!def) return <div className="p-6"><Text>Loading…</Text></div>

  const exit = () => navigate(`/${workspaceId}/extensions/flows`)
  const errCount = compiled?.errors.length ?? 0

  return (
    // Full-viewport takeover - escapes the admin shell chrome (sidebar/top bar/
    // page header), same pattern as the API Playground. Its own slim top bar owns
    // Save / Test / Exit; the canvas gets the whole width.
    <div className="fixed inset-0 z-50 bg-surface-sunken flex flex-col">
      <div className="flex items-center gap-3 px-3 h-12 border-b border-border bg-surface shrink-0">
        <Button size="sm" variant="ghost" onClick={exit}>← Exit</Button>
        <span className="w-px h-5 bg-border" />
        {editingName ? (
          <input
            ref={nameRef}
            value={def.name}
            autoFocus
            onChange={(e) => setDef({ ...def, name: e.currentTarget.value })}
            onBlur={() => { setEditingName(false); if (canManage) void save() }}   // click outside saves
            onKeyDown={(e) => { if (e.key === 'Enter') { setEditingName(false); if (canManage) void save() } else if (e.key === 'Escape') setEditingName(false) }}
            aria-label="Flow name"
            className="text-sm font-medium text-fg bg-surface border border-accent rounded px-1.5 py-0.5 w-[240px] focus:outline-none"
          />
        ) : (
          <button type="button" disabled={!canManage} onClick={() => setEditingName(true)}
            className="group flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-surface-hover disabled:hover:bg-transparent">
            <span className="text-sm font-medium text-fg">{def.name || 'Untitled flow'}</span>
            {canManage && <DynamicIcon name="IconPencil" className="size-3.5 text-fg-subtle opacity-0 group-hover:opacity-100" />}
          </button>
        )}
        {/* Where this flow came from, next to its name: a pack's preset built
            it, or a person drew it - and whether anyone has changed it since.
            An operator about to edit a destination should know it arrived
            with a pack. */}
        {origin && (() => {
          const badge = originBadge(origin, { extensionName, you: me?.memberId })
          return (
            <span className="flex items-center gap-1.5 text-[11px] text-fg-subtle" title={badge.detail}>
              {origin.kind === 'preset' && <DynamicIcon name="IconPuzzle" className="size-3 shrink-0" />}
              {badge.label}{badge.edited ? ' · edited' : ''}
            </span>
          )
        })()}
        <div className="flex-1" />
        {compiled && (errCount > 0
          ? <Badge variant="error">{errCount} error{errCount > 1 ? 's' : ''}</Badge>
          : <Badge variant="success">Valid</Badge>)}
        {testStatus && testResult && (
          <button type="button" className="cursor-pointer" onClick={() => setTestOpen(true)}>
            <Badge variant={testStatus === 'completed' ? 'success' : testStatus === 'skipped' ? 'neutral' : 'error'}>
              <span className="inline-flex items-center gap-1">
                {testStatus === 'completed' ? 'View test results' : testStatus === 'skipped' ? 'Test skipped: details' : 'Test failed: details'}
                <DynamicIcon name="IconExternalLink" className="size-3" />
              </span>
            </Badge>
          </button>
        )}
        {canManage ? (
          <Button size="sm" variant="secondary" className="gap-1.5" onClick={toggleEnabled}
            disabled={saving || (!def.enabled && errCount > 0)}
            title={!def.enabled && errCount > 0 ? 'Fix the compile errors first - a broken flow cannot be turned on' : undefined}>
            <DynamicIcon name={def.enabled ? 'IconPlayerPause' : 'IconPlayerPlay'} className="size-3.5" />
            {def.enabled ? 'Turn off' : 'Turn on'}
            <Badge variant={def.enabled ? 'success' : 'neutral'}>{def.enabled ? 'On' : 'Off'}</Badge>
          </Button>
        ) : (
          <Badge variant={def.enabled ? 'success' : 'neutral'}>{def.enabled ? 'Enabled' : 'Disabled'}</Badge>
        )}
        {/* Test run (primary) + Run now behind the caret */}
        <div className="relative flex">
          <Button size="sm" variant="secondary" onClick={openTest} disabled={!canManage} className="rounded-r-none">Test run</Button>
          <Button size="sm" variant="secondary" onClick={() => setRunMenuOpen((o) => !o)} disabled={!canManage} aria-label="More run options"
            className="rounded-l-none px-1.5 -ml-px">
            <DynamicIcon name="IconChevronDown" className="size-3.5" />
          </Button>
          {runMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setRunMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 w-40 rounded-md border border-border bg-surface shadow-lg py-1">
                <button type="button" disabled={errCount > 0}
                  onClick={() => { setRunMenuOpen(false); runNow() }}
                  className="w-full text-left px-3 py-1.5 text-sm text-fg hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed">
                  Run now
                  <span className="block text-[11px] text-fg-subtle">Real durable run</span>
                </button>
              </div>
            </>
          )}
        </div>
        <Button size="sm" variant="primary" onClick={save} isLoading={saving} disabled={!canManage}>Save</Button>
      </div>

      <div className="flex-1 flex min-h-0">
      <div className="flex-1 relative min-w-0">
        <NodeAddContext.Provider value={canManage ? openAddPalette : null}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={snapshot}
          onNodeClick={(_, n) => setSelected(n.id)}
          onPaneClick={() => setSelected(null)}
          fitView
          fitViewOptions={{ maxZoom: 1.05, padding: 0.22 }}
          snapToGrid
          snapGrid={[16, 16]}
          minZoom={0.2}
          defaultEdgeOptions={{ type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } }}
          connectionLineType={ConnectionLineType.SmoothStep}
          deleteKeyCode={canManage ? ['Backspace', 'Delete'] : []}
          nodesDraggable={canManage}
          nodesConnectable={canManage}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls>
            {canManage && (
              <ControlButton onClick={tidy} title="Tidy up - auto-arrange the nodes">
                <DynamicIcon name="IconSparkles" />
              </ControlButton>
            )}
          </Controls>
          <MiniMap pannable zoomable nodeColor={miniMapColor} nodeStrokeWidth={2} />
        </ReactFlow>
        </NodeAddContext.Provider>

        {/* Step palette - opens anchored at the clicked "+" (fixed to the cursor) */}
        {paletteOpen && palettePos && (
          <>
            <div className="fixed inset-0 z-30" onClick={closePalette} />
            <div
              className="fixed z-40 w-64 rounded-lg border border-border bg-surface shadow-lg p-2 max-h-[60vh] overflow-y-auto"
              style={{
                left: Math.min(palettePos.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 280),
                top: Math.min(palettePos.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 380),
              }}
            >
              <Input autoFocus placeholder="Search steps…" value={paletteQuery} onChange={(e) => setPaletteQuery(e.currentTarget.value)} />
              {Object.entries(paletteGroups).map(([group, items]) => (
                <div key={group} className="mt-2">
                  <p className="text-[10px] uppercase tracking-wide text-fg-subtle px-1">{group}</p>
                  {items.map((it) => (
                    <button key={it.label} type="button" onClick={() => addNode(it)}
                      className="w-full flex items-center gap-2.5 text-left px-2 py-1.5 rounded-md hover:bg-surface-hover">
                      <span className={`grid place-items-center size-7 rounded-lg shrink-0 ${KIND_STYLE[it.kind]?.badge ?? KIND_STYLE.action.badge}`}>
                        <DynamicIcon name={iconName(it.kind, it.data)} className="size-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm text-fg">{it.label}</span>
                        <span className="block text-xs text-fg-subtle truncate">{it.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
              {Object.keys(paletteGroups).length === 0 && (
                <p className="text-xs text-fg-subtle px-2 py-3">No steps match “{paletteQuery}”.</p>
              )}
            </div>
          </>
        )}
        {/* Floating validation - only surfaces blocking errors; click to focus */}
        {compiled && compiled.errors.length > 0 && (
          <div className="absolute top-3 right-3 z-10 w-72">
            <Callout variant="warning" title="Fix before enabling">
              <ul className="space-y-1 text-xs">
                {compiled.errors.map((e, i) => {
                  const nodeRef = /node (\S+?)\.?( |$)/.exec(e)?.[1]
                  return (
                    <li key={i}>
                      <button className="text-left underline decoration-dotted" onClick={() => nodeRef && setSelected(nodeRef)}>{e}</button>
                    </li>
                  )
                })}
              </ul>
            </Callout>
          </div>
        )}
      </div>

      {/* Docked config panel - part of the canvas (no modal, no close button).
          Shows the selected step's config, or a hint. Click empty canvas to clear. */}
      <aside className="w-[340px] shrink-0 border-l border-border bg-surface overflow-y-auto flex flex-col">
        <div className="px-4 py-3.5 border-b border-border shrink-0">
          {selectedNode ? (() => {
            const sk = (selectedNode.data as { kind: string }).kind
            const sd = (selectedNode.data as { nodeData: Record<string, unknown> }).nodeData
            return (
              <div className="flex items-center gap-2.5">
                <span className={`grid place-items-center size-8 rounded-lg shrink-0 ${KIND_STYLE[sk]?.badge ?? ''}`}>
                  <DynamicIcon name={iconName(sk, sd)} className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg leading-tight">{KIND_STYLE[sk]?.label ?? 'Step'}{sk === 'action' ? '' : ' step'}</p>
                  <p className="text-[11px] font-mono text-fg-subtle truncate">{selectedNode.id}</p>
                </div>
              </div>
            )
          })() : (
            <p className="text-sm font-medium text-fg">Step details</p>
          )}
        </div>
        <div className="px-5 py-5 flex-1">
          {selectedNode ? (
            <NodeConfig
              node={selectedNode}
              catalog={catalog}
              contentTypes={contentTypes}
              tokens={availableTokens}
              onChange={(nodeData) => {
                setNodes((ns) => ns.map((n) => n.id === selectedNode.id
                  ? { ...n, data: { ...(n.data as object), nodeData } } : n))
              }}
              onRemove={() => {
                snapshot()
                setNodes((ns) => ns.filter((n) => n.id !== selectedNode.id))
                setEdges((es) => es.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id))
                setSelected(null)
              }}
              canManage={canManage}
            />
          ) : (
            <Text variant="help">Select a step on the canvas to edit it here.</Text>
          )}
        </div>
      </aside>
      </div>
      {confirmDialog}
      {testOpen && (
        <Dialog open onOpenChange={(o) => { if (!o) setTestOpen(false) }}>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>{testResult ? 'Test results' : 'Test this flow'}</DialogTitle></DialogHeader>
            {!testResult ? (
              <div className="px-6 py-4 space-y-2">
                <Label>Simulated trigger data</Label>
                <CodeEditor value={testSeed} onChange={setTestSeed} lang="json" maxHeight="300px" />
                <Text variant="help">
                  The flow sees this as <code className="font-mono">{'{{trigger.data.*}}'}</code> and <code className="font-mono">{'{{trigger.payload.*}}'}</code>. Edit the values to match the case you want to test. Wait steps are skipped.
                </Text>
                <label className="flex items-start gap-2 pt-1 cursor-pointer select-none">
                  <input type="checkbox" checked={testDry} onChange={(e) => setTestDry(e.currentTarget.checked)} className="mt-0.5 accent-indigo-500" />
                  <span className="text-sm text-fg">
                    Dry run
                    <span className="block text-xs text-fg-subtle">Emails, HTTP calls, content writes, labels and custom actions are simulated: you see what each one would do, nothing is sent or written. Queries and code still run (read-only).</span>
                  </span>
                </label>
                {!testDry && (
                  <Callout variant="warning" title="Actions run for real">
                    Only the trigger is simulated. Emails send, HTTP calls fire, and content edits write to real objects if the ids exist. Point them at test values (the dummy ids above are safe: they match nothing).
                  </Callout>
                )}
              </div>
            ) : (
              <div className="px-6 py-4 space-y-2 max-h-[60vh] overflow-y-auto">
                <div className="flex items-center gap-2">
                  <Badge variant={testResult.status === 'completed' ? 'success' : testResult.status === 'skipped' ? 'neutral' : 'error'}>{testResult.status}</Badge>
                  <Text variant="help" className="mt-0">{testResult.ms}ms · {testResult.log.length} step{testResult.log.length === 1 ? '' : 's'}</Text>
                </div>
                {testResult.status === 'skipped' && (
                  <Text variant="help">The trigger conditions did not match the simulated data, so no steps ran.</Text>
                )}
                {testResult.log.map((entry, i) => (
                  <details key={i} className="border border-border rounded-md bg-surface-sunken/40" open={!entry.ok}>
                    <summary className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer select-none text-sm">
                      <DynamicIcon name={entry.ok ? 'IconCheckCircle' : 'IconCloseCircle'} className={`size-4 shrink-0 ${entry.ok ? 'text-success' : 'text-danger-fg'}`} />
                      <span className="font-medium text-fg">{stepDisplayName(entry, nodes)}</span>
                      {(entry.output as { dryRun?: boolean } | undefined)?.dryRun && <Badge variant="neutral">simulated</Badge>}
                      {(entry.output as { skippedInTest?: boolean } | undefined)?.skippedInTest && <Badge variant="neutral">skipped</Badge>}
                      <span className="ml-auto text-xs text-fg-subtle">{entry.ms}ms</span>
                    </summary>
                    <div className="px-2.5 pb-2">
                      {entry.error
                        ? <p className="text-xs text-danger-fg whitespace-pre-wrap">{entry.error}</p>
                        : <HighlightedJson value={entry.output ?? {}} />}
                    </div>
                  </details>
                ))}
              </div>
            )}
            <DialogFooter>
              {testResult
                ? <>
                    <Button variant="secondary" onClick={() => setTestResult(null)}>Edit data & rerun</Button>
                    <Button onClick={() => setTestOpen(false)}>Done</Button>
                  </>
                : <>
                    <Button variant="secondary" onClick={() => setTestOpen(false)}>Cancel</Button>
                    <Button onClick={runTest} disabled={testRunning}>{testRunning ? 'Running…' : 'Run test'}</Button>
                  </>}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// Dummy value per schema field for the test dialog's seed.
function sampleFieldValue(name: string, fieldType: string): unknown {
  const ft = (fieldType || '').toLowerCase()
  if (ft.includes('number') || ft.includes('int') || ft.includes('float')) return 42
  if (ft.includes('bool')) return true
  if (ft.includes('date') || ft.includes('time')) return '2026-08-01T09:00:00Z'
  if (ft.includes('json') || ft.includes('block') || ft.includes('repeat')) return {}
  if (ft.includes('relation') || ft.includes('media')) return 'obj_related'
  if (ft.includes('email') || name.toLowerCase().includes('email')) return 'test@example.com'
  return `Sample ${name}`
}

// "email · send email" style display for a step-log row: node kind/action
// plus the raw node id so it can be found on the canvas.
function stepDisplayName(entry: { step: string; action: string }, nodes: Node[]): string {
  const baseId = entry.step.replace(/\[\d+\]$/, '')
  const node = nodes.find((n) => n.id === baseId)
  const kind = (node?.data as { kind?: string } | undefined)?.kind
  const label = kind === 'action' ? entry.action : (kind ? (KIND_STYLE[kind]?.label ?? kind) : entry.action)
  const iter = entry.step.match(/\[(\d+)\]$/)
  return iter ? `${label} (iteration ${Number(iter[1]) + 1})` : label
}

// ── Node config side panel ────────────────────────────────────────────────────

const OPS: ConditionOp[] = ['eq', 'neq', 'gt', 'lt', 'contains', 'not_contains', 'exists']
const OP_LABELS: Record<ConditionOp, string> = {
  eq: 'Equals',
  neq: 'Does not equal',
  gt: 'Greater than',
  lt: 'Less than',
  contains: 'Contains',
  not_contains: 'Does not contain',
  exists: 'Exists',
}

function NodeConfig({ node, catalog, contentTypes, tokens, onChange, onRemove, canManage }: {
  node: Node
  catalog: FlowCatalog | null
  contentTypes: ContentTypeItem[]
  tokens: Array<{ token: string; label: string; group: string }>
  onChange: (data: Record<string, unknown>) => void
  onRemove: () => void
  canManage: boolean
}) {
  const kind = (node.data as { kind: string }).kind
  const data = (node.data as { nodeData: Record<string, unknown> }).nodeData
  const set = (k: string, v: unknown) => onChange({ ...data, [k]: v })
  // Whether a condition may name a locale at all.
  const localesEnabled = useLocaleStore((l) => l.enabled)
  // A contributed action (from the catalog) renders its declared configFields;
  // built-in actions keep their bespoke editors below.
  const BUILT_IN_ACTIONS = new Set(['http', 'content', 'code', 'log'])
  const contributed = kind === 'action' && !BUILT_IN_ACTIONS.has(String(data.action))
    ? catalog?.actions.find((a) => a.name === data.action)
    : undefined
  const setConfig = (k: string, v: unknown) => set('config', { ...(data.config as object), [k]: v })

  return (
      <div className="space-y-5 [&_label]:mb-1.5">
        {kind === 'trigger' && (() => {
          const current = String(data.type ?? '')
          const known = (catalog?.triggers ?? []).some((t) => t.type === current)
          const ordered = [...(catalog?.triggers ?? [])].sort(
            (a, b) => triggerCategory(a.type).localeCompare(triggerCategory(b.type)) || a.label.localeCompare(b.label),
          )
          const isContent = current.startsWith('object.')
          const isSchedule = current === 'schedule'
          const isManual = current === 'manual'
          const isWebhook = current === 'webhook'
          const picked = catalog?.triggers.find((t) => t.type === current)
          return (
            <>
              <div>
                <Label>When this happens</Label>
                <SearchSelect
                  value={current}
                  placeholder="Pick a trigger…"
                  options={[
                    ...(!known && current ? [{ value: current, label: current }] : []),
                    ...ordered.map((t) => ({ value: t.type, label: t.label, group: triggerCategory(t.type) })),
                  ]}
                  onChange={(v) => {
                    // Picking "On a schedule" seeds a sensible default recurrence.
                    if (v === 'schedule' && !data.schedule) onChange({ ...data, type: v, schedule: { frequency: 'daily', hour: 9, minute: 0, timezone: 'UTC' } })
                    else set('type', v)
                  }}
                />
                {picked?.description && <Text variant="help" className="mt-1.5">{picked.description}</Text>}
              </div>
              {isSchedule && (
                <ScheduleEditor value={data.schedule as FlowSchedule | undefined} onChange={(s) => set('schedule', s)} />
              )}
              {isManual && (
                <Callout variant="info" title="On-demand">Runs when you click <strong>Run now</strong> above, or POST to this flow's run endpoint.</Callout>
              )}
              {isWebhook && (
                <WebhookEditor
                  secret={String(data.secret ?? '')}
                  onSecretChange={(s) => set('secret', s || undefined)}
                />
              )}
              {isContent && (() => {
                const tn = String(data.typeName ?? '')
                const known = contentTypes.some((t) => t.name === tn)
                return (
                  <div>
                    <Label>Content type</Label>
                    <SearchSelect
                      value={tn || '__any__'}
                      options={[
                        { value: '__any__', label: 'Any content type' },
                        ...(!known && tn ? [{ value: tn, label: tn }] : []),
                        ...contentTypes.map((t) => ({ value: t.name, label: t.label ?? t.name })),
                      ]}
                      onChange={(v) => set('typeName', v === '__any__' ? undefined : v)}
                    />
                  </div>
                )
              })()}
              {!isSchedule && !isManual && (
                <div className="pt-1 border-t border-border">
                  <Label className="pt-3">Only run when…</Label>
                  <ConditionEditor
                    conditions={(data.conditions as FlowCondition[]) ?? []}
                    onChange={(c) => set('conditions', c)}
                    fields={fieldsFor(contentTypes, String(data.typeName ?? ''), { localesEnabled })}
                  />
                  <Text variant="help" className="mt-2">Optional - all conditions must hold before the flow runs.</Text>
                </div>
              )}
              {!(catalog?.triggers ?? []).length && <Text variant="help">Loading available triggers…</Text>}
            </>
          )
        })()}
        {kind === 'condition' && (
          <ConditionEditor conditions={(data.conditions as FlowCondition[]) ?? []} onChange={(c) => set('conditions', c)} />
        )}
        {kind === 'switch' && (
          <>
            <Input label="Value path" value={String(data.path ?? '')} onChange={(e) => set('path', e.currentTarget.value)} placeholder="trigger.payload.tier" />
            <Input label="Cases (comma-separated)" value={((data.cases as string[]) ?? []).join(', ')}
              onChange={(e) => set('cases', e.currentTarget.value.split(',').map((x) => x.trim()).filter(Boolean))} />
            <Text variant="help" className="mt-1.5">Reconnect edges after renaming cases - each case is an outlet.</Text>
          </>
        )}
        {kind === 'transform' && (
          <JsonArea label="Output object ({{tokens}} allowed)" value={data.output} onChange={(v) => set('output', v)} />
        )}
        {kind === 'wait' && (
          <div className="grid grid-cols-3 gap-2">
            {(['days', 'hours', 'minutes'] as const).map((u) => (
              <Input key={u} label={u} type="number" value={String(data[u] ?? 0)} onChange={(e) => set(u, Number(e.currentTarget.value))} />
            ))}
          </div>
        )}
        {kind === 'loop' && (
          <Input label="Array path" value={String(data.path ?? '')} onChange={(e) => set('path', e.currentTarget.value)} placeholder="trigger.payload.items" />
        )}
        {kind === 'action' && (
          <>
            <div className="flex items-center gap-2">
              <span className={`grid place-items-center size-7 rounded-lg shrink-0 ${KIND_STYLE.action.badge}`}>
                <DynamicIcon name={iconName('action', data)} className="size-4" />
              </span>
              <span className="text-sm font-medium text-fg">
                {contributed?.label
                  ?? ({ http: 'HTTP request', content: 'Create / update content', query: 'Query / count content', email: 'Send email', label: 'System Label', run_flow: 'Run flow', code: 'Run code', log: 'Log' } as Record<string, string>)[String(data.action)]
                  ?? String(data.action ?? 'Action')}
              </span>
            </div>
            {contributed?.description && <Text variant="help" className="mt-1.5">{contributed.description}</Text>}
            {contributed ? (
              contributed.configFields?.length ? (
                // B3 + D1: the kit renders the declared kinds, so this
                // builder and a host's own "add a destination" dialog put the
                // same controls in front of an operator. The JSON kind stays
                // ours, because this is where a highlighted editor belongs.
                <ConfigFields
                  fields={contributed.configFields}
                  value={(data.config as Record<string, unknown>) ?? {}}
                  onChange={(key, next) => setConfig(key, next)}
                  tokens={tokens}
                  jsonEditor={({ label, value, onChange }) => <JsonArea label={label} value={value} onChange={onChange} tokens={tokens} />}
                />
              ) : (
                <JsonArea label="Config ({{tokens}} allowed)" value={data.config} onChange={(v) => set('config', v)} />
              )
            ) : String(data.action) === 'code' ? (
              <div>
                <Label>JavaScript - return an object; `input` = trigger + steps</Label>
                <CodeEditor
                  value={String((data.config as Record<string, unknown>)?.source ?? '')}
                  onChange={(v) => set('config', { ...(data.config as object), source: v })}
                />
                <Text variant="help" className="mt-1.5">Sandboxed - no network. For HTTP calls use the HTTP request action.</Text>
              </div>
            ) : BUILTIN_ACTION_FIELDS[String(data.action)] ? (
              <ConfigForm
                fields={BUILTIN_ACTION_FIELDS[String(data.action)]}
                config={(data.config as Record<string, unknown>) ?? {}}
                onChange={(v) => set('config', v)}
                contentTypes={contentTypes}
                tokens={tokens}
              />
            ) : (
              <JsonArea label="Config ({{tokens}} allowed)" value={data.config} onChange={(v) => set('config', v)} />
            )}
            <div className="pt-3 border-t border-border">
              <Label>Retry on failure</Label>
              <div className="w-44">
                <Select value={String(data.retries ?? 0)} onValueChange={(v: string) => set('retries', Number(v))}>
                  <SelectItem value="0">Don't retry</SelectItem>
                  <SelectItem value="1">1 retry</SelectItem>
                  <SelectItem value="2">2 retries</SelectItem>
                  <SelectItem value="3">3 retries</SelectItem>
                </Select>
              </div>
              <Text variant="help" className="mt-1.5">Short backoff between attempts. If it still fails, the red <strong>on error</strong> outlet runs (when connected) instead of failing the flow; the branch sees the message as <code className="font-mono">{'{{steps.<id>.output.error}}'}</code>.</Text>
            </div>
          </>
        )}
        {kind !== 'trigger' && tokens.length > 0 && (
          <div className="pt-3 border-t border-border">
            {/* The tokens live IN the fields now: type `{{` or press the data
                button in any field that takes one. This line says so, and
                names how many there are, so an operator knows to look. */}
            <Text variant="help">
              Fields above take data from the run: type <code className="font-mono">{'{{'}</code> or press the data button to pick from {tokens.length} available {tokens.length === 1 ? 'value' : 'values'}.
            </Text>
          </div>
        )}
        {canManage && kind !== 'trigger' && (
          <div className="pt-3 border-t border-border">
            <Button size="xs" variant="ghost" onClick={onRemove} className="gap-1.5 text-danger-fg hover:text-danger-fg hover:bg-danger-muted">
              <DynamicIcon name="IconTrash" className="size-3.5" /> Remove step
            </Button>
          </div>
        )}
      </div>
  )
}

/**
 * Path suggestions for a content trigger's conditions: the type's own fields,
 * every system column each object has, and the run's own facts.
 *
 * The system columns were missing here as well as from the token picker (the
 * user, 2026-09-19), so `trigger.data.title` - the single most likely
 * condition anyone writes - had to be typed from memory.
 */
function fieldsFor(types: ContentTypeItem[], typeName: string, opts: { localesEnabled?: boolean } = {}): string[] {
  const t = types.find((x) => x.name === typeName)
  const fromSchema = (t?.fields ?? []).map((f) => `trigger.data.${f.name}`)
  const system = OBJECT_SYSTEM_FIELDS.map((f) => `trigger.data.${f.key}`)
  return [...new Set([
    ...fromSchema, ...system,
    'trigger.labels', 'trigger.changed', 'trigger.payload.title',
    // With localization on, a condition can run a flow for one language only -
    // and `exists` distinguishes a translation from the base row.
    ...(opts.localesEnabled && t?.localized !== false ? ['trigger.locale'] : []),
  ])]
}

function ConditionEditor({ conditions, onChange, fields }: {
  conditions: FlowCondition[]
  onChange: (c: FlowCondition[]) => void
  fields?: string[]
}) {
  const listId = fields?.length ? `flow-cond-paths` : undefined
  const upd = (i: number, patch: Partial<FlowCondition>) => onChange(conditions.map((x, j) => j === i ? { ...x, ...patch } : x))
  return (
    <div className="space-y-2 mt-1.5">
      {listId && (
        <datalist id={listId}>{fields!.map((f) => <option key={f} value={f} />)}</datalist>
      )}
      {conditions.map((c, i) => (
        <div key={i} className="space-y-2 border border-border rounded-lg p-2.5 bg-surface-sunken/40">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <Input placeholder="trigger.data.status" list={listId} value={c.path}
                onChange={(e) => upd(i, { path: e.currentTarget.value })} />
            </div>
            <Button size="xs" variant="ghost" aria-label="Remove condition"
              className="shrink-0 px-1.5 text-fg-subtle hover:text-danger-fg"
              onClick={() => onChange(conditions.filter((_, j) => j !== i))}>
              <DynamicIcon name="IconX" className="size-3.5" />
            </Button>
          </div>
          {c.op !== 'exists' && (
            <div className="grid grid-cols-[10rem_1fr] gap-2">
              <Select value={c.op} onValueChange={(v: string) => upd(i, { op: v as ConditionOp })}>
                {OPS.map((o) => <SelectItem key={o} value={o}>{OP_LABELS[o]}</SelectItem>)}
              </Select>
              <Input placeholder="value" value={String(c.value ?? '')} onChange={(e) => upd(i, { value: e.currentTarget.value })} />
            </div>
          )}
          {c.op === 'exists' && (
            <Select value={c.op} onValueChange={(v: string) => upd(i, { op: v as ConditionOp })}>
              {OPS.map((o) => <SelectItem key={o} value={o}>{OP_LABELS[o]}</SelectItem>)}
            </Select>
          )}
        </div>
      ))}
      <Button size="xs" variant="secondary" className="gap-1.5"
        onClick={() => onChange([...conditions, { path: '', op: 'eq', value: '' }])}>
        <DynamicIcon name="IconPlus" className="size-3.5" /> Add condition
      </Button>
    </div>
  )
}

const TZ_OPTIONS = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Kolkata', 'Asia/Singapore', 'Australia/Sydney']
const DOW = [{ v: 1, l: 'Mon' }, { v: 2, l: 'Tue' }, { v: 3, l: 'Wed' }, { v: 4, l: 'Thu' }, { v: 5, l: 'Fri' }, { v: 6, l: 'Sat' }, { v: 0, l: 'Sun' }]

function ScheduleEditor({ value, onChange }: { value: FlowSchedule | undefined; onChange: (s: FlowSchedule) => void }) {
  const s: FlowSchedule = value ?? { frequency: 'daily', hour: 9, minute: 0, timezone: 'UTC' }
  const upd = (patch: Partial<FlowSchedule>) => onChange({ ...s, ...patch })
  return (
    <div className="space-y-3">
      <div>
        <Label>Frequency</Label>
        <Select value={s.frequency} onValueChange={(v: string) => upd({ frequency: v as FlowSchedule['frequency'] })}>
          <SelectItem value="hourly">Every hour</SelectItem>
          <SelectItem value="daily">Every day</SelectItem>
          <SelectItem value="weekly">Every week</SelectItem>
        </Select>
      </div>
      {s.frequency === 'weekly' && (
        <div>
          <Label>On days</Label>
          <div className="flex flex-wrap gap-1">
            {DOW.map((d) => {
              const on = (s.daysOfWeek ?? []).includes(d.v)
              return (
                <button key={d.v} type="button"
                  onClick={() => { const set = new Set(s.daysOfWeek ?? []); on ? set.delete(d.v) : set.add(d.v); upd({ daysOfWeek: [...set].sort() }) }}
                  className={`text-[11px] px-2 py-1 rounded border transition-colors ${on ? 'border-accent bg-accent/10 text-accent' : 'border-border text-fg-subtle hover:border-accent'}`}>
                  {d.l}
                </button>
              )
            })}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {s.frequency !== 'hourly' && (
          <Input label="Hour (0–23)" type="number" value={String(s.hour ?? 9)} onChange={(e) => upd({ hour: Number(e.currentTarget.value) })} />
        )}
        <Input label="Minute (0–59)" type="number" value={String(s.minute ?? 0)} onChange={(e) => upd({ minute: Number(e.currentTarget.value) })} />
      </div>
      <div>
        <Label>Timezone</Label>
        <Select value={s.timezone ?? 'UTC'} onValueChange={(v: string) => upd({ timezone: v })}>
          {TZ_OPTIONS.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
        </Select>
      </div>
      <Callout variant="info" title="Runs">{describeSchedule(s)}</Callout>
    </div>
  )
}

function WebhookEditor({ secret, onSecretChange }: { secret: string; onSecretChange: (s: string) => void }) {
  const { flowId } = useParams<{ flowId: string }>()
  const [url, setUrl] = useState<string | null>(null)
  const [rotated, setRotated] = useState<{ at: string; from: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const loadUrl = useCallback(() => {
    setErr(null)
    adminFetch<{ data: { path: string; rotated?: { at: string; from: string } } }>(`/admin/ext/flows/flows/${flowId}/webhook`)
      .then((r) => { setUrl(`${window.location.origin}${r.data.path}`); setRotated(r.data.rotated ?? null) })
      .catch((e) => setErr((e as Error).message))
  }, [flowId])
  useEffect(() => { loadUrl() }, [loadUrl])
  return (
    <div className="space-y-3">
      <div>
        <Label>Webhook URL</Label>
        {rotated && (
          <Callout variant="warning" title="This URL changed" className="mb-2">
            The webhook URL took a new form on {new Date(rotated.at).toLocaleDateString()}. URLs of the old form ({rotated.from}) answer 410 Gone. Copy the URL below into the sender; saving this flow clears the notice.
          </Callout>
        )}
        {url ? (
          <button type="button" title="Copy URL"
            onClick={() => { navigator.clipboard?.writeText(url); toast.success('Webhook URL copied') }}
            className="w-full text-left text-[11px] font-mono px-2 py-1.5 rounded border border-border bg-surface-sunken hover:border-accent break-all">
            {url}
          </button>
        ) : (
          <Text variant="help">{err ? `Save the flow first - ${err}` : 'Loading… (save the flow to generate it)'}</Text>
        )}
        <Text variant="help" className="mt-1.5">POST here to run the flow. Treat this URL as a secret - anyone with it can trigger the flow. <button type="button" className="underline" onClick={loadUrl}>Refresh</button></Text>
      </div>
      <Input label="Body signature secret (optional)" value={secret} placeholder="shared secret"
        onChange={(e) => onSecretChange(e.currentTarget.value)} />
      <Text variant="help" className="mt-1.5">If set, callers must send <code className="font-mono">X-Tangen-Signature: sha256=HMAC(secret, body)</code>.</Text>
    </div>
  )
}

/** JavaScript editor for the code node - lazy CodeMirror 6 (syntax highlighting,
 *  brackets, line numbers). Loaded on demand so it doesn't bloat the base bundle. */
/** Compact searchable dropdown (Radix Select can't search + grows unbounded). */
function SearchSelect({ value, onChange, options, placeholder }: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string; group?: string }>
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const selected = options.find((o) => o.value === value)
  const filtered = q ? options.filter((o) => (o.label + ' ' + (o.group ?? '')).toLowerCase().includes(q.toLowerCase())) : options
  const close = () => { setOpen(false); setQ('') }
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm hover:border-accent focus:outline-none focus-visible:border-focus-border">
        <span className={`truncate ${selected ? 'text-fg' : 'text-fg-subtle'}`}>{selected?.label ?? placeholder ?? 'Select…'}</span>
        <DynamicIcon name="IconChevronDown" className="size-3.5 text-fg-subtle shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} />
          <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-md border border-border bg-surface shadow-lg">
            <div className="p-1.5 border-b border-border">
              <Input autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              {filtered.map((o) => (
                <button key={o.value} type="button" onClick={() => { onChange(o.value); close() }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-surface-hover ${o.value === value ? 'text-accent font-medium' : 'text-fg'}`}>
                  {o.group && <span className="text-fg-subtle">{o.group} · </span>}{o.label}
                </button>
              ))}
              {!filtered.length && <p className="px-3 py-2 text-xs text-fg-subtle">No matches</p>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ConfigForm({ fields, config, onChange, contentTypes, tokens }: {
  fields: CfgField[]
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
  contentTypes: ContentTypeItem[]
  /** What the run resolves here - a URL, a subject and a body all want it. */
  tokens?: readonly TokenOption[]
}) {
  const { flowId: currentFlowId } = useParams<{ flowId: string }>()
  const [jsonMode, setJsonMode] = useState(false)
  // Flow picker options (for the 'flowRef' field) - fetched only when needed.
  const [flows, setFlows] = useState<Array<{ id: string; name: string }>>([])
  const needsFlows = fields.some((f) => f.kind === 'flowRef')
  useEffect(() => {
    if (!needsFlows) return
    adminFetch<{ data: Array<{ id: string; name: string }> }>('/admin/ext/flows/flows')
      .then((r) => setFlows(r.data ?? [])).catch(() => setFlows([]))
  }, [needsFlows])
  const set = (k: string, v: unknown) => onChange({ ...config, [k]: v })
  const toggle = (
    <div className="flex justify-end">
      <button type="button" className="text-[11px] underline text-fg-subtle hover:text-accent" onClick={() => setJsonMode((m) => !m)}>
        {jsonMode ? '← Back to form' : 'Edit as JSON'}
      </button>
    </div>
  )
  if (jsonMode) {
    return <div className="space-y-1.5">{toggle}<JsonArea label="Config ({{tokens}} allowed)" value={config} onChange={(v) => onChange((v ?? {}) as Record<string, unknown>)} tokens={tokens} /></div>
  }
  return (
    <div className="space-y-2.5">
      {toggle}
      {fields.map((f) => {
        const v = config[f.key]
        switch (f.kind) {
          case 'json':
            return <JsonArea key={f.key} label={f.label} value={v} onChange={(nv) => set(f.key, nv)} tokens={tokens} />
          case 'textarea':
            return (
              <TokenInput key={f.key} label={f.label} value={String(v ?? '')} placeholder={f.placeholder}
                tokens={tokens} multiline mono onChange={(nv) => set(f.key, nv)} />
            )
          case 'number':
            return <Input key={f.key} label={f.label} type="number" placeholder={f.placeholder}
              value={String(v ?? '')} onChange={(e) => set(f.key, e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value))} />
          case 'select':
            return (
              <div key={f.key}>
                <Label>{f.label}</Label>
                <Select value={String(v ?? f.options?.[0]?.value ?? '')} onValueChange={(nv: string) => set(f.key, nv)}>
                  {f.options?.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </Select>
              </div>
            )
          case 'contentType':
            return (
              <div key={f.key}>
                <Label>{f.label}</Label>
                <SearchSelect value={String(v || '__none__')}
                  options={[{ value: '__none__', label: f.emptyLabel ?? 'Select…' }, ...contentTypes.map((t) => ({ value: t.name, label: t.label ?? t.name }))]}
                  onChange={(nv) => set(f.key, nv === '__none__' ? '' : nv)} />
              </div>
            )
          case 'status':
            return (
              <div key={f.key}>
                <Label>{f.label}</Label>
                <Select value={String(v || '__any__')} onValueChange={(nv: string) => set(f.key, nv === '__any__' ? undefined : nv)}>
                  <SelectItem value="__any__">Any status</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                </Select>
              </div>
            )
          case 'flowRef': {
            const known = flows.some((fl) => fl.id === v)
            return (
              <div key={f.key}>
                <Label>{f.label}</Label>
                <SearchSelect value={String(v ?? '__none__')}
                  options={[
                    { value: '__none__', label: 'Select a flow…' },
                    ...(!known && v ? [{ value: String(v), label: String(v) }] : []),
                    ...flows.filter((fl) => fl.id !== currentFlowId).map((fl) => ({ value: fl.id, label: fl.name || fl.id })),
                  ]}
                  onChange={(nv) => set(f.key, nv === '__none__' ? '' : nv)} />
                {v === currentFlowId && <Text variant="help" className="text-danger-fg">A flow can't run itself.</Text>}
              </div>
            )
          }
          case 'stringList':
            return <Input key={f.key} label={f.label} placeholder={f.placeholder}
              value={Array.isArray(v) ? v.join(', ') : String(v ?? '')}
              onChange={(e) => set(f.key, e.currentTarget.value.split(',').map((s) => s.trim()).filter(Boolean))} />
          default:
            // A URL, a recipient, an object id: every one of these is
            // routinely composed from the run, so all of them offer it.
            return <TokenInput key={f.key} label={f.label} placeholder={f.placeholder}
              value={String(v ?? '')} tokens={tokens} onChange={(nv) => set(f.key, nv)} />
        }
      })}
    </div>
  )
}

function JsonArea({ label, value, onChange, tokens }: {
  label: string; value: unknown; onChange: (v: unknown) => void
  /** Given these, the mapping takes data from the run: `{{` offers them. */
  tokens?: readonly TokenOption[]
}) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2))
  const [bad, setBad] = useState(false)
  const edit = (v: string) => {
    setText(v)
    try { onChange(JSON.parse(v)); setBad(false) } catch { setBad(true) }
  }
  // A config mapping is where a token is needed most, and a code editor
  // cannot host the offers - so when there is data to offer, the kit's field
  // draws it, and the highlighted editor stays for everything else.
  if (tokens && tokens.length > 0) {
    return (
      <div>
        <TokenInput label={label} value={text} onChange={edit} tokens={tokens} multiline mono />
        {bad && <Text variant="help" className="mt-1.5 text-danger-fg">Not valid JSON yet.</Text>}
      </div>
    )
  }
  return (
    <div>
      <Label>{label}</Label>
      <CodeEditor value={text} lang="json" maxHeight="200px" onChange={edit} />
      {bad && <Text variant="help" className="mt-1.5 text-danger-fg">Not valid JSON yet.</Text>}
    </div>
  )
}
