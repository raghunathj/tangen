---
title: Local development
description: The CLI loop for building an extension against a real project.
audience: extension-developer
type: guide
status: stable
package: "@tangen/cli"
lastVerified: 2026-09-02
verification: source
verifiedBy: packages/cli/src/commands/dev.ts
---

# Local development

An extension is developed **inside a Tangen project**, against a real
development deployment.

## Scaffold

```bash
bun run tangen extension create
```

It writes the manifest, the entries and a `package.json`, and appends the
extension to `app/config/extensions.ts`.

## Declare it

```ts app/config/extensions.ts
export default defineExtensions([
  { resolve: '../../extensions/my-extension', options: { greeting: 'Hi' } },
])
```

A relative path is the normal shape while developing. A package name works the
same way once it is installed as a dependency.

## Install and enable

```bash
bun run tangen extension install my.extension
bun run tangen extension enable  my.extension
bun run tangen extension list
```

Three separate steps on purpose: declaring makes it **available**, installing
runs its migrations on that deployment, enabling switches it on.

## The loop

```bash
bun run tangen dev
```

| you changed | what to do |
|---|---|
| a page or panel component | the Admin's dev server picks it up |
| the server entry | the API restarts under `--watch` |
| **the manifest** | **restart**, and re-run `install` if you changed migrations or config |
| a **migration** | bump `version` and `tangen extension upgrade` |

The manifest is read at boot. A manifest change that seems not to apply is
almost always a process that was not restarted.

## Configuration while developing

Edit `options` in `app/config/extensions.ts` and restart. For a `required`
config key with no value, install fails and names the key - which is the
behaviour you want, so do not work around it.

## Secrets while developing

Put them in your project's `.env` under the names you declared. Never in the
manifest, never in a fixture, and check that your extension degrades honestly
when they are absent - delete the variable and run it.

## Exercising the lifecycle

```bash
bun run tangen extension disable   my.extension
bun run tangen extension enable    my.extension
bun run tangen extension uninstall my.extension
bun run tangen extension install   my.extension
bun run tangen doctor
```

Do this before you ship. Disable is the one most extensions get wrong, and it
is the cheapest to check: nothing of yours should be visible or reachable.

## A second deployment

```bash
bun --env-file=.env.staging run tangen extension install my.extension
```

Installing on the development deployment installs nowhere else. Test with
your extension installed on one deployment and not the other - it is the
state your users will actually be in.

## Related

- [Extension CLI](/extend/shipping/cli) · [Testing an extension](/extend/shipping/testing)
  · [The lifecycle in practice](/extend/contract/lifecycle)
