---
title: Data and expressions
description: The scope a flow sees, how one node reads another's output, and what happens when a path is missing.
audience: site-developer
type: reference
status: stable
package: "@tangen/ext-flows"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g5/composition
---

# Data and expressions

Every node can read what came before it. There is one scope and one syntax.

## The scope

| path | is |
|---|---|
| `trigger` | what started the run: the event, and whatever the trigger resolved |
| `steps.<nodeId>.output` | an earlier node's result |
| `item`, `itemIndex` | the current element, inside a loop body only |

```text
{{trigger.submission.values.company}}
{{steps.createLead.output.lead.id}}
{{item}}   {{itemIndex}}
```

## Nested paths work

A node's output is an object, and the path goes as deep as the object does. An
action returning:

```json
{ "lead": { "id": "nw_q96aczht", "tier": "enterprise", "company": "Meridian Group" } }
```

is read as:

```text
{{steps.createLead.output.lead.id}}
{{steps.createLead.output.lead.tier}}
```

Both resolved in a real run, producing
`lead nw_q96aczht tier enterprise for Meridian Group`.

## A single token keeps its type

A string that is *only* a token keeps the raw value - an array stays an array,
a number stays a number:

```text
{{steps.query.output.items}}       →  ["a","b","c"]
found {{steps.query.output.count}} →  "found 3"
```

The second is interpolation, so it is a string. That distinction matters when
you feed a value into a `loop` or an action expecting a list.

## A missing path is empty, never an error

```text
{{trigger.nope.deep}}   →  ""
```

Flow does not throw on a path that is not there. That keeps a flow running when
one optional field is absent - and it means a branch that silently never
matches is usually a misspelled path. When a value matters, test it with a
condition rather than assuming.

## Where output comes from

Two different things share the word:

- **Runtime output** - what a node actually returned. This is what
  `{{steps.…}}` reads.
- **Declared output metadata** - what a contributed action *says* its result
  contains, so the builder can offer the tokens. It never changes the value.

Metadata is `{ key, label?, type? }`, where `key` is a dot-path into the
result - `lead.id`, `response.status`. Declaring it is optional; a `code` step
declares nothing and its output is simply opaque to the picker while remaining
fully readable by hand.

See [Flow contributions](/extend/flow-contributions) for declaring it.

## Related

- [Logic nodes](/extensions/flow/logic)
- [Runs and history](/extensions/flow/runs)
