/**
 * File Name: extension-create.ts
 * Purpose: Implements the `tangen extension create` command, which scaffolds a complete
 *   Tangen extension package including manifest, React panel component, and README.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure file-generation functions (testable without I/O); the command
 *   runner uses Node `fs`; interactive prompt uses Node `readline`.
 */
import { join } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'

export interface ExtensionScaffoldOptions {
  id: string
  name: string
  description: string
  author: string
  website: string
  version: string
}

// ── ID derivation ─────────────────────────────────────────────────────────────

/**
 * Derives a URL-safe, kebab-case extension ID from a human-readable name.
 * @param name - The display name entered by the developer (e.g. "My Cool Extension")
 * @returns A normalised kebab-case ID (e.g. `my-cool-extension`)
 */
export function deriveExtensionId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// ── Component name (PascalCase) ───────────────────────────────────────────────

function toPascalCase(id: string): string {
  return id
    .split('-')
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('')
}

// ── File generators ───────────────────────────────────────────────────────────

/**
 * Generates the `tangen.extension.ts` manifest file content for a new extension.
 * @param opts - Extension scaffold options (id, name, version, description)
 * @returns TypeScript source string for the extension manifest
 */
export function scaffoldExtensionManifest(opts: ExtensionScaffoldOptions): string {
  const panelId = `${opts.id}-panel`
  const comp = `${toPascalCase(opts.id)}Panel`
  return `import { defineExtension } from '@tangen/cms'

/**
 * The single authoritative manifest. Must stay BROWSER-SAFE: no function
 * values, no server imports — the admin build bundles this file. Server
 * contributions (hooks, install/uninstall) live in the server entry below.
 */
export default defineExtension({
  id: '${opts.id}',
  name: '${opts.name}',
  version: '${opts.version}',
  description: '${opts.description}',
  // The framework contract this extension is written against: every server
  // surface receives an execution (ctx.exec) and a content client bound to
  // the caller (ctx.tangen), routes may declare \`access\`, capabilities may
  // open platform \`gates\`. See docs.tangen.app/reference/public-contract.
  contract: 1,
  server: './src/server.ts',
  // Ledgered SQL migrations, run at install and upgrade - never at runtime
  // (docs/architecture/extension-lifecycle.md). Empty until you need a table.
  migrations: './src/migrations.ts',
  // What must be there for this extension to be active in an environment.
  // requires: { capabilities: ['media'], extensions: [{ id: 'review', version: '^1' }] },
  // optional: { extensions: ['flows'] },
  // The install options this extension understands (validated at install and upgrade).
  config: {
    // apiKey: { type: 'string', secret: true, required: true, label: 'API key' },
  },
  // Environment variable NAMES the server entry reads; never values.
  secrets: [],
  // RBAC capabilities this extension defines (scope:name). They appear in the
  // roles editor where the extension is installed; routes and pages gate on them.
  capabilities: [
    { id: '${opts.id.replace(/[^a-z0-9]+/g, '-')}:read', label: 'View ${opts.name}' },
    { id: '${opts.id.replace(/[^a-z0-9]+/g, '-')}:manage', label: 'Manage ${opts.name}', implies: ['${opts.id.replace(/[^a-z0-9]+/g, '-')}:read'] },
  ],
  // A full Admin page (a named export of src/index.ts), linked from the sidebar.
  // pages: [{ path: '', component: '${toPascalCase(opts.id)}Page', nav: { label: '${opts.name}', icon: 'IconPuzzle' }, access: { capability: '${opts.id.replace(/[^a-z0-9]+/g, '-')}:read' } }],
  sidebarPanels: [
    {
      id: '${panelId}',
      label: '${opts.name}',
      icon: 'RiPuzzle2Line',
      // Named export of src/index.ts (resolved by the admin build)
      component: '${comp}',
    },
  ],
})
`
}

/** Generates the server entry — hooks + install/uninstall lifecycle. */
export function scaffoldExtensionServer(opts: ExtensionScaffoldOptions): string {
  return `import { defineExtensionServer } from '@tangen/cms'

/**
 * Server-side contributions — referenced from tangen.extension.ts as
 * server: './src/server.ts'. Content hooks fire for workspaces where this
 * extension is installed; onInstall/onUninstall run on
 * \`tangen extension install/uninstall\` and admin installs.
 */
export default defineExtensionServer({
  // ── Routes ──────────────────────────────────────────────────────────────
  // Mounted at /api/v1/admin/ext/${opts.id}/<path> for member sessions
  // (auth 'key' and 'public' mount under /api/v1/ext/). \`access\` is decided on
  // the server before the handler runs. ctx.tangen is BOUND to the caller: it
  // does what this member may, never more - a viewer cannot create through it,
  // and every write is attributed to the member, hooked, revisioned and
  // recorded like an edit in the editor. ctx.exec is who is asking.
  adminRoutes: [
    {
      method: 'GET',
      path: 'status',
      auth: 'member',
      access: { capability: '${opts.id.replace(/[^a-z0-9]+/g, '-')}:read' },
      handler: async (_req, ctx) => ({
        extension: '${opts.id}',
        actor: ctx.exec ? { kind: ctx.exec.actor.identity.kind, id: ctx.exec.actor.identity.id } : null,
        // Example of a caller-bound read: replace 'page' with a type of yours.
        // pages: (await ctx.tangen.objects('page').limit(5).get()).data.length,
      }),
    },
  ],

  // contentHooks: {
  //   afterChange(ctx) { /* sync, index, notify… */ },
  // },

  // ── Lifecycle (docs/architecture/extension-lifecycle.md) ────────────────
  // INSTALL: non-schema setup after the migrations applied (validate options,
  // warm a resource). Schema belongs in src/migrations.ts.
  onInstall({ workspaceId, env }) {
    console.log('[${opts.id}] installed into', workspaceId, env)
  },
  // START: once per workspace x environment where the extension is active.
  // Start timers, subscribers, connections HERE - never at import. Return the
  // cleanup; it runs at STOP.
  onStart(ctx) {
    // const timer = setInterval(() => poll(ctx), 60_000)
    // return () => clearInterval(timer)
    ctx.log('started')
  },
  onStop(ctx) {
    ctx.log('stopped')
  },
  // UPGRADE: non-schema work after the pending migrations applied (re-index,
  // migrate stored options). Not a schema escape hatch.
  onUpgrade(ctx, { from, to }) {
    ctx.log(\`upgraded \${from ?? 'unknown'} -> \${to}\`)
  },
  // UNINSTALL retains the extension's data; this hook is advisory.
  onUninstall({ workspaceId, env }) {
    console.log('[${opts.id}] uninstalled from', workspaceId, env)
  },
})
`
}

/** Generates the migrations module: ledgered SQL, run at install and upgrade. */
export function scaffoldExtensionMigrations(opts: ExtensionScaffoldOptions): string {
  return `import type { ExtensionMigration } from '@tangen/cms'

/**
 * Ledgered SQL migrations (docs/architecture/extension-lifecycle.md).
 * Applied in this order at \`tangen extension install\` and \`upgrade\`, each
 * in its own transaction with a checksum in extension_migrations; never at
 * import, register, enable or start. Rules: never edit or reorder one that
 * ran (add a new one); write idempotently (IF NOT EXISTS), because a
 * migration runs once per workspace x environment while tables are
 * shared; prefix your tables with \`${opts.id.replace(/[^a-z0-9]+/g, '_')}_\` and scope rows by
 * workspace_id so a purge can find them.
 */
const migrations: ExtensionMigration[] = [
  // {
  //   id: '0001_create_records',
  //   sql: \`CREATE TABLE IF NOT EXISTS ${opts.id.replace(/[^a-z0-9]+/g, '_')}_records (
  //     id text PRIMARY KEY, workspace_id text NOT NULL, data jsonb NOT NULL DEFAULT '{}'
  //   )\`,
  // },
]

export default migrations
`
}

/** Generates a starter test file for the extension. */
export function scaffoldExtensionTest(opts: ExtensionScaffoldOptions): string {
  return `import { describe, it, expect } from 'bun:test'
import { validateExtensionManifest } from '@tangen/cms'
import manifest from '../tangen.extension'
import migrations from '../src/migrations'

describe('${opts.id} manifest', () => {
  it('is browser-safe and complete', () => {
    expect(manifest.id).toBe('${opts.id}')
    expect(manifest.server).toBe('./src/server.ts')
    // No function values allowed on the manifest (admin bundles it)
    for (const v of Object.values(manifest)) {
      expect(typeof v).not.toBe('function')
    }
  })
  it('meets the v1 contract', () => {
    const r = validateExtensionManifest(manifest)
    expect(r.errors).toEqual([])
    expect(Array.isArray(migrations)).toBe(true)
  })
  it('is written against framework contract 1', () => {
    expect(manifest.contract).toBe(1)
  })
})
`
}

/**
 * Generates the `package.json` content for a new extension package.
 * @param opts - Extension scaffold options (id, version, description, author, website)
 * @returns Serialised JSON string for the extension's package.json
 */
export function scaffoldExtensionPackageJson(opts: ExtensionScaffoldOptions): string {
  const pkg: Record<string, unknown> = {
    name: `@tangen/ext-${opts.id}`,
    version: opts.version,
    description: opts.description,
    author: opts.author,
    private: true,
    main: './src/index.ts',
    types: './src/index.ts',
    exports: {
      '.': './src/index.ts',
      './server': './src/server.ts',
    },
    scripts: { test: 'bun test' },
    peerDependencies: {
      '@tangen/cms': '*',
      react: '*',
    },
    devDependencies: {
      '@tangen/cms': '*',
      '@types/react': '^18.3.3',
      'bun-types': '^1.1.0',
      react: '^18.3.1',
    },
  }
  if (opts.website) pkg.homepage = opts.website
  return JSON.stringify(pkg, null, 2) + '\n'
}

/**
 * Generates a `tsconfig.json` suitable for a Tangen extension package.
 * @returns Serialised JSON string for the extension's TypeScript configuration
 */
export function scaffoldExtensionTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ESNext',
        lib: ['ESNext', 'DOM'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ['src', 'tangen.extension.ts'],
    },
    null,
    2,
  ) + '\n'
}

/**
 * Generates the `src/index.ts` barrel that re-exports the panel component and its props type.
 * @param opts - Extension scaffold options used to derive the component name
 * @returns TypeScript source string for the extension's public entry point
 */
export function scaffoldExtensionSrcIndex(opts: ExtensionScaffoldOptions): string {
  const comp = `${toPascalCase(opts.id)}Panel`
  return `// Client entry - panel components exported by NAME (manifest component refs)
export { ${comp} } from './admin/panels/${comp}'
export type { ExtensionPanelProps } from './admin/panels/${comp}'
`
}

/**
 * Generates a placeholder React sidebar panel component for the extension.
 * @param opts - Extension scaffold options used to derive the component name and display name
 * @returns TSX source string for the panel component file
 */
export function scaffoldExtensionPanel(opts: ExtensionScaffoldOptions): string {
  const comp = `${toPascalCase(opts.id)}Panel`
  return `'use client'

/**
 * The props the Admin hands every sidebar panel (ExtensionPanelProps):
 *   title / content / fieldValues   the object's current values, read-only
 *   objectId, status                 '' and 'draft' while the editor is on /new
 *   panelData / onPanelDataChange    data persisted with the object: stage it
 *                                    here, it is saved with the NEXT save and
 *                                    reaches your afterChange hook as
 *                                    ctx.panelData['<panel-id>']
 *   refresh                          re-runs the editor's object load
 *   ai                               the Content AI bridge, when enabled
 */
export interface ExtensionPanelProps {
  title?: string
  content?: string
  fieldValues?: Record<string, unknown>
  objectId?: string
  status?: string
  refresh?: () => void
  panelData?: Record<string, unknown>
  onPanelDataChange?: (data: Record<string, unknown>) => void
}

/**
 * ${opts.name} sidebar panel, rendered in the object editor. Use the Admin's
 * semantic tokens (text-fg, text-fg-muted, border-border, bg-surface-sunken)
 * so it follows the theme; never a raw palette class.
 */
export function ${comp}({ title, status, panelData, onPanelDataChange }: ExtensionPanelProps) {
  const note = typeof panelData?.note === 'string' ? panelData.note : ''
  return (
    <section className="space-y-3 text-sm text-fg">
      <p className="text-xs text-fg-muted">
        ${opts.name} sees the object being edited: <span className="text-fg">{title || 'untitled'}</span> ({status ?? 'draft'}).
      </p>
      <label className="block text-xs text-fg-muted">
        A note saved with the object
        <textarea
          className="mt-1 w-full rounded-md border border-border bg-surface-sunken p-2 text-sm text-fg"
          rows={3}
          value={note}
          onChange={(e) => onPanelDataChange?.({ ...(panelData ?? {}), note: e.target.value })}
        />
      </label>
    </section>
  )
}
`
}

/**
 * Generates the `README.md` content for a new extension package.
 * @param opts - Extension scaffold options (id, name, description, author, website)
 * @returns Markdown string for the extension's README file
 */
export function scaffoldExtensionReadme(opts: ExtensionScaffoldOptions): string {
  const pkg = `@tangen/ext-${opts.id}`
  return `# ${opts.name} - Tangen Extension

> ${opts.description}

## Lifecycle

\`\`\`bash
tangen extension install ${opts.id}    # row + migrations + onInstall
tangen extension disable ${opts.id}    # contributions stop; data stays
tangen extension enable ${opts.id}
tangen extension upgrade ${opts.id}    # after bumping version: pending migrations + onUpgrade
tangen extension uninstall ${opts.id}  # retires the row; data is retained
tangen purge extension ${opts.id} --approve purge-extension:${opts.id}
tangen extension status                # why it is or is not active
\`\`\`

Each command acts on one environment. The **${opts.name}** panel appears in
the object editor sidebar where the extension is installed and enabled.
See docs/architecture/extension-lifecycle.md for the contract.

## What the scaffold demonstrates

- \`contract: 1\` on the manifest: every server surface receives an execution
  (\`ctx.exec\`) and a content client bound to the caller (\`ctx.tangen\`).
- A member route (\`GET /api/v1/admin/ext/${opts.id}/status\`) gated by
  \`access: { capability }\`, decided on the server before the handler runs.
- Two capabilities the roles editor can grant, and a commented Admin page.
- A sidebar panel on the Admin's semantic tokens that stages data saved with
  the object (\`panelData\`).

## Development

\`\`\`bash
bun install
bun test
\`\`\`

## Structure

\`\`\`
extensions/${opts.id}/
  tangen.extension.ts    # Extension manifest (id, name, version, panels)
  src/
    index.ts             # Public exports
    server.ts            # Server entry: hooks, routes, onInstall / onStart / onStop / onUpgrade
    migrations.ts        # Ledgered SQL migrations (install / upgrade)
    components/
      ${toPascalCase(opts.id)}Panel.tsx   # Sidebar panel component
  package.json
  tsconfig.json
\`\`\`

## Author

${opts.author}${opts.website ? `  \n${opts.website}` : ''}
`
}

// ── Command ───────────────────────────────────────────────────────────────────

/**
 * Writes all scaffolded extension files to `extensionsDir/<opts.id>/`.
 * Throws if the extension directory already exists to prevent accidental overwrites.
 * @param opts - Extension scaffold options (id, name, description, author, website, version)
 * @param extensionsDir - Absolute path to the parent `extensions/` directory
 * @param log - Optional logger; defaults to `console.log`
 */
export async function runExtensionCreateCommand(
  opts: ExtensionScaffoldOptions,
  extensionsDir: string,
  log: (msg: string) => void = console.log,
): Promise<void> {
  const extDir = join(extensionsDir, opts.id)
  if (existsSync(extDir)) {
    throw new Error(`Extension '${opts.id}' already exists at ${extDir}`)
  }

  const comp = `${toPascalCase(opts.id)}Panel`
  const files: Array<[string, string]> = [
    [join(extDir, 'package.json'), scaffoldExtensionPackageJson(opts)],
    [join(extDir, 'tangen.extension.ts'), scaffoldExtensionManifest(opts)],
    [join(extDir, 'tsconfig.json'), scaffoldExtensionTsConfig()],
    [join(extDir, 'src', 'index.ts'), scaffoldExtensionSrcIndex(opts)],
    [join(extDir, 'src', 'server.ts'), scaffoldExtensionServer(opts)],
    [join(extDir, 'src', 'migrations.ts'), scaffoldExtensionMigrations(opts)],
    [join(extDir, 'src', 'admin', 'panels', `${comp}.tsx`), scaffoldExtensionPanel(opts)],
    [join(extDir, '__tests__', 'manifest.test.ts'), scaffoldExtensionTest(opts)],
    [join(extDir, 'README.md'), scaffoldExtensionReadme(opts)],
  ]

  for (const [filePath, content] of files) {
    mkdirSync(join(filePath, '..'), { recursive: true })
    writeFileSync(filePath, content, 'utf8')
    log(`  ✓ ${filePath.replace(extensionsDir + '/', '')}`)
  }
}

// ── Interactive prompt ────────────────────────────────────────────────────────

/**
 * Interactively prompts the developer for extension details via stdin (readline).
 * @returns Resolved `ExtensionScaffoldOptions` populated with the developer's answers
 */
export async function promptForExtensionDetails(): Promise<ExtensionScaffoldOptions> {
  const { createInterface } = await import('readline')
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  function ask(question: string, defaultValue = ''): Promise<string> {
    return new Promise((resolve) => {
      const hint = defaultValue ? ` (${defaultValue})` : ''
      rl.question(`  ${question}${hint}: `, (answer) => {
        resolve(answer.trim() || defaultValue)
      })
    })
  }

  console.log('\n  Tangen Extension Creator\n  ─────────────────────────\n')

  const name = await ask('Extension name', 'My Extension')
  const derivedId = deriveExtensionId(name)
  const id = await ask('Extension ID', derivedId)
  const description = await ask('Description', `A Tangen extension`)
  const author = await ask('Author', '')
  const website = await ask('Website (optional)', '')

  rl.close()

  return { id, name, description, author, website, version: '0.1.0' }
}

/**
 * Idempotently appends `{ resolve: '../../extensions/<id>' }` (or the given
 * specifier, for a package: `@tangen/ext-<id>`) to app/config/extensions.ts
 * so the extension is declared on next boot. Returns true when the file was
 * changed.
 */
export function registerExtensionInConfig(configPath: string, extensionId: string, resolveLiteral = `../../extensions/${extensionId}`): boolean {
  if (!existsSync(configPath)) return false
  const src = readFileSync(configPath, 'utf8')
  if (src.includes(resolveLiteral)) return false
  const marker = 'defineExtensions(['
  const idx = src.indexOf(marker)
  if (idx === -1) return false
  const insertAt = idx + marker.length
  const entry = `\n  { resolve: '${resolveLiteral}' },`
  writeFileSync(configPath, src.slice(0, insertAt) + entry + src.slice(insertAt), 'utf8')
  return true
}
