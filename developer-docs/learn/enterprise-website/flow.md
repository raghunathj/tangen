---
title: Automate demo requests with Flow
description: Route a demo request by company size, branching on what the visitor actually submitted.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g6/ch11
---

# 11. Automate demo requests with Flow

**Goal** an enterprise-sized demo request routed differently from everyone
else, triggered by a real public submission.

**Prerequisites** [chapter 10](/learn/enterprise-website/forms).

## What we are building

```text
Request a Demo submitted
        │
   companySize = '500+' ?
        ├── yes → the field team
        └── no  → the standard queue
```

This is the chapter where the site stops being a set of separate features. The
form from chapter 10 feeds an automation, with no glue code in between.

## Install Flow

Flow ships with the platform and is already declared in
`app/config/extensions.ts`. Installing and enabling is per deployment:

```bash
bun x tangen extension install flows
bun x tangen extension list
```

## The submission arrives whole

The trigger payload carries the submission **hydrated**, not just its id:

```ts
trigger.submission = { id, formId, formSlug, values, createdAt }
```

So the condition reads the answer directly. No lookup step, no code step:

```ts scripts/flow.ts
const flow = {
  version: 2,
  name: 'Route demo requests',
  enabled: true,
  nodes: [
    { id: 'start', kind: 'trigger', position: { x: 0, y: 0 },
      data: { type: 'form.submitted', formSlug: 'request-a-demo' } },
    // The submission arrives HYDRATED: trigger.submission carries id, formId,
    // formSlug, createdAt and the submitted `values`. So the branch reads the
    // answer directly - no code step needed to fetch or reshape anything.
    { id: 'gate', kind: 'condition', position: { x: 0, y: 100 },
      data: { conditions: [{ path: 'trigger.submission.values.companySize', op: 'eq', value: '500+' }] } },
    { id: 'hot', kind: 'action', position: { x: -160, y: 220 },
      data: { action: 'log', config: {
        message: 'ENTERPRISE demo request from {{trigger.submission.values.company}} ({{trigger.submission.values.businessEmail}}) - route to the field team',
      } } },
    { id: 'standard', kind: 'action', position: { x: 160, y: 220 },
      data: { action: 'log', config: {
        message: 'demo request from {{trigger.submission.values.company}} (size {{trigger.submission.values.companySize}}) - standard queue',
      } } },
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'gate' },
    { id: 'e2', from: 'gate', to: 'hot', outlet: 'yes' },
    { id: 'e3', from: 'gate', to: 'standard', outlet: 'no' },
  ],
}
```

Two shapes to note. A condition's `path` is a plain expression path with no
braces. A message uses `{{…}}` because it interpolates into text. They address
the same data.

`log` is the honest placeholder here. Swap it for `email` or `http` when you
have somewhere to send this, and nothing else in the flow changes.

## Create it

```bash
API=http://localhost:3000/api/v1 TOKEN=$TOKEN bun scripts/flow.ts
```

Flow's admin routes are under `/api/v1/admin/ext/flows/` and are
member-authenticated. `/api/v1/ext/*` mounts only public and key routes, which
is why these are not there.

## Run it for real

Submit the form twice, from the site or with curl: once with `companySize:
"500+"`, once with `"1-50"`.

## Expected result

```text
completed | path: start->gate->hot
    gate     : {"result": "yes"}
    hot      : {"message": "ENTERPRISE demo request from Harbourline Freight (dana@harbourline.test) - route to the field team"}

completed | path: start->gate->standard
    gate     : {"result": "no"}
    standard : {"message": "demo request from Tidecraft (size 1-50) - standard queue"}
```

`path` is the route the run actually took, which is the fastest way to see which
branch ran.

## Verification

- two runs exist, one per branch
- each run's `path` ends at a different node
- the message contains the company the visitor typed

## Common mistake

**Ignoring the message on a refused graph.** A graph Flow cannot enable comes
back as a `422` whose message is the whole diagnosis: "Loop node l needs its
'body' outlet connected", "The action 'x' on node a is not available in this
environment". It names the node, so read it before changing anything else.

## Relevant canonical docs

- [Flow](/extensions/flow) - concepts, logic, actions, triggers, runs
- [Flow: Forms integration](/extensions/flow/forms-integration) - the trigger contract
- [Flow reference](/reference/flow) - node kinds, operators, limits
- [Flow contributions](/extend/flow-contributions) - adding your own actions
