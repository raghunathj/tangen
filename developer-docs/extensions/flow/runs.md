---
title: Runs, retries and failures
description: What a run records, when Flow retries, how a failure is reported, and how to test a flow without doing anything.
audience: site-developer
type: reference
status: stable
package: "@tangen/ext-flows"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g5/nodes
---

# Runs, retries and failures

## What a run records

```json
{
  "status": "completed",
  "path": ["start", "gate", "createLead", "hot"],
  "ms": 6,
  "attempts": 1,
  "startedAt": "…",
  "runAs": "owner",
  "actor": { "kind": "member", "id": "mem_…" },
  "initiator": null,
  "correlationId": "…",
  "log": [
    { "step": "gate", "action": "condition", "ok": true, "ms": 0, "output": { "result": "yes" } },
    { "step": "createLead", "action": "crm_create_lead", "ok": true, "ms": 4,
      "output": { "lead": { "id": "nw_q96aczht", "tier": "enterprise" } }, "attempt": 1 }
  ]
}
```

`path` is the route taken, which answers "which branch ran" faster than reading
the log. `runAs`, `actor` and `initiator` say who the run was: the flow's
`runAs` mode, the member, key or identity whose authority it used, and the
member or key behind the triggering event when there was one. A run refused
because that authority was lost records `failure.code: "AUTHORITY_LOST"`. Each log entry carries its step id, the action, whether it succeeded,
its duration, its attempt number and its output.

Statuses you will see: `completed`, `error`, `waiting`, `waiting_retry`,
`skipped`, `cancelled`.

## Retries

**Nothing is retried unless you ask for it.** A node's default policy is
`maxAttempts: 1`, so a failed step fails - once. Flow cannot know whether the
action you wired up is safe to repeat, so it does not guess.

Declare a policy on the node to opt in:

```json
{ "retry": { "maxAttempts": 3, "backoff": "exponential", "baseDelaySeconds": 30 } }
```

| field | default | bounds |
|---|---|---|
| `maxAttempts` | `1` | 1 to **5** - a node needing six tries needs a different design |
| `backoff` | `exponential` | `exponential` or `fixed` |
| `baseDelaySeconds` | `30` | 1 to **3600** - further out than an hour is a schedule, not a retry |

An unusable declaration (`maxAttempts: 99`) is reported, not quietly clamped.

Only a failure **declared retryable** is retried. `unknown` is not treated as a
maybe: it is not retried. The log records one entry per attempt with its
`attempt` number, and each entry carries `failure.retryable` so you can see why
a step stopped where it did.

Between attempts the run parks as `waiting_retry`. That is **durable queue
state**, not an in-memory timer: a run waiting to retry survives a restart.

If a node has an **on error** outlet connected, the branch is taken once the
attempts are spent - not on the first failure - and it reads the message as
`{{steps.<id>.output.error}}`. A node with `maxAttempts: 3` and an on-error
branch records three failed entries and then the branch, and `path` shows the
node once per attempt:

```json
{ "status": "completed", "path": ["start", "call", "call", "call", "rescue"] }
```

The run's own status is `completed`, because the flow handled its failure.

A flow that keeps failing trips a circuit breaker and is disabled, with the
reason written into its history. The threshold is configurable:

```ts
{ resolve: '@tangen/ext-flows', options: { failureThreshold: 10 } }
```

### Idempotency is yours to honour

A contributed action's handler receives an `idempotencyKey` and an `attempt`
number in its third argument. Flow does not deduplicate for you - it gives an
action that reaches an external system the identity it needs to deduplicate
itself. An action that ignores the key will act twice if it is retried.

## Failures

Failure messages are bounded and redacted - bearer and token-shaped strings are
stripped before a message reaches history. A failure carries a stable code and
whether it was retryable, so a run that stopped tells you whether trying again
would have helped.

An unhandled crash closes its run rather than leaving it open, and a crashed
run is never silently re-run.

## Cancelling a run

```text
POST /api/v1/admin/ext/flows/flows/<flowId>/runs/<runId>/cancel
```

A parked run (`waiting`, `waiting_retry`) is cancelled immediately. A run that
is executing records the request and stops at its next boundary - in-flight work
is not interrupted mid-step. A finished run cannot be cancelled and says so.

> The `runId` in that path is the run's `executionId` **without its `exec_`
> prefix**. The runs listing returns `executionId: "exec_mtjmah4q5ktdjd"`; the
> route wants `mtjmah4q5ktdjd`. Tracked as FLOW-G5-1.

## Testing {#testing}

```text
POST /api/v1/admin/ext/flows/flows/<flowId>/test
```

Runs the flow and returns the complete log **inline**, rather than queuing it.
Write-actions are simulated:

```json
{ "step": "call", "action": "http", "ok": true,
  "output": { "dryRun": true, "wouldDo": { "url": "https://example.invalid/hook", "method": "POST" },
              "response": { "status": 200, "body": {} } } }
```

No request was made. The `dryRun` and `wouldDo` fields are how you tell a
simulated step from a real one, and the run continues past it so you can see the
whole path.

The `response` is a **stub and always reports 200**, so a condition on
`{{steps.call.output.response.status}}` takes its success outlet in every test
run. A test proves the flow's shape and expressions; it does not exercise how
the flow behaves when the call fails. For that, point the node at a URL that
really fails and run it for real.

## Retention

Runs are pruned on a window, **30 days** by default:

```ts
{ resolve: '@tangen/ext-flows', options: { runRetentionDays: 7 } }
```

Shorten it if your flows touch personal data - a step's own output is stored.
See [Security and retention](/extensions/flow/security).

## Related

- [Actions](/extensions/flow/actions)
- [Security and retention](/extensions/flow/security)
