---
title: Reference
description: "The complete supported Tangen contracts: packages, configuration, fields, TangenQL, the SDK, the CLI, auth, permissions, errors and extensions."
audience: site-developer
type: concept
status: stable
lastVerified: 2026-09-01
verification: source
verifiedBy: developer-docs/.generated/platform-facts.json
---

# Reference

Reference pages define the whole supported contract, not one way of using it. A
guide shows you a path; a reference page shows you the space.

## Contracts

- [Public contract](/reference/public-contract) - which packages and imports are
  supported, and what stable, experimental and internal mean
- [Configuration](/reference/configuration) - every `app/config` file and what
  belongs in it
- [Environment variables](/reference/environment-variables) - every variable,
  its default, and whether it is a secret
- [Deployments](/reference/deployments) - the three roles and the production
  safety rules

## Content

- [Fields](/reference/fields) - all 28 built-in field types
- [Link](/reference/link) - referencing content by identity

## Querying

- [TangenQL](/reference/tangenql) - filters, operators, relations, sorting,
  paging and depth
- [SDK](/reference/sdk) - `@tangen/sdk`: the client, reads, writes, cancellation
- [Delivery API](/reference/delivery-api) - the REST endpoints an API key can call

## Access

- [Authentication](/reference/authentication) - the four auth systems, and
  `defineAuthConfig`
- [Permissions](/reference/permissions) - roles, API key scopes, and why a
  capability is not a permission

## Operations

- [CLI](/reference/cli) - every `tangen` command
- [Errors](/reference/errors) - the codes your application should handle

## Extensions

- [Extension manifest](/reference/extension-manifest) - manifest v1, field by
  field
- [Extension lifecycle](/reference/extension-lifecycle) - the eleven stages
