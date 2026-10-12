---
title: Forms and Flow
description: Branching a flow on what somebody submitted, and what the platform deliberately does not put on the event bus.
audience: site-developer
type: guide
status: stable
package: "@tangen/ext-flows"
lastVerified: 2026-09-02
verification: executable
verifiedBy: flow-remediation/external#two-branches
---

# Forms and Flow

A form submission can start a flow, and that flow can branch on what was
submitted.

## The trigger

Choose **Form submitted** and name the form. The trigger resolves the
submission and puts it on the scope:

```ts
trigger.submission = {
  id: 'sub_1',
  formId: 'frm_1',
  formSlug: 'request-a-demo',
  values: { company: 'Meridian Group', companySize: '500+', businessEmail: '…' },
  createdAt: '2026-09-02T00:00:00.000Z',
}
```
Every submitted field is under `values`, keyed by the field's `name`.

**Only declared fields arrive.** The submit route is public, so the pipeline
drops any key that is not one of the form's fields before it stores, notifies
or emits. A flow condition on something the form does not declare will never
match - add it as a `hidden` field on the form if the site needs to carry it
through.

## Branching on a value

A condition reads the same dot-path any other Flow expression uses:

```text
trigger.submission.values.companySize   eq   500+
```
and an action interpolates it:

```text
ENTERPRISE lead from {{trigger.submission.values.company}}
```
A worked run, from a public submission with no credential:

```text
submit { company: "Meridian Group", companySize: "500+" }
  → gate      condition   → yes
  → lead      crm_create_lead   { leadId: "nw_iuctpr90" }
  → hot       log   "ENTERPRISE Meridian Group lead nw_iuctpr90"

submit { company: "TinyCo", companySize: "1-50" }
  → gate      condition   → no
  → cold      log   "standard TinyCo size 1-50"
```
## What the event carries, and what it does not

The `form.submitted` event is **identifiers only**:

```ts
{ formId, formSlug, submissionId }
```
Submitted values are not on it, and that is deliberate. Every subscriber to the
event bus - webhooks included - would otherwise receive the contents of every
form on your site.

Flow resolves the values itself, **after** it has matched a flow to the event.
An unrelated event costs nothing, and a workspace with no form flows never reads
a submission at all.

## When there is nothing to resolve

A deleted submission, or a lookup that fails, leaves `trigger.submission`
undefined and the flow runs anyway. Conditions reading a missing path evaluate
against an empty value rather than throwing, so a flow degrades instead of
erroring. If a branch matters, test the field you depend on.

## Related

- [Flow security and retention](/extensions/flow/security) - **read this before
  logging a submitted value**
- [Forms](/extensions/forms)
- [Reading a submission](/reference/sdk#forms) - resolving one yourself
