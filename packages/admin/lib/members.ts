/**
 * File Name: members.ts
 * Purpose: Defines assignable workspace member roles and provides helper
 *   functions for role display, identity checks, and invite request body construction.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None
 */

export interface MemberRoleOption {
  value: string
  label: string
}

/**
 * Ordered list of roles that admins can assign to workspace members (excludes the protected "owner" role).
 */
export const ASSIGNABLE_ROLES: MemberRoleOption[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
]

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
  none: 'No access',
}


/**
 * Returns a human-readable label for a role identifier.
 * @param role - Internal role string (e.g. "admin", "editor")
 * @returns Display label, falling back to the raw role string if unknown
 */
export function formatRole(role: string): string {
  return ROLE_LABELS[role] ?? role
}

/**
 * Returns true when memberId matches the currently authenticated member.
 * @param memberId - The ID of the member to test
 * @param currentMemberId - The ID of the currently authenticated member
 * @returns Whether the two IDs refer to the same member
 */
export function isMemberSelf(memberId: string, currentMemberId: string): boolean {
  return memberId === currentMemberId
}

/**
 * Returns true when the role is "owner".
 * @param role - Role string to check
 * @returns Whether the role is the protected owner role
 */
export function isOwnerRole(role: string): boolean {
  return role === 'owner'
}

/**
 * Constructs the request body for the member invite API, omitting temporaryPassword when not provided.
 * @param form - Form data containing email, name, role, and optional temporaryPassword
 * @returns API request body object ready to be sent to the invite endpoint
 */
export function buildInviteBody(form: {
  email: string
  name: string
  role: string
  temporaryPassword?: string
}) {
  return {
    email: form.email,
    name: form.name || null,
    role: form.role,
    ...(form.temporaryPassword ? { temporaryPassword: form.temporaryPassword } : {}),
  }
}
