---
title: Add contact and demo forms
description: Two forms, rendered from a public schema and submitted without a credential.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g6/ch10
---

# 10. Add contact and demo forms

**Goal** Contact Us and Request a Demo on the site, validated and storing
submissions.

**Prerequisites** [chapter 9](/learn/enterprise-website/localization).

## What we are building

**Contact Us**: name, email, company, message.

**Request a Demo**: name, business email, company, role, **company size**,
country, message. That company size field is not decoration. Chapter 11 branches
on it, and this is where the two capabilities meet.

## Enable Forms

Forms is a built-in capability, not an installed extension, so it is `enable`
and not `extension install`:

```bash
bun x tangen extension install forms
```

## Define them

A form is data, created through the API:

```ts scripts/forms.ts
const forms = [
  {
    name: 'Request a Demo', slug: 'request-a-demo',
    fields: [
      f('n', 'text', 'name', 'Your name', { required: true }),
      f('e', 'email', 'businessEmail', 'Business email', { required: true }),
      f('c', 'text', 'company', 'Company', { required: true }),
      f('r', 'text', 'role', 'Role'),
      f('s', 'select', 'companySize', 'Company size', { required: true, options: [
        { label: '1-50', value: '1-50' }, { label: '51-500', value: '51-500' }, { label: '500+', value: '500+' },
      ] }),
      f('m', 'textarea', 'message', 'What would you like to see?'),
    ],
    settings: { notifications: [], uniqueBy: 'none', successTitle: 'Request received', successMessage: 'An architect will contact you.', submitButtonText: 'Request a demo' },
  },
]

const body = { ...form, isLive: true }
await call('POST', '/forms', body)
```

`isLive` is what makes the public schema route answer. A form that is not live
exists and still 404s to your frontend.

## Rendering one

The schema route is **public**: no credential, and it takes the slug. This is
what a frontend uses, and a delivery key correctly cannot list forms:

```ts web/server.ts
  const schema = await fetch(`${base}/api/v1/forms/${encodeURIComponent(slug)}/schema`)
    .then((r) => (r.ok ? r.json() : null)).catch(() => null) as any
  const f = schema?.data ?? schema
  if (!f?.fields) return '<p>Form unavailable.</p>'
```

The response carries a `submitUrl`. **Use it** rather than composing one:

```ts
`<form method="post" action="${form.submitUrl}">…</form>`
```

## Submitting

```bash
curl -X POST http://localhost:3000/embed/forms/<id>/submit \
  -H 'content-type: application/json' \
  -d '{"name":"Dana Reyes","businessEmail":"dana@harbourline.test",
       "company":"Harbourline Freight","companySize":"500+","country":"GB"}'
```

Public, no credential, a flat body. A missing required field comes back keyed by
field name, using your labels:

```json
{ "error": { "code": "VALIDATION_ERROR", "status": 400, "fieldErrors": {
  "businessEmail": "Business email is required",
  "companySize": "Company size is required" } } }
```

## Who can read submissions

| caller | result |
|---|---|
| anonymous | `401` |
| a delivery key | `403` |
| a member | `200` |

The public half of Forms is deliberately narrow: render the schema, accept a
submission. Everything else is behind an admin session.

## Expected result

`/company/contact` renders both forms with eleven inputs between them. A valid
demo submission returns your success message.

## Verification

- `GET /api/v1/forms/request-a-demo/schema` answers with **no** credential
- a submission missing required fields returns `400` naming each one
- a valid submission returns `submitted: true`
- the submissions list is `401` anonymous, `403` with a delivery key, `200` as a
  member

## Common mistake

**Composing the submit URL.** It is on the schema response. The embed path
differs from the API path, and guessing it produces a 404 that looks like a
disabled form.

## Relevant canonical docs

- [Forms](/extensions/forms) - fields, validation, notifications, settings
- [Forms: submissions](/extensions/forms/submissions) - reading and exporting
- [Permissions](/reference/permissions)
