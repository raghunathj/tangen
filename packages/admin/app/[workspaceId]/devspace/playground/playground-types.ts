/**
 * File Name: playground-types.ts
 * Purpose: Shared shapes for the merged API Playground (shell, REST tab,
 *          GraphQL tab, collections).
 *
 * Author: Raghunath J
 * License: MIT
 */

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export interface KeyOption {
  id: string
  label: string
  keyPrefix: string
  permissions?: Record<string, unknown>
  disabled?: boolean
  reason?: string
}

export interface CatalogEndpoint {
  label: string
  method: Method
  path: string
  description?: string
  sampleBody?: Record<string, unknown>
  sampleParams?: Record<string, string>
}

export interface CatalogGroup { group: string; endpoints: CatalogEndpoint[] }
