/**
 * Browser-safe client entry. Every component the manifest names — sidebar
 * panel `component`s and page `component`s — must be a NAMED EXPORT of this
 * file; the admin build resolves them statically. Keep this file free of
 * server imports (db, node APIs, secrets).
 */
import { creditCardFieldUI } from './shared/fields/credit-card'

/**
 * Custom field type admin UIs contributed by this extension. The field-type-ui
 * build plugin collects this array into the editor's input registry, keyed by
 * `name` (must match a manifest `fieldTypes[].name`). Each descriptor is
 * `{ name, Input, validate? }`; `validate` is instant, non-authoritative feedback
 * that mirrors the server validator (both call the shared ./shared/fields validator).
 */
export const fieldTypeUIs = [creditCardFieldUI]

export { ScratchNotesPanel, SinkToolsPanel } from './panels'
export { SinkOverviewPage } from './pages/overview'
export { SinkLightfieldPage } from './pages/lightfield'
export { SinkExtendingPage } from './pages/extending'
export { SinkTypographyPage } from './pages/typography'
export { SinkButtonsPage } from './pages/buttons'
export { SinkCardsPage } from './pages/cards'
export { SinkHeadersPage } from './pages/headers'
export { SinkNavigationPage } from './pages/navigation'
export { SinkListsPage } from './pages/lists'
export { SinkImagesPage } from './pages/images'
export { SinkLayoutPage } from './pages/layout'
export { SinkFormsPage } from './pages/forms'
export { SinkFeedbackPage } from './pages/feedback'
export { SinkPermissionsPage } from './pages/permissions'
export { SinkRealtimePage } from './pages/realtime'
export { SinkAdminOnlyPage } from './pages/admin-only'
export { SinkAiDemoPage } from './pages/ai-demo'
