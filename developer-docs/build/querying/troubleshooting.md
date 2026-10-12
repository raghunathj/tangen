---
title: Query troubleshooting
description: Reading a TangenQL refusal and finding the cause.
audience: site-developer
type: troubleshooting
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g8/refusals
---

# Query troubleshooting

TangenQL refuses rather than guesses. Every refusal is a `422
VALIDATION_ERROR` naming the offending field.

| symptom | cause | fix |
|---|---|---|
| "unknown field" | a typo, or the field is not pushed to this deployment | check the model, then `tangen push` |
| "unknown operator" | an operator that does not exist, e.g. `between` | use `gte` and `lte` together |
| a bare array is refused | `{ views: [1, 2] }` | `{ views: { in: [1, 2] } }` |
| a string operator refused | `contains` on a number | use `eq`, or the right operator for the type |
| "unknown type" | a typo, or the type is not on this deployment | `tangen push` |
| a relation path is refused | more than one level deep | query the middle type separately |
| depth is refused | over the ceiling of 5, where no clamp runs (the local client, an extension) | reduce it, or query in two steps |
| a cursor is refused | `after` (the wire key for a cursor) combined with `offset` | use one or the other |

## A read that quietly did less than you asked

A REST read does not refuse an over-limit `depth` or `limit`; the gateway
**clamps** it and says so in `meta.clamped`:

```json
{ "meta": { "clamped": { "depth": { "requested": 9, "applied": 5 } } } }
```

If a query looks like it ignored you, read `meta` before changing the query.

## Empty results with no error

| cause | check |
|---|---|
| the content is a draft | a default read is published only |
| wrong deployment | the key was issued on another deployment |
| the type is not pushed here | `tangen doctor` |
| a filter is stricter than you think | remove conditions until rows appear |

## `403` rather than empty

A key missing an action gets `403 FORBIDDEN`, never a silent empty list. If a
query works on one deployment and 403s on another, compare the two keys'
actions.

## Types disagree with the schema

Regenerate:

```bash
bun run tangen types
```

Your editor is reading `app/generated/`, which only changes when you push or
regenerate.

## Related

- [Errors reference](/reference/errors) · [TangenQL reference](/reference/tangenql)
  · [Permissions](/reference/permissions) ·
  [Generated types](/build/getting-started/generated-types)
