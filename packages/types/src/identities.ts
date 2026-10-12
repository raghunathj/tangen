/**
 * File Name: identities.ts
 * Purpose: Service and agent identities (framework kernel K8): a record that
 *          holds authority - grants in the key model and capabilities in
 *          the member model - and to which API keys belong as credentials.
 *          A key with an identity acts AS that identity: attribution,
 *          policy and audit name the identity, never the credential.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ApiKeyPermissions } from './api-keys'

/** `service`: a deployment's own automation (a sync, an integration, a flow's owner that outlives people). `agent`: an AI agent operating the workspace. */
export type IdentityKind = 'service' | 'agent'

export type IdentityStatus = 'active' | 'suspended'

export interface Identity {
  id: string
  workspaceId: string
  kind: IdentityKind
  name: string
  description: string | null
  status: IdentityStatus
  /** Grants, in the key model (objects, media, tables, locales, ...). */
  permissions: ApiKeyPermissions
  /** Capabilities, in the member model (`manage:flows`, an extension's `review:approve`, ...). */
  capabilities: string[]
  /** The member who owns it; attribution of its creation, never its authority. */
  ownerId: string | null
  createdAt: string
  updatedAt: string
}

/** What a credential resolves to at request time (cached beside the key). */
export interface IdentitySummary {
  id: string
  workspaceId: string
  kind: IdentityKind
  name: string
  status: IdentityStatus
  permissions: ApiKeyPermissions
  capabilities: string[]
}
