/**
 * File Name: index.ts
 * Purpose: The browser-safe client entry of @tangen/ext-forms: the contract a
 *          site imports (`defineForm`, `defineFormHooks`, the types), the
 *          admin pages the manifest names, the `form` field input, and the
 *          settings context the sidebar renders while a form's settings are
 *          open.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The pages import from `@/kit` only. Registering the
 *          context nav at load is what an extension does for a route family
 *          of its own (docs/admin-kit.md, contextual navigation).
 */
import { registerContextNav } from '@/kit'
import { FormPickerInput } from './admin/form-picker'
import { SETTINGS_SECTIONS } from './admin/pages/settings'

export * from './contract'
export type { FormsOptions } from './settings'

export { FormsListPage } from './admin/pages/forms-list'
export { SubmissionsPage } from './admin/pages/submissions'
export { FormBuilderPage } from './admin/pages/builder'
export { FormSettingsPage } from './admin/pages/settings'

/** The `form` field type's editor input, collected by the admin build. */
export const fieldTypeUIs = [{ name: 'form', Input: FormPickerInput }]

registerContextNav(({ pathname, workspaceId }) => {
  const m = new RegExp(`^/${workspaceId}/extensions/forms/([^/]+)/settings(?:/|$)`).exec(pathname)
  if (!m) return null
  const formId = m[1]!
  const base = `/${workspaceId}/extensions/forms/${formId}/settings`
  return {
    id: 'forms:settings',
    title: 'Form settings',
    icon: 'IconSurvey',
    backHref: `/${workspaceId}/extensions/forms/${formId}`,
    backLabel: 'Back to builder',
    items: SETTINGS_SECTIONS.map((s) => ({ id: s.id, label: s.label, href: `${base}/${s.id}`, icon: s.icon })),
  }
})

// Every Forms page keeps the Forms context (the list, the submissions): the
// builder is a page of the section, not a way out of it. The settings
// resolver above is registered first and wins for its own routes.
registerContextNav(({ pathname, workspaceId }) => {
  const base = `/${workspaceId}/extensions/forms`
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null
  return {
    id: 'forms',
    title: 'Forms',
    icon: 'IconSurvey',
    backHref: `/${workspaceId}/dashboard`,
    backLabel: 'Back to workspace',
    items: [
      { id: 'forms', label: 'Forms', href: base, icon: 'IconSurvey' },
      { id: 'submissions', label: 'Submissions', href: `${base}/submissions`, icon: 'IconInbox' },
    ],
  }
})
