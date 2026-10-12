/**
 * File Name: index.ts
 * Purpose: What a site and the admin build import from `@tangen/ext-auth`:
 *          the contract (options, profile fields, hooks, `defineAuthOptions`)
 *          and the admin pages the manifest names.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { registerContextNav } from '@/kit'

export * from './contract'

export { UsersListPage } from './admin/pages/users-list'
export { UserDetailPage } from './admin/pages/user-detail'
export { SignInMethodsPage } from './admin/pages/methods'

// Every Site users page keeps the section's context: the list, the sign-in
// methods. A user's page is a page of the section, not a way out of it.
registerContextNav(({ pathname, workspaceId }) => {
  const base = `/${workspaceId}/extensions/auth`
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null
  return {
    id: 'auth',
    title: 'Site users',
    icon: 'IconUsers',
    backHref: `/${workspaceId}/dashboard`,
    backLabel: 'Back to workspace',
    items: [
      { id: 'users', label: 'Users', href: base, icon: 'IconUsers' },
      { id: 'methods', label: 'Sign-in methods', href: `${base}/methods`, icon: 'IconKey' },
    ],
  }
})
