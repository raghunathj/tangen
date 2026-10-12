---
title: AI Agents
description: How coding agents should retrieve and apply this documentation.
audience: agent
type: concept
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g12/clean-room
---

# AI Agents

How coding agents should retrieve and apply this documentation.

If you are a coding agent writing Tangen code, read this section before you
generate anything.

Its job is navigation and boundaries, not content: how to find the right page,
which imports are public, what the three capability states mean, and the
mistakes that produce code which compiles and is still wrong. It never restates
what [Build](/build), [Extend](/extend) or [Reference](/reference) already say.

## What you can retrieve

| surface | at | for |
|---|---|---|
| **Discovery index** | `/llms.txt` | what exists, and which page owns a topic. Starts with a short "Start here" list ordered by task |
| **Whole corpus** | `/llms-full.txt` | every page in one file, in navigation order, each with a `Source:` line |
| **One page as Markdown** | any page URL with `.md` appended | the page itself, without the site chrome |

So `https://docs.tangen.app/build/globals.md` is the Markdown of
[Globals](/build/globals), and `/llms.txt` is where to look first if you do not
know which page that is.

**Cite the canonical URL**, not a filename: every page in `llms-full.txt` carries
its own `Source:` line for exactly that.

## The Agent Skill

Tangen ships an Agent Skill - a **procedure**, not a second copy of these pages.
It says how to work on a Tangen project: look before you touch, find the page
that owns the contract, separate what you know from what you guessed, and prove
the result against a running server. It deliberately carries no API contracts,
because those live here and are checked against the product.

The public CLI writes it into a project:

```bash
bunx @tangen/cli ai init          # or: tangen ai init
tangen skills update              # refresh after upgrading the CLI
```

Both land `skills/tangen-developer/SKILL.md` in the project, with a discovery
stub under `.claude/skills/` for tools that look there. `tangen create` writes
them for a new project already.

If you are that agent: the skill tells you to come here. This page tells you
where "here" is.

**Not built yet:** a documentation MCP server. Do not plan retrieval around it.

Two different things are called MCP, and confusing them will send you to the
wrong page:

| | |
|---|---|
| **Tangen's MCP capability** | a product feature: it exposes *a workspace's content* to an agent. Part of the platform |
| **a documentation MCP server** | a future way to search *these pages*. Not built |

This section is about the second only where it says so. Everything about the
first belongs with the product.
