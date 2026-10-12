import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate, Outlet, useParams, useSearchParams } from 'react-router-dom'
import { NotFound } from '@/components/not-found'
import { ADMIN_EXTENSION } from 'virtual:tangen/app-ui-registry'
import { EXTENSION_PAGES } from 'virtual:tangen/extension-panels'
import { RequirePermission } from '@/components/require-permission'
import { ExtensionPageGate } from '@/components/extension-page-gate'
import { RuntimeExtensionPage } from '@/components/runtime-extension-page'
import { extensionPageRoutePath } from '@/lib/extension-pages'
import { ProtectedRoute } from './components/protected-route'
import { Root } from './root'
import { RouteError } from '@/components/route-error'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
const L = <P extends object = {}>(factory: () => Promise<{ default: React.ComponentType<P> }>) => {
  const C = lazy(factory) as unknown as React.ComponentType<P>
  return (props: P) => <Suspense fallback={null}><C {...props} /></Suspense>
}

// ── Auth pages ─────────────────────────────────────────────────────────────
const LoginPage      = L(() => import('@/app/(auth)/login/page'))
const WorkspacesPage = L(() => import('@/app/workspaces/page'))
const WorkspaceSetupPage = L(() => import('@/app/[workspaceId]/setup/page'))
const WorkspaceLoginPage = L(() => import('@/app/[workspaceId]/login/page'))

// ── Workspace layout + pages ────────────────────────────────────────────────
const WorkspaceLayout = L(() => import('@/src/layouts/workspace-layout'))

const DashboardPage         = L(() => import('@/app/[workspaceId]/dashboard/page'))
const ObjectsIndexPage      = L(() => import('@/app/[workspaceId]/objects/page'))
const ObjectListPage        = L(() => import('@/app/[workspaceId]/objects/[typeName]/page'))
const ObjectBulkEditPage    = L(() => import('@/app/[workspaceId]/objects/[typeName]/bulk-edit/page'))
const ObjectDetailPage      = L(() => import('@/app/[workspaceId]/objects/[typeName]/[id]/page'))

const MediaPage       = L(() => import('@/app/[workspaceId]/media/page'))
const ProfilePage     = L(() => import('@/app/[workspaceId]/settings/profile/page'))
const PreferencesPage = L(() => import('@/app/[workspaceId]/settings/preferences/page'))
// The account lives under Settings > User (2026-09-07); the old /profile URL redirects.
function RedirectToSettingsProfile() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  return <Navigate to={`/${workspaceId}/settings/profile`} replace />
}
const SchemaPage      = L(() => import('@/app/[workspaceId]/schema/page'))
const SchemaBuilderNewPage = L(() => import('@/app/[workspaceId]/schema/new/page'))
const SchemaBuilderEditPage = L(() => import('@/app/[workspaceId]/schema/[typeName]/edit/page'))
const NewComponentPage = L(() => import('@/app/[workspaceId]/schema/components/new/page'))
const EditComponentPage = L(() => import('@/app/[workspaceId]/schema/components/[name]/edit/page'))
const SchemaReviewPage = L(() => import('@/app/[workspaceId]/schema/review/page'))
const NewGlobalPage = L(() => import('@/app/[workspaceId]/schema/globals/new/page'))
const EditGlobalPage = L(() => import('@/app/[workspaceId]/schema/globals/[name]/edit/page'))
const ReleasesPage    = L(() => import('@/app/[workspaceId]/releases/page'))
const ReleaseDiffPage = L(() => import('@/app/[workspaceId]/releases/[id]/diff/page'))

const SettingsOverviewPage   = L(() => import('@/app/[workspaceId]/settings/page'))
const ApiKeysPage           = L(() => import('@/app/[workspaceId]/settings/api-keys/page'))
const NewApiKeyPage          = L(() => import('@/app/[workspaceId]/settings/api-keys/new/page'))
const ApiKeyDetailPage       = L(() => import('@/app/[workspaceId]/settings/api-keys/[id]/page'))
const MembersPage            = L(() => import('@/app/[workspaceId]/settings/members/page'))
const RolePage               = L(() => import('@/app/[workspaceId]/settings/members/roles/[slug]/page'))
const MemberPage             = L(() => import('@/app/[workspaceId]/settings/members/[id]/page'))
const WebhooksPage           = L(() => import('@/app/[workspaceId]/settings/webhooks/page'))
const NewWebhookPage         = L(() => import('@/app/[workspaceId]/settings/webhooks/new/page'))
const EditWebhookPage        = L(() => import('@/app/[workspaceId]/settings/webhooks/[webhookId]/edit/page'))
const WebhookLogsPage        = L(() => import('@/app/[workspaceId]/settings/webhooks/[webhookId]/logs/page'))
const JobsSettingsPage       = L(() => import('@/app/[workspaceId]/settings/jobs/page'))
const ConnectionsPage        = L(() => import('@/app/[workspaceId]/settings/connections/page'))
const ExtensionsSettingsPage = L(() => import('@/app/[workspaceId]/settings/extensions/page'))
const ExtensionSettingsPage  = L(() => import('@/app/[workspaceId]/settings/extensions/[extensionId]/page'))
// The Devspace overview is gone (2026-09-12): its URL lands on Schema, the first Devspace page.
function RedirectDevspaceToSchema() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  return <Navigate to={`/${workspaceId}/schema`} replace />
}
// PG-1: GraphQL merged into the API Playground takeover — old URL redirects.
function RedirectToPlaygroundGraphql() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  return <Navigate to={`/${workspaceId}/devspace/playground?tab=graphql`} replace />
}
const ExtensionOverviewPage  = L(() => import('@/app/[workspaceId]/extensions/[extensionId]/page'))
const AiKnowledgePage        = L(() => import('@/app/[workspaceId]/ai/knowledge/page'))
const AiQaPage               = L(() => import('@/app/[workspaceId]/ai/qa/page'))
const AiInsightsPage         = L(() => import('@/app/[workspaceId]/ai/insights/page'))
const AiAgentsPage           = L(() => import('@/app/[workspaceId]/ai/agents/page'))
const GlobalsPage            = L(() => import('@/app/[workspaceId]/globals/page'))
// Globals are content (2026-09-07): they live under Content at /globals; the old Settings URL redirects.
function RedirectToGlobals() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  return <Navigate to={`/${workspaceId}/globals`} replace />
}
const AiSettingsPage         = L(() => import('@/app/[workspaceId]/settings/ai/page'))
// Content-AI providers now live under Settings → AI; old AI-section links redirect.
function RedirectToSettingsAi() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  return <Navigate to={`/${workspaceId}/settings/ai`} replace />
}
function RedirectAiToKnowledge() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  return <Navigate to={`/${workspaceId}/ai/knowledge`} replace />
}
const CachePage              = L(() => import('@/app/[workspaceId]/settings/cache/page'))
const SearchSettingsPage     = L(() => import('@/app/[workspaceId]/settings/search/page'))
function RedirectToSettingsSearch() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  return <Navigate to={`/${workspaceId}/settings/search`} replace />
}
const ApiPlaygroundPage      = L(() => import('@/app/[workspaceId]/devspace/playground/page'))
const QueryMonitorPage       = L(() => import('@/app/[workspaceId]/devspace/query-monitor/page'))
const TelemetryPage          = L(() => import('@/app/[workspaceId]/devspace/telemetry/page'))
function RedirectToDevspacePlayground() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [sp] = useSearchParams()
  const qs = sp.toString()
  return <Navigate to={`/${workspaceId}/devspace/playground${qs ? `?${qs}` : ''}`} replace />
}
const WorkspaceSettingsPage  = L(() => import('@/app/[workspaceId]/settings/workspace/page'))
const ConfigSettingsPage = L(() => import('@/app/[workspaceId]/settings/config/page'))



const SettingsLayout = L(() => import('@/app/[workspaceId]/settings/layout'))

// Protected shell: ProtectedRoute wraps the workspace layout via Outlet
function ProtectedShell() {
  return <ProtectedRoute><Outlet /></ProtectedRoute>
}

// Forces pages to remount when URL segments change so loading state resets
function ObjectListPageWrapper() {
  const { typeName } = useParams()
  return <ObjectListPage key={typeName} />
}

function ObjectDetailPageWrapper() {
  // No per-object key: the editor switches documents IN PLACE (its load effect
  // is keyed on params.id/typeName and resets per-object state), so following a
  // preview link doesn't remount the whole editor + iframe (which read as a
  // full-page reload). See objects/[typeName]/[id]/page.tsx.
  return <ObjectDetailPage />
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    // Any render/loader throw in a descendant route lands here instead of
    // white-screening the whole admin (e.g. a malformed schema crashing a page).
    errorElement: <RouteError />,
    children: [
  { path: '/login', element: <LoginPage /> },
  // These workspace-level routes use literals that take priority over /:workspaceId/:env
  // and are outside ProtectedShell — no existing auth required
  { path: '/:workspaceId/setup', element: <WorkspaceSetupPage /> },
  { path: '/:workspaceId/login', element: <WorkspaceLoginPage /> },
  {
    element: <ProtectedShell />,
    children: [
      { path: '/', element: <Navigate to="/workspaces" replace /> },
      { path: '/workspaces', element: <WorkspacesPage /> },
      {
        path: '/:workspaceId',
        element: <WorkspaceLayout />,
        children: [
          { index: true, element: <Navigate to="dashboard" replace /> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'objects', element: <ObjectsIndexPage /> },
          { path: 'objects/:typeName', element: <ObjectListPageWrapper /> },
          { path: 'objects/:typeName/bulk-edit', element: <ObjectBulkEditPage /> },
          { path: 'objects/:typeName/:id', element: <ObjectDetailPageWrapper /> },
          { path: 'media', element: <MediaPage /> },
          { path: 'globals', element: <GlobalsPage /> },
          { path: 'profile', element: <RedirectToSettingsProfile /> },
          { path: 'ai', element: <RedirectAiToKnowledge /> },
          { path: 'ai/providers', element: <RedirectToSettingsAi /> },
          { path: 'ai/knowledge', element: <AiKnowledgePage /> },
          { path: 'ai/qa', element: <AiQaPage /> },
          { path: 'ai/insights', element: <AiInsightsPage /> },
          { path: 'search', element: <RedirectToSettingsSearch /> },
          { path: 'search/*', element: <RedirectToSettingsSearch /> },
          { path: 'ai/agents', element: <AiAgentsPage /> },
          { path: 'devspace', element: <RedirectDevspaceToSchema /> },
          { path: 'devspace/playground', element: <ApiPlaygroundPage /> },
          { path: 'devspace/query-monitor', element: <QueryMonitorPage /> },
          { path: 'devspace/telemetry', element: <TelemetryPage /> },
          { path: 'devspace/graphql', element: <RedirectToPlaygroundGraphql /> },
          { path: 'schema', element: <SchemaPage /> },
          { path: 'schema/new', element: <SchemaBuilderNewPage /> },
          { path: 'schema/components/new', element: <NewComponentPage /> },
          { path: 'schema/components/:name/edit', element: <EditComponentPage /> },
          { path: 'schema/review', element: <SchemaReviewPage /> },
          { path: 'schema/globals/new', element: <NewGlobalPage /> },
          { path: 'schema/globals/:name/edit', element: <EditGlobalPage /> },
          { path: 'schema/:typeName/edit', element: <SchemaBuilderEditPage /> },
          { path: 'releases', element: <ReleasesPage /> },
          { path: 'releases/:id/diff', element: <ReleaseDiffPage /> },
          {
            path: 'settings',
            element: <SettingsLayout />,
            children: [
              { index: true, element: <SettingsOverviewPage /> },
              { path: 'profile', element: <ProfilePage /> },
              { path: 'preferences', element: <PreferencesPage /> },
              { path: 'api-keys', element: <ApiKeysPage /> },
              { path: 'api-keys/new', element: <NewApiKeyPage /> },
              { path: 'api-keys/:id', element: <ApiKeyDetailPage /> },
              { path: 'members', element: <MembersPage /> },
              { path: 'members/roles/:slug', element: <RolePage /> },
              { path: 'members/:id', element: <MemberPage /> },
              { path: 'webhooks', element: <WebhooksPage /> },
              { path: 'webhooks/new', element: <NewWebhookPage /> },
              { path: 'webhooks/:webhookId/edit', element: <EditWebhookPage /> },
              { path: 'webhooks/:webhookId/logs', element: <WebhookLogsPage /> },
              { path: 'jobs', element: <JobsSettingsPage view="schedules" /> },
              { path: 'jobs/runs', element: <JobsSettingsPage view="runs" /> },
              { path: 'globals', element: <RedirectToGlobals /> },   // moved under Content
              { path: 'ai', element: <AiSettingsPage /> },   // content-AI providers live here now
              { path: 'cache', element: <CachePage /> },
              { path: 'search', element: <SearchSettingsPage /> },
              { path: 'connections', element: <ConnectionsPage /> },
              { path: 'extensions', element: <ExtensionsSettingsPage /> },   // K7.1 / E.17: every declaring extension's generated settings form
              { path: 'extensions/:extensionId', element: <ExtensionSettingsPage /> },
              { path: 'playground', element: <RedirectToDevspacePlayground /> },  // moved to Devspace
              { path: 'config', element: <ConfigSettingsPage /> },
              { path: 'workspace', element: <WorkspaceSettingsPage /> },
            ],
          },
          // ── Site developer extension pages ───────────────────────────────
          // Components may be React.lazy wrappers when the site uses the
          // app/admin/pages.ts convention — render them under Suspense.
          ...(ADMIN_EXTENSION.routes ?? []).map(r => ({
            path: r.path,
            element: (
              <RequirePermission access={r.access}>
                <Suspense fallback={null}><r.component /></Suspense>
              </RequirePermission>
            ),
          })),
          // ── Package extension pages (manifest `pages:`) — gated on the
          //    extension being installed + active in the workspace ──────────
          ...Object.entries(EXTENSION_PAGES).flatMap(([extId, pages]) => pages.map(p => ({
            path: extensionPageRoutePath(extId, p.path),
            element: (
              <ExtensionPageGate extensionId={extId} access={p.access}>
                <Suspense fallback={null}><p.component /></Suspense>
              </ExtensionPageGate>
            ),
          }))),
          // ── Installed extension pages loaded at runtime (K7.3): the static
          //    build-time routes above win when both exist ──────────────────
          { path: 'extensions/:extensionId/*', element: <RuntimeExtensionPage /> },
          // Default extension landing page — matches any single-segment
          // /extensions/<id> not claimed by an explicit route above (React
          // Router ranks static paths over this param), so a field-type /
          // panel extension like SEO always has a real screen.
          { path: 'extensions/:extensionId', element: <ExtensionOverviewPage /> },
          // An unknown page INSIDE a workspace keeps the shell, so the user
          // stays where they were and can see it was the address that was
          // wrong (Phase 8B, finding 8B-1).
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
  // Outside a workspace there is no shell to keep, but there is still no
  // reason to teleport someone without telling them.
  { path: '*', element: <NotFound /> },
    ],
  },
])
