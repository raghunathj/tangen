---
title: Getting started with Flow
description: Build a flow that runs, read its run log, and reference one node's output from another.
audience: site-developer
type: guide
status: stable
package: "@tangen/ext-flows"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g5/getting-started
---

# Getting started with Flow

You will build a flow with a manual trigger, a step that computes something,
and a step that reads what the first one produced. It needs no external
service.

## Before you start

Flow must be installed on the deployment you are working on:

```bash
tangen extension install flows
tangen extension list
#  flows   Flows   installed, enabled
```

## The flow

Three nodes:

```text
manual trigger  →  transform  →  log
```

**Trigger** - choose *Manual*. It starts only when you press Run, which is what
you want while building.

**Transform** - a node that builds an object out of expressions without calling
anything. Give it:

```json
{ "greeting": "hello", "answer": 42 }
```

**Log** - reads the transform's output:

```text
{{steps.shape.output.greeting}} the answer is {{steps.shape.output.answer}}
```

`shape` is the transform node's id. Every reference is
`{{steps.<nodeId>.output.<field>}}`, so give your nodes ids you will recognise.

Connect trigger → transform → log, and enable the flow.

## Run it

Press **Run**. Then open the run:

```json
{
  "status": "completed",
  "path": ["start", "shape", "done"],
  "log": [
    { "step": "shape", "action": "transform", "ok": true, "ms": 0, "output": { "greeting": "hello", "answer": 42 } },
    { "step": "done",  "action": "log", "ok": true, "ms": 1, "attempt": 1, "output": { "message": "hello the answer is 42" } }
  ]
}
```

`path` is the route the run actually took - the fastest way to see which branch
ran. `log` is one entry per step with its output and duration.

## Try it without doing it

A flow that calls something real can be tested without calling it:

```text
POST /api/v1/admin/ext/flows/flows/<id>/test
```

Write-actions are simulated. An `http` node makes no request and returns

```json
{ "dryRun": true, "wouldDo": { "url": …, "method": … }, "response": { "status": 200, "body": {} } }
```

That `response` is a **stub, always 200**. A downstream branch on
`{{steps.fetch.output.response.status}}` therefore takes the success path in
every test run - a test proves the shape of your flow, not how it behaves when
the call fails. Read [Testing a flow](/extensions/flow/runs#testing).

## What you just used

`{{steps.<id>.output.…}}` is the whole data model, and it works the same for a
transform, an HTTP response, a code step or a contributed action. The next page
is that model in full.

## Related

- [Data and expressions](/extensions/flow/concepts)
- [Triggers](/extensions/flow/triggers) - replacing Manual with something real
