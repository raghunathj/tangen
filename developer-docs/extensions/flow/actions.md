---
title: Actions
description: The built-in actions, the code sandbox, HTTP and its network guard, and calling one flow from another.
audience: site-developer
type: reference
status: stable
package: "@tangen/ext-flows"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g5/nodes
---

# Actions

## The built-in set

| action | does | output |
|---|---|---|
| `http` | an outbound request | `response.status`, `response.body` |
| `content` | create, update or publish content | `updated.typeName`, `updated.objectId`, `result` |
| `query` | read content | `count`, `items` |
| `email` | send mail | `sent.to`, `sent.subject` |
| `label` | add or remove an operational label | `entityType`, `entityId` |
| `run_flow` | run another flow | the child flow's output |
| `log` | write a line into the run history | `message` |
| `code` | run JavaScript in a sandbox | whatever you return |

Extensions add more, and they behave the same way -
[Flow contributions](/extend/flow-contributions).

## HTTP, and the network guard

```text
method: POST
url:    https://api.example.com/hook
headers, body: JSON, with {{tokens}}
```

**Private and loopback addresses are refused.** A flow pointed at
`http://localhost:3990/api/health` fails with:

```text
http action refuses private/loopback targets (localhost)
```

That guard is on by default and exists so a flow cannot be turned into a probe
of your internal network. A workspace can lift it for local development:

```ts
{ resolve: '@tangen/ext-flows' }
// then, in the Admin: Settings, Extensions, Flows, "Allow private networks" - it
// takes effect only under the optional network:private grant
// (tangen extension upgrade flows --approve-optional network:private)
```

With it set, the same flow reaches the address and reports the real response.
Leave it off in production.

The guard is about *destination*, not authentication. It does not inspect
bodies or redact headers you supply.

## Code

`code` runs your JavaScript in a **QuickJS WebAssembly isolate**. It is not
server-side Node.

```js
return { doubled: input.steps.a.n * 2 }
```

- `input` holds `{ trigger, steps, item?, itemIndex? }`.
- Your return value becomes the step's output. A primitive or array is wrapped
  as `{ value: … }`; an object is used as-is; returning nothing gives `{}`.
- **You cannot return a promise.** The isolate is synchronous and has nothing
  to await; a promise is refused by name.

Measured limits and absences:

| | |
|---|---|
| CPU | interrupted at ~1 second |
| output | refused over **64KB** |
| memory | bounded; an unbounded allocation is stopped |
| `process`, `Bun`, `require`, `fetch`, `XMLHttpRequest`, `WebSocket`, `setTimeout` | all `undefined` |
| `import(...)` | refused |

A real run confirms it: `typeof process` returns `"undefined"` inside a code
step. Use `code` for shaping and arithmetic. For anything that must reach the
world, use `http` or an extension action.

> This is an isolate, not a defence against a QuickJS or WebAssembly escape.
> What is guaranteed is that Flow passes no host object across the boundary and
> grants no host global.

## Subflows

`run_flow` runs another flow and returns its output:

```text
flowId: fl_…
```

The child's output is the step's output **directly**:

```text
{{steps.call.output.echoed}}
```

not nested under a second `output`. A parent that ran a child returning
`{ echoed: 'child ran' }` read exactly that.

**Depth is limited to 5.** Exceeding it fails the run with a message naming
recursion. A child containing a `wait` cannot be used as a subflow, and says so
rather than hanging.

## Content and query

`content` writes and `query` reads, both through the same content model your
site uses - a flow cannot see anything an API key could not. Content actions
default to the object that triggered the flow, so a flow on "any content type"
can label or update whatever fired it without naming the type in advance.

## Related

- [Runs, retries and failures](/extensions/flow/runs)
- [Security and retention](/extensions/flow/security)
