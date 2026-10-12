---
title: Extensions
description: "Using the extensions that ship with Tangen - Forms, Flow, SEO: what each one does, and the three separate steps between a package being available and a feature being on."
audience: site-developer
type: concept
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-f/northwind#extension-lifecycle
---

# Extensions

An extension adds capability to a workspace: server routes, Admin screens, Flow
actions and triggers, content types of its own. Some ship with Tangen. Others
you write, or install from a registry.

This section is about **using** them. If you want to build one, go to
[Extend Tangen](/extend).

## Three steps, not one

The single most common confusion is treating availability, installation and
activation as one thing. They are three, they happen on different surfaces, and
the CLI reports them separately.

```text
declare   →   install   →   enable
 config        database     database
             per env       per env
```
### Declare

A project lists the extensions it may use in `app/config/extensions.ts`:

```ts
import { defineExtensions } from '@tangen/cms'

export default defineExtensions([
  { resolve: '@tangen/ext-seo' },
  { resolve: '@tangen/ext-flows' },
])
```
Declaring makes an extension **available**. It does not turn anything on, and it
is workspace-wide - the same declaration serves every deployment.

Options go here too, and they are read by the extension itself:

```ts
{ resolve: '@tangen/ext-flows', options: { runRetentionDays: 14 } }
```
See [Extension options](/extend/configuration) for what an extension does with
them.

### Install

Installing writes a row in this deployment's database:

```sh
tangen extension install seo
```
Nothing about your files changes. The extension's `onInstall` runs, its tables
(if it declares any) are migrated, and the deployment now knows about it.

### Enable

Installing leaves an extension enabled. Disabling and re-enabling is a separate
action, also per deployment:

```sh
tangen extension list
#  seo    SEO     0.1.142   installed, enabled
#  flows  Flows   0.1.143   installed, enabled
```
An extension that is declared but not installed contributes nothing: no routes,
no Flow actions, no Admin screens. That is not a bug, it is the point - you can
run an extension in development and not in production.

## Bundled extensions

**SEO** and **Flow** arrive with `@tangen/cms`. You never install their
packages, and there is no supported add command for either - putting
`@tangen/ext-seo` in your own dependencies is not an instruction this
documentation will give you.

They are already in your `node_modules` because the platform brought them. A
scaffolded project declares both for you. You still install and enable them per
deployment like anything else.

## What ships

| extension | package | how you turn it on | documented |
|---|---|---|---|
| [Forms](/extensions/forms) | core capability - no package | `tangen extension install forms` | yes |
| [SEO](/extensions/seo) | `@tangen/ext-seo`, bundled | `tangen extension install seo` | yes |
| [Flow](/extensions/flow) | `@tangen/ext-flows`, bundled | `tangen extension install flows` | yes |

**Forms is the odd one.** It is a core capability with no package, enabled with
`tangen extension install forms` rather than installed. Everything else in this section is
an extension and follows declare / install / enable.

Other packages exist under `extensions/` in the Tangen repository - Porter,
Review, Variants, Studio, and a kitchen-sink reference. They are not published
for external installation in v1 and are not documented here. Seeing a package
name in a repository is not a supported install.

## Related

- [Extension options](/extend/configuration) - what your `options` reach
- [Extend Tangen](/extend) - building one
- [CLI reference](/reference/cli) - every `tangen extension` command
