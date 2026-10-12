---
title: Logic nodes
description: Condition, switch, transform, loop and wait - the nodes that decide and shape rather than call.
audience: site-developer
type: reference
status: stable
package: "@tangen/ext-flows"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g5/nodes
---

# Logic nodes

## Condition

A yes/no branch. Two outlets: **yes** and **no**.

```text
path:  trigger.submission.values.companySize
op:    eq
value: 500+
```

Operators:

| operator | true when |
|---|---|
| `eq` | equal |
| `neq` | not equal |
| `gt` · `lt` | greater / less than |
| `contains` · `not_contains` | the value contains the operand |
| `exists` | the path resolves to something |

Several conditions on one node are combined; a path that is missing simply does
not match, so `exists` is how you ask whether a field arrived at all.

## Switch

A many-way branch on one value.

```text
path:  trigger.payload.tier
cases: ["enterprise", "1-50"]
```

Each case gets an outlet named `case:<value>`; anything unmatched takes
`default`. Connect the outlets you care about - an unconnected branch ends the
run, which is normal.

A real run: `{"value": "enterprise", "outlet": "case:enterprise"}`.

## Transform

Builds an object from expressions. It calls nothing, which makes it the right
place to reshape data between two nodes:

```json
{ "queue": "priority", "lead": "{{trigger.payload.leadId}}" }
```

Output: `{"lead": "nw_6ea0icx5", "queue": "priority"}`, read downstream as
`{{steps.shape.output.queue}}`.

## Loop

Runs its body once per item.

```text
path: steps.seed.output.rows
```

The body connects on the **`body`** outlet - a loop with nothing on `body` is
refused when you enable the flow, by name.

Inside the body, `{{item}}` is the element and `{{itemIndex}}` is its position.
Steps are logged per iteration:

```text
path: ["start","seed","each","body","body","body"]
  each         loop       { "items": 3 }
  body[0]      log        { "message": "item 0 = a" }
  body[1]      log        { "message": "item 1 = b" }
  body[2]      log        { "message": "item 2 = c" }
```

**A loop runs at most 20 items.** A longer collection is truncated and the run
records `truncatedFrom`, so a silent partial pass is visible rather than
guessed at. An empty collection runs the body zero times and continues.

## Wait

Parks the run and resumes it later.

```text
minutes: 1        (also hours, days - they add up)
```

**The minimum is 60 seconds.** A shorter wait is rounded up to it.

The run's status becomes `waiting` and stays that way until it is due; then it
continues from the node after the wait. Proven end to end: a run parked at
`["start","pause"]`, and on resume logged `resumed after 60s` from
`{{steps.pause.output.waited}}`.

A parked run survives a restart - the wait is durable queue state, not a timer
in memory.

> If a flow started by a form waits, the submission is resolved again on
> resume, from the small event. It is not carried in the parked state. See
> [Forms and Flow](/extensions/flow/forms-integration).

## Related

- [Actions](/extensions/flow/actions)
- [Data and expressions](/extensions/flow/concepts)
