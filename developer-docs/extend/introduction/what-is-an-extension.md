---
title: What is an extension?
description: What an extension can contribute, when to build one, and what is not an extension.
audience: extension-developer
type: concept
status: stable
lastVerified: 2026-09-02
verification: source
verifiedBy: packages/types/src/extension.ts
---

# What is an extension?

An extension is a **package** that declares what it contributes to Tangen and
is installed per workspace on each deployment. It can add content types, tables,
server routes, Admin pages, panels, field types, jobs, hooks and permissions.

The manifest **declares**; the platform decides when any of it runs.

## When to build one

| build an extension | put it in your application |
|---|---|
| the behaviour belongs with the **content**, and editors need it in the Admin | the behaviour belongs to your **site** |
| you want it in more than one workspace or project | it is used once |
| it needs server-side lifecycle - hooks on publish, queued jobs, its own tables | a request-time concern your frontend handles |
| an operator should be able to switch it off | it is not optional |

A review workflow that gates publishing is an extension. A pricing calculator on
your marketing site is application code.

## What is not an extension

**Not every optional Tangen feature is one.** Several things you configure and
switch off are **platform capabilities** with no package to install:

| capability | not an extension |
|---|---|
| **Forms** | configured in `app/config/forms.ts` and code-first definitions. There is nothing to install |
| **Search** | part of the platform; nothing to enable or install |
| **Media**, **Mail**, **Realtime**, **Scheduler**, **Webhooks** | core capabilities |
| **AI**, **MCP**, **Knowledge** | optional capabilities, credential- and package-gated |
| **Telemetry** | a Core capability with no persistence. There is no `ext:telemetry` |

If a page or a colleague calls one of these "the X extension", that wording is
out of date. The list of registered capabilities is in
[Reference → Extension manifest](/reference/extension-manifest#dependencies).

## Three states, not two

An extension is `on`, `off` or `unavailable`, per workspace on each
deployment. "Installed" is not the same as "running":

| | means |
|---|---|
| **installed** | it exists on this deployment, and its migrations have run |
| **enabled** | an operator switched it on here |
| **active / on** | installed, enabled, code loaded in this process, and everything it requires is available |
| **unavailable** | it cannot run here - a required capability is missing, a dependency is not active, migrations are pending, or this process has not loaded its code |

Design for all of them. See
[Capabilities and dependencies](/extend/contract/capabilities).

## What an extension may not assume

- **That it is running.** An operator can disable it, and a missing dependency
  can make it unavailable.
- **That it may touch the database freely.** No runtime DDL. Tables come from
  declared migrations, at install and upgrade.
- **That it can reach platform internals.** Extensions import from
  `@tangen/cms` and nothing else. See
  [Public contract](/reference/public-contract).
- **That configuration is present.** An operator may not have filled it in.
- **That it owns the request.** Its routes are gated by the same permissions
  everything else is.

## Related

- [Your first extension](/extend/introduction/first-extension) ·
  [Extension manifest](/reference/extension-manifest) ·
  [Extension lifecycle](/reference/extension-lifecycle)
