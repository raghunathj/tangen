---
title: Flow reference
description: Node kinds, condition operators, built-in actions, trigger types and the limits, as the implementation declares them.
audience: site-developer
type: reference
status: stable
package: "@tangen/ext-flows"
lastVerified: 2026-09-02
verification: source
verifiedBy: extensions/flows/src/engine/executor.ts
---

# Flow reference

Every table here is validated against the implementation by `docs:check`.

## Node kinds

```text
trigger · condition · switch · transform · wait · loop · action
```

## Condition operators

| operator | true when |
|---|---|
| `eq` | equal |
| `neq` | not equal |
| `gt` | greater than |
| `lt` | less than |
| `contains` | contains the operand |
| `not_contains` | does not contain it |
| `exists` | the path resolves |

## Built-in actions

```text
http · content · query · email · label · run_flow · log
```

plus `code`, which is dispatched before the action map and so is not one of its
entries.

## Platform trigger types

```text
object.created · object.updated · object.published · object.unpublished
object.deleted · object.scheduled · media.uploaded · member.invited
member.created · member.updated · form.submitted · site_user.registered
site_user.login
```

Plus `manual`, `schedule`, `webhook`, and any `ext:<id>:<name>` or `custom:<name>`
an active extension or site helper declares.

## Node configuration

| node | key fields | outlets |
|---|---|---|
| `condition` | `conditions: [{ path, op, value }]` | `yes`, `no` |
| `switch` | `path`, `cases: string[]` | `case:<value>`, `default` |
| `transform` | `output` - an object of expressions | one |
| `loop` | `path`, optional `limit` | **`body`** |
| `wait` | `minutes`, `hours`, `days` | one |
| `action` | `action`, `config` | one, plus `on error` when connected |

## Retry policy

Declared per node as `data.retry`. Nothing retries by default.

| field | default | bounds |
|---|---|---|
| `maxAttempts` | `1` | 1 to `5` |
| `backoff` | `exponential` | `exponential`, `fixed` |
| `baseDelaySeconds` | `30` | 1 to `3600` |

Only a `retryable` failure is retried; `unknown` is not.

## Limits

| limit | value |
|---|---|
| loop iterations | **20** - a longer collection is truncated and records `truncatedFrom` |
| subflow depth | **5** |
| wait minimum | **60 seconds** |
| code CPU | ~1 second |
| code output | **64KB** |
| run retention | **30 days** by default (`runRetentionDays`) |

## Contribution types

From `@tangen/ext-flows/contract`:

| type | shape |
|---|---|
| `FlowOutputField` | `{ key: string; label?: string; type?: 'string' \| 'number' \| 'boolean' \| 'json' \| 'array' }` |
| `FlowActionContribution` | `{ name, label, description?, capability?, configFields?, output?, handler }` |
| `FlowTriggerContribution` | `{ type, label, description?, capability?, payloadFields? }` |
| `FlowActionMeta` | the handler's third argument: `flowId`, `flowName`, `trigger`, `idempotencyKey`, `attempt` |
| `FlowHelpers` | `{ actions?, triggers? }` - the site-helper shape |

`key` is a **dot-path into the returned object** - `lead.id`, `response.status`.

## Options

```ts
{ resolve: '@tangen/ext-flows', options: {
    // Allow private networks is a manifest setting now (Settings, Extensions, Flows), permission-aware under network:private
    failureThreshold: 5,           // consecutive failures before a flow is disabled
    runRetentionDays: 30,
} }
```

## Admin API

| route | does |
|---|---|
| `GET  /api/v1/admin/ext/flows/catalog` | triggers and actions available here |
| `GET  /api/v1/admin/ext/flows/flows` | list |
| `POST /api/v1/admin/ext/flows/flows` | create |
| `PATCH /api/v1/admin/ext/flows/flows/:id` | update |
| `POST /api/v1/admin/ext/flows/flows/:id/run` | queue a run |
| `POST /api/v1/admin/ext/flows/flows/:id/test` | dry run, log returned inline |
| `GET  /api/v1/admin/ext/flows/runs` | run history |
| `POST /api/v1/admin/ext/flows/flows/:id/runs/:runId/cancel` | cancel |

Member-authenticated. `/api/v1/ext/*` mounts only `key` and `public` routes,
which is why these live under `/admin/ext/`.

## Related

- [Flow](/extensions/flow) · [Flow contributions](/extend/flow-contributions)
