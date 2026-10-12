/**
 * File Name: workspace-boundary.ts
 * Purpose: Resolves and enforces the workspace boundary on every API request,
 *   preventing API keys or member tokens from accessing other workspaces.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types (WorkspaceProject), ./errors (RequestError)
 */

import type { WorkspaceProject } from '@tangen/types'
import { RequestError } from './errors'

export function resolveWorkspaceId(value: string, projects: WorkspaceProject[]): string {
  const byId = projects.find(p => p.workspaceId === value)
  if (byId) return byId.workspaceId
  const bySlug = projects.find(p => p.slug === value)
  if (bySlug) return bySlug.workspaceId
  const byName = projects.find(p => p.name === value)
  if (byName) return byName.workspaceId
  return value
}

/**
 * Determines the requested workspace from the incoming request.
 * Priority: X-Tangen-Workspace header → subdomain → null (no constraint).
 * @param headers - Request headers object to inspect
 * @param projects - Registered workspace projects for name/ID resolution
 * @returns Resolved workspace ID string, or null if no workspace constraint is present
 */
export function resolveWorkspaceFromRequest(
  headers: Headers,
  projects: WorkspaceProject[],
): string | null {
  const header = headers.get('X-Tangen-Workspace')
  if (header) return resolveWorkspaceId(header, projects)

  const host = headers.get('Host') ?? ''
  const subdomain = host.split('.')[0]
  if (
    subdomain &&
    subdomain !== 'localhost' &&
    projects.some(p => p.name === subdomain || p.workspaceId === subdomain || p.slug === subdomain)
  ) {
    return resolveWorkspaceId(subdomain, projects)
  }

  return null
}

/**
 * Throws FORBIDDEN if the credential's workspace doesn't match the requested one.
 * When `requestedWorkspaceId` is null (no constraint header), this is a no-op.
 * @param credentialWorkspaceId - Workspace ID embedded in the API key or JWT
 * @param requestedWorkspaceId - Workspace ID resolved from the request headers, or null
 * @throws RequestError(FORBIDDEN) when workspaces don't match
 */
export function assertWorkspaceBoundary(
  credentialWorkspaceId: string,
  requestedWorkspaceId: string | null,
): void {
  if (requestedWorkspaceId === null) return
  if (credentialWorkspaceId === requestedWorkspaceId) return
  throw new RequestError(
    'FORBIDDEN',
    `API key is not authorized for workspace "${requestedWorkspaceId}"`,
    403,
  )
}

/**
 * Returns true when the role string is "superadmin".
 * @param role - Member role string from JWT payload, or null
 * @returns Whether the member holds the superadmin role
 */
export function isSuperAdmin(role: string | null): boolean {
  return role === 'superadmin'
}

/**
 * Like assertWorkspaceBoundary but skips the check for superadmin members.
 * @param credentialWorkspaceId - Workspace ID embedded in the credential
 * @param requestedWorkspaceId - Workspace ID resolved from the request, or null
 * @param memberRole - The member's role; superadmins bypass the boundary check
 */
export function assertWorkspaceBoundarySafe(
  credentialWorkspaceId: string,
  requestedWorkspaceId: string | null,
  memberRole: string | null,
): void {
  if (isSuperAdmin(memberRole)) return
  assertWorkspaceBoundary(credentialWorkspaceId, requestedWorkspaceId)
}
