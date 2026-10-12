import { AdminPage, Text, Callout } from '@/kit'
import { Example, ExampleStack, useSinkCrumbs } from './example'

/**
 * Extending Tangen — the three contributions that change a workspace's content
 * (a custom field type, an editor panel, a dashboard widget) shown as copyable
 * code rather than registered live. The Kitchen Sink is a reference, so it does
 * NOT declare these in its manifest: a live field type would appear on every
 * content type, a live panel on every editor, a live widget on every dashboard
 * of any workspace that installed it. Paste a block into your own extension's
 * manifest to make it live there. See docs/extensions.md and
 * docs/custom-field-types.md.
 */
export function SinkExtendingPage() {
  return (
    <AdminPage breadcrumbs={useSinkCrumbs('Extending Tangen')}>
      <ExampleStack>

        <Callout variant="info" title="Documented, not registered">
          <Text>
            These three surfaces mutate a workspace&apos;s content, so the Kitchen Sink
            keeps them as code, not as live registrations. A field type would show on
            every content type, a panel on every editor, a widget on every dashboard.
            Copy a block into your own extension&apos;s <code className="font-mono">tangen.extension.ts</code>
            {' '}(and the matching component into its client entry) to make it live there.
          </Text>
        </Callout>

        {/* ── Custom field type ─────────────────────────────────────────── */}
        <Example
          title="Custom field type"
          description="Inherit a primitive, validate on both sides, render your own input - it joins the schema field-type picker"
          code={`// 1. tangen.extension.ts — declare it (browser-safe: strings/JSON only)
export default defineExtension({
  // …
  fieldTypes: [
    {
      name: 'credit_card',
      label: 'Credit Card',
      inherits: 'text',            // storage + baseline validation + AI shape
      icon: 'RiBankCardLine',
      description: 'A card number, Luhn-validated on client and on save.',
      ai: { enabled: false },
    },
  ],
})

// 2. src/shared/fields/credit-card/validator.ts — ONE pure validator,
//    imported by BOTH the server (authoritative) and the input (instant).
export function validateCreditCard(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\\D/g, '')
  if (digits.length === 0) return null            // presence is the platform's job
  return luhnValid(digits) ? null : 'Enter a valid card number'
}

// 3. src/server.ts — wire the authoritative validator (gates the save)
export default defineExtensionServer({
  fieldTypes: {
    credit_card: { validate: (value) => validateCreditCard(value) },
  },
})

// 4. src/index.ts (browser-safe client entry) — the admin input UI
export const fieldTypeUIs = [
  { name: 'credit_card', Input: CreditCardInput, validate: validateCreditCard },
]`}
        >
          <Text variant="help">
            Four layers, one folder: manifest declares it, a shared validator is imported by
            both runtimes so they can never drift, the server entry makes it authoritative, and
            the client entry supplies the input. The reference lives in
            {' '}<code className="font-mono">src/shared/fields/credit-card/</code>.
          </Text>
        </Example>

        {/* ── Object-editor sidebar panel ───────────────────────────────── */}
        <Example
          title="Object-editor panel"
          description="A panel beside the content fields - inline below them, or a button that opens a dialog"
          code={`// 1. tangen.extension.ts — 'component' is a NAMED EXPORT of src/index.ts
sidebarPanels: [
  { id: 'sink-notes', label: 'Scratch Notes', icon: 'IconFileText',
    component: 'ScratchNotesPanel', renderMode: 'inline' },
  { id: 'sink-tools', label: 'Sink Tools', icon: 'IconSettings',
    component: 'SinkToolsPanel', renderMode: 'modal', buttonLabel: 'Open tools' },
],

// 2. src/panels.tsx — the panel receives the editor's values + a data bridge
export function ScratchNotesPanel({ panelData, onPanelDataChange }) {
  const [note, setNote] = useState(panelData?.note ?? '')
  return (
    <textarea
      value={note}
      onChange={(e) => {
        setNote(e.target.value)
        onPanelDataChange?.({ note: e.target.value })  // staged, saved with the object
      }}
    />
  )
}

// 3. src/server.ts — persist it in your afterChange hook, keyed by extension id
hooks: {
  afterChange: async (ctx) => {
    const staged = ctx.panelData['kitchen-sink']
    if (staged) await ctx.extensionData.set(ctx.objectId, staged)
  },
}`}
        >
          <Text variant="help">
            <code className="font-mono">renderMode: 'inline'</code> renders below the content fields on every type;
            {' '}<code className="font-mono">'modal'</code> renders a card and button that opens the component in a dialog.
            Staged data round-trips through <code className="font-mono">ctx.extensionData</code> and is versioned with revisions
            when the manifest sets <code className="font-mono">versionedData: true</code>.
          </Text>
        </Example>

        {/* ── Dashboard widget ──────────────────────────────────────────── */}
        <Example
          title="Dashboard widget"
          description="A home-dashboard card fed by a data path your server owns - gate it per role with viewPermission"
          code={`// 1. tangen.extension.ts — dataPath is fetched with admin auth
dashboardWidgets: [
  {
    id: 'sink-activity',
    title: 'Kitchen Sink activity',
    description: "Content changes observed by the extension's hooks",
    icon: 'IconSparkles',
    type: 'stat',
    dataPath: '/extensions/kitchen-sink/widget-data',
    // Who may see the DATA - the SAME access rule a page uses, so gating reads
    // the same everywhere. Owner/admin always pass; a listed role or a held
    // capability passes; omitting it means everyone. A member who fails still
    // sees the card, as a "No rights to view" placeholder - the fetch never
    // runs for them.
    viewPermission: { roles: ['owner', 'admin', 'editor'] },
  },
],

// 2. src/server.ts — the route that returns the widget's data
routes: [
  {
    path: '/widget-data',
    handler: async (ctx) => {
      const count = (await ctx.extensionData.get('__widget__'))?.changes ?? 0
      return { value: count, label: 'content changes' }
    },
  },
],`}
        >
          <Text variant="help">
            <code className="font-mono">viewPermission</code> takes the same access rule a page&apos;s
            {' '}<code className="font-mono">access</code> uses - <code className="font-mono">{'{ roles?, capability? }'}</code> -
            so gating reads the same everywhere. A member who fails it still sees the card, as a
            {' '}&quot;No rights to view&quot; placeholder, and the dashboard itself never shows a
            permission error. Omit it to show the widget to all roles.
          </Text>
        </Example>

        {/* ── Permissions (RBAC) ────────────────────────────────────────── */}
        <Example
          title="Permissions (read / write / delete)"
          description="Declare the resources your extension governs; each action becomes a capability in the roles tree"
          code={`// 1. tangen.extension.ts — declare RESOURCES x ACTIONS
permissions: {
  resources: [
    { id: 'notes', label: 'Scratch notes', actions: ['read', 'write', 'delete'] },
    // A custom action gives its own { id, label }:
    { id: 'tools', label: 'Sink tools', actions: ['read', { id: 'run', label: 'Run a tool' }] },
  ],
}

// This compiles to capabilities read:notes / write:notes / delete:notes with
// standard labels and implications (write & delete imply read). They show in
// the roles editor's permission tree as Read / Write / Delete under your
// extension, and on a member's access page.

// 2. src/server.ts — gate your routes on them
routes: [
  { path: '/notes',        capability: 'read:notes',   handler: listNotes },
  { path: '/notes',        method: 'POST', capability: 'write:notes',  handler: saveNote },
  { path: '/notes/:id',    method: 'DELETE', capability: 'delete:notes', handler: deleteNote },
]

// Or inside a handler: if (!ctx.can('write:notes')) return ctx.forbidden()`}
        >
          <Text variant="help">
            The read/write/delete split only exists if you declare it. Ship
            {' '}<code className="font-mono">read:</code> alongside any{' '}
            <code className="font-mono">write:</code>/<code className="font-mono">manage:</code>/<code className="font-mono">delete:</code>{' '}
            so a role can be granted read-only. <code className="font-mono">tangen doctor --deployment</code> nudges
            you when a write capability has no read counterpart. Declaring permissions adds role options
            only - it never touches content.
          </Text>
        </Example>

      </ExampleStack>
    </AdminPage>
  )
}
