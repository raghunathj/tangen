---
title: Reading submissions
description: Who may read a form submission, and the narrow accessor that resolves one by id.
audience: site-developer
type: reference
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-f/northwind#submission-access
---

# Reading submissions

## Who may read one

| caller | result |
|---|---|
| a member with the grant | the submissions |
| a Delivery API key | **403** |
| nobody | **401** |

A Delivery key is for reading published content. It cannot read what people
submitted, whatever its other scopes say. This is not configurable, and it is
why a public frontend never holds a key that could.

## Resolving one by id

Server-side code with a Tangen client - a custom route, a content hook, an
extension - can resolve a single submission:

```ts
const submission = await tangen.forms.submission(submissionId)
// {
//   id: 'sub_1',
//   formId: 'frm_1',
//   values: { company: 'Meridian Group', companySize: '500+' },
//   createdAt: '2026-09-02T00:00:00.000Z',
// }
```
Scoped to the client's own workspace. That scoping is not a
filter you can widen - a submission from another workspace is simply not
found.

### What it returns, and what it leaves behind

Returned: `id`, `formId`, `values`, `createdAt`.

Deliberately not returned: the submitter's IP address, the request metadata
(user agent, captcha score), and the internal `notes` field. Those are
operational and lead-management data. Something reacting to a submission needs
what was submitted, not who submitted it from where.

### Missing submissions

`null`. A deleted id, an id from another workspace, a malformed id and an
empty string all return `null` rather than throwing, so a caller handles one
case instead of four.

## Why this exists

The `form.submitted` event carries identifiers only, on purpose: values must not
ride the general event bus where every subscriber would see them. Something with
the id and the authority resolves them here.

Flow uses exactly this to hydrate its trigger - see
[Forms and Flow](/extensions/flow/forms-integration).

## Related

- [Forms](/extensions/forms)
- [Flow security and retention](/extensions/flow/security)
