---
title: Triggers
description: What can start a flow, what each kind puts on the trigger scope, and what that means for security.
audience: site-developer
type: reference
status: stable
package: "@tangen/ext-flows"
lastVerified: 2026-09-06
verification: source
verifiedBy: extensions/flows/src/server.ts
---

# Triggers

Every flow has exactly one trigger. It decides when the flow runs and what
`{{trigger.…}}` contains.

## Platform events

Thirteen event types, from content, media, members and site users:

```text
object.created     object.updated     object.published
object.unpublished object.deleted     object.scheduled
media.uploaded
member.invited     member.created     member.updated
form.submitted
site_user.registered   site_user.login
```

For a content event the trigger carries the live row as `trigger.data`, the
object's identity as `trigger.typeName` and `trigger.objectId`, its operational
labels as `trigger.labels`, and - for an update - the changed field names as
`trigger.changed` and their previous values under `trigger.prev`.

```text
{{trigger.data.title}}
trigger.changed contains price
```

A content trigger can be narrowed to one content type, and to a condition, so a
flow on "published" need not wake for every publish.

## Form submitted

`form.submitted` resolves the submission, giving
`trigger.submission = { id, formId, formSlug, values, createdAt }`. This has its
own page, because what does and does not travel matters:
[Forms and Flow](/extensions/flow/forms-integration).

## Manual

Runs only when someone presses Run. The right trigger while you are building,
and for anything an operator invokes deliberately.

## Schedule

Runs on a recurrence rather than an event. The run's `triggerType` records that
it was scheduled, and cancelling a flow's schedule cancels its parked runs.

## Webhook

An external system starts the flow by calling a per-flow URL. Treat that URL as
a credential: anyone who has it can start the flow.

## Extension triggers

An extension declares its own event types, namespaced `ext:<id>:<name>`:

```text
ext:crm:lead-created
```

They appear alongside the built-in ones once the contributing extension is
active in that workspace, and disappear when it is not. Their payload is
whatever the extension emitted, read as `{{trigger.payload.…}}` - proven with a
flow that branched on `trigger.payload.tier`.

A site can declare `custom:` types the same way without writing an extension -
see [site helpers](/reference/flow-contract).

## What a trigger does not do

A trigger does not authenticate anything. Who a run acts as is the flow's
`runAs`, not the trigger: `owner` (the default) runs with the current authority
of the member who owns the flow, `initiator` runs as the member or key whose
event triggered it (and refuses an event with nobody behind it, such as a public
form submission), and `identity` runs as a service or agent identity. A flow
never holds rights of its own: if its owner may not publish, the flow's publish
step is refused, and an owner who was suspended or lost the grant makes the run
fail with `AUTHORITY_LOST` rather than fall back to elevated rights. The run
record names the actor and the initiator.

## Related

- [Forms and Flow](/extensions/flow/forms-integration)
- [Flow contributions](/extend/flow-contributions)
