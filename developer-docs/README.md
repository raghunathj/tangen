# Tangen developer documentation

The canonical public knowledge source for people **and coding agents** building
with Tangen. It will be served at `tangen.app/docs`; the directory name does not
dictate the URL.

> **This is not `docs/`.** [`../docs/`](../docs/README.md) is the engineering
> documentation for people building and maintaining the Tangen platform itself.
> This directory is for people building *with* it. When the two disagree about
> what a public API does, the contracts referenced here win, and `docs/` gets a
> correction.

**Status: foundation built, corpus not authored.** The site renders, navigation
is generated from one manifest, and the guards run. Eight pages exist. See
[`planning/stages.md`](./planning/stages.md) for the sequence.

```bash
bun run docs:dev      # local preview (Mintlify, needs Node 20.17+)
bun run docs:check    # navigation, frontmatter, links, imports, CLI, env, capabilities
bun run docs:build    # offline validation: mint broken-links
```

## The one-source rule

There is one copy of each page. Humans read it rendered; agents read the same
file as Markdown, find it through `llms.txt`, or search it through the docs
MCP server. There is no separate AI edition of the manual, and there never
should be: two copies of a contract is two contracts.

What `ai/` contains is *navigation and rules* - how to find the right page, what
the public boundary is, what not to invent - not a second copy of the content.

## Sections

| section | audience | what it is |
|---|---|---|
| [`learn/`](./learn/) | site developer | sequential tutorials: Quick Start, and Build an Enterprise Website |
| [`build/`](./build/) | site developer | task and concept pages for building an application on Tangen |
| [`extend/`](./extend/) | extension developer | the extension contract: manifest, lifecycle, contributions, testing |
| [`operate/`](./operate/) | operator | deploying, configuring and running Tangen |
| [`reference/`](./reference/) | all, and agents first | precise contracts: fields, TangenQL, SDK, CLI, config, errors |
| [`ai/`](./ai/) | coding agent | how to retrieve and apply this documentation correctly |

Six sections rather than the five originally proposed. `operate/` is separate
because the operator is a distinct audience in the audience model, and folding
deployment, backups and upgrades into `build/` would make "Build with Tangen"
mean two different jobs.

## Not published

Two directories are working material and must never be rendered, indexed,
bundled into `llms.txt`, or exposed through the docs MCP server:

- [`planning/`](./planning/) - the architecture, curricula, migration map,
  coverage matrix and platform evaluation for this phase
- [`conventions/`](./conventions/) - how pages are written

Any generator over this tree excludes both by name.

## Conventions

- [`conventions/page-types.md`](./conventions/page-types.md) - the six page types and what each is for
- [`conventions/frontmatter.md`](./conventions/frontmatter.md) - the metadata every page carries, and its consumers
- [`conventions/code-examples.md`](./conventions/code-examples.md) - what an example must do to ship

## Navigation and the platform

[`nav.json`](./nav.json) is the canonical navigation tree, and it is
platform-neutral on purpose. `docs.json`'s `navigation` block is **generated**
from it by `bun run docs:nav:write`, and a test fails if the two drift, so
there is one tree rather than two.

Everything else in `docs.json` - theme, colours, SEO, redirects - is a few dozen
hand-written lines. If Mintlify is ever replaced, `scripts/docs-nav.ts` is what
changes; the corpus and `nav.json` are untouched. The verified vendor contract
is [`planning/mintlify-contract.md`](./planning/mintlify-contract.md).

Pages are `.md` unless they need a component, and then `.mdx`. A guard fails on
a component inside a `.md` file, so plain Markdown means it.
