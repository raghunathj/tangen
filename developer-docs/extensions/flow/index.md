---
title: Flow
description: Automations that run when something happens - a form submitted, content published, a schedule elapsing.
audience: site-developer
type: concept
status: stable
package: "@tangen/ext-flows"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g5/composition
---

# Flow

Flow runs work when something happens. A demo request arrives and a lead is
created. An article is published and a cache is purged. A schedule elapses and
a digest goes out.

A flow is a graph. One **trigger** starts it; **nodes** do the work; **edges**
decide what runs next.

```text
trigger  →  condition  →  action  →  action
                 │
                 └──────→  action
```

Every node writes an output, and every later node can read it.

> Flow is an extension. It ships with Tangen but is installed and enabled per
> deployment - see [Extensions](/extensions). Nothing below works until
> `tangen extension install flows`.

## What a flow is made of

| kind | does |
|---|---|
| **trigger** | starts the flow. Exactly one per flow |
| **action** | the work: HTTP, content, email, code, a contributed action |
| **condition** | a yes/no branch |
| **switch** | a many-way branch on one value |
| **transform** | builds an object from expressions, without calling anything |
| **loop** | runs its body once per item in a collection |
| **wait** | parks the run and resumes it later |

## How data moves

A node's result is addressable by the node's id:

```text
{{trigger.…}}                     what started the flow
{{steps.<nodeId>.output.…}}       any earlier node's result
{{item}} {{itemIndex}}            inside a loop body
```

So a node that returns `{ lead: { id: 'nw_123' } }` is read downstream as
`{{steps.createLead.output.lead.id}}`. See
[Data and expressions](/extensions/flow/concepts).

## Runs are durable

A run is queued, not executed inline with whatever triggered it. It survives a
restart, retries on failure, and can park at a `wait` for days and pick up
where it left off. Every run keeps a per-step log with timings, which is what
you read when something did not happen.

## Extensions can add to it

An extension contributes its own actions and triggers, and they appear on the
canvas next to the built-in ones. A contributed action runs with **its own**
extension's context and storage - Flow invokes it, it does not own it.

Building one is [Flow contributions](/extend/flow-contributions).

## Where to go next

- [Getting started](/extensions/flow/getting-started) - a flow that runs, in five minutes
- [Data and expressions](/extensions/flow/concepts)
- [Triggers](/extensions/flow/triggers)
- [Logic nodes](/extensions/flow/logic)
- [Actions](/extensions/flow/actions)
- [Runs, retries and failures](/extensions/flow/runs)
- [Forms and Flow](/extensions/flow/forms-integration)
- [Security and retention](/extensions/flow/security)
