---
title: Flow security and retention
description: Where submitted values can end up, what the sandbox does and does not guarantee, and how long a run is kept.
audience: site-developer
type: concept
status: stable
package: "@tangen/ext-flows"
lastVerified: 2026-09-02
verification: executable
verifiedBy: flow-remediation/form-hydration
---

# Flow security and retention

> **Warning**
>
> A flow step's own output is written to run history. If a step logs or
> interpolates a submitted value, that value is stored for the retention period.
> Nothing redacts it for you.

## Where submitted values travel

| place | carries values | why |
|---|---|---|
| the `form.submitted` event | **no** | identifiers only, so no other subscriber sees form contents |
| the durable task queue | **no** | a run parked at a Wait re-resolves on resume from the small event |
| the run record's trigger | **no** | a run stores status, log and path |
| **a step's own output** | **yes, if you put it there** | this is the one to think about |

So this is safe:

```text
condition   trigger.submission.values.companySize eq 500+
```
and this stores an email address for as long as the run is kept:

```text
log   "New lead: {{trigger.submission.values.businessEmail}}"
```
Branch on sensitive fields freely. Think before you interpolate one into an
output.

## Retention

Runs are pruned on the extension's retention window, **30 days** by default:

```ts
{ resolve: '@tangen/ext-flows', options: { runRetentionDays: 7 } }
```
Shorten it if your flows touch personal data.

## What the code step guarantees

The `code` action runs in a QuickJS WebAssembly isolate with no host bindings.
Measured, not asserted:

| probe | result |
|---|---|
| `process`, `Bun`, `require`, `fetch`, `XMLHttpRequest`, `WebSocket`, `setTimeout` | all `undefined` |
| `globalThis` own properties | the ECMAScript intrinsics, plus `input` |
| `import("node:fs")` | refused |
| `while (true) {}` | interrupted at ~1s |
| unbounded allocation | stopped, out of memory |
| output over 64KB | refused |

**What is not claimed:** this is an isolate, not a defence against a QuickJS or
WebAssembly escape. What is guaranteed is that the platform passes no host
object across the boundary and grants no host global. Treat a code step as
untrusted-input-safe, not as a security boundary against a hostile author.

## Outbound requests

The `http` action refuses private and loopback addresses. A workspace can opt
out for local development:

```ts
{ resolve: '@tangen/ext-flows' }
// then, in the Admin: Settings, Extensions, Flows, "Allow private networks" - it
// takes effect only under the optional network:private grant
// (tangen extension upgrade flows --approve-optional network:private)
```
Leave it off in production. It exists so a developer can reach a local
receiver, not so a flow can reach your internal network.

## The four places, named

The distinction that matters, in order of durability:

| | carries submitted values | lives |
|---|---|---|
| the `form.submitted` event | no | in memory, for the moment it is dispatched |
| trigger hydration | yes | in the run's scope, for the run |
| a step's own output | **only what you put there** | run history |
| run history | whatever the outputs held | `runRetentionDays`, default 30 |

Hydration is not the event; a step's output is not hydration; history is not
either. A flow can read a submitted email in a condition and store nothing.

## Related

- [Forms and Flow](/extensions/flow/forms-integration)
- [Runs, retries and failures](/extensions/flow/runs)
- [Extension options](/extend/configuration)
