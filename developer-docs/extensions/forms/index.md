---
title: Forms
description: Defining forms in code or the Admin, rendering them, and handling submissions.
audience: site-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-01
verification: executable
verifiedBy: stage-f/northwind#forms
---

# Forms

> Forms is a **core capability**, not an installed extension - so it is enabled
> differently from SEO or Flow. Run `tangen extension install forms` once; there is no
> `tangen extension install` step. See [Extensions](/extensions) for how the two
> mechanisms differ.


Forms is a **built-in capability**, not an extension. There is nothing to
install: configure it, and it is there.

A form has fields, validation and submissions. Editors can build one in the
Admin; you can define one in code. Both end up in the same place.

## Define one in code

```ts app/forms/newsletter.ts
import { defineForm } from '@tangen/cms'

export const newsletterForm = defineForm({
  name: 'Newsletter signup',
  slug: 'newsletter-signup',
  isLive: true,
  fields: [
    { id: 'email', type: 'email', name: 'email', label: 'Email', required: true, placeholder: 'you@example.com' },
    { id: 'name',  type: 'text',  name: 'name',  label: 'Name' },
    {
      id: 'frequency', type: 'radio', name: 'frequency', label: 'How often?',
      options: [
        { label: 'Weekly', value: 'weekly' },
        { label: 'Monthly', value: 'monthly' },
      ],
    },
  ],
})
```
```ts app/forms/index.ts
import { newsletterForm } from './newsletter'

export default [newsletterForm]
```
`tangen push` upserts each definition on its slug. A code-first form is
**read-only in the Admin builder** - code is its source of truth.

## Dynamic options

Options can be a function, resolved server-side at render and submit:

```ts
{
  id: 'topic', type: 'select', name: 'topic', label: 'Topic',
  options: async ({ tangen }) => {
    const r = await tangen.objects('category').status('published').limit(50).get()
    return r.data.map((c) => ({ label: c.title, value: c.slug ?? c.id }))
  },
}
```
The function is stripped at push and never reaches the browser.

## Render it

Fetch the schema and render it with your own components:

```ts
const res = await fetch(`${API}/api/v1/forms/newsletter-signup/schema`, {
  headers: { Authorization: `Bearer ${key}` },
})
const { data: form } = await res.json()
// form.fields → id, type, name, label, required, placeholder, options
```
Needs `forms: read`. Tangen gives you the definition; the markup is yours.

## Submit

```ts
await fetch(`${API}/api/v1/forms/newsletter-signup/submit`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, name, frequency }),
})
```
Needs `forms: submit` - a separate action from `read`, so a public key can
submit without listing submissions.

Validation runs server-side against the definition. A `422 VALIDATION_ERROR`
names each field. **Validate in the browser for the experience, and never trust
it** - the server's answer is the one that counts.

## When a form is closed

| code | means |
|---|---|
| `FORM_DISABLED` | the form is not live |
| `FORM_CLOSED` / `FORM_NOT_OPEN` | it exists and is not accepting submissions |
| `ENTRY_LIMIT` | it reached its configured submission limit |

These are not your bug. Render the message the form is configured with.

## Reading submissions

```ts
const res = await fetch(`${API}/api/v1/forms/newsletter-signup/submissions`, {
  headers: { Authorization: `Bearer ${key}` },
})
```
Needs `forms: read`. **Do not give a public frontend key that action** - it is
everyone's email addresses.

## Hooks

Run code after a submission - send mail, create content, call another system:

```ts app/forms/index.ts
import { defineFormHooks } from '@tangen/cms'

export default [
  defineFormHooks('contact-us', {
    afterSubmit: async (submission, form, ctx) => {
      // runs as a queued job; ctx has a Tangen client for content changes
    },
  }),
]
```
`defineFormHooks` attaches to **any** form by slug, including one an editor
built in the Admin, without creating a definition.

## Notifications

Form notification email goes through the workspace mailer - `config/mail.ts`.
Without a transport configured, notifications do not send.

## Common mistakes

- **Calling it "the Forms extension."** It is a capability.
- **Editing a code-first form in the Admin.** It is read-only there.
- **Giving a public key `forms: read`** when it only needs `submit`.
- **Trusting client-side validation.**

## Related

- [Delivery API](/reference/delivery-api) · [Permissions](/reference/permissions)
  · [Errors](/reference/errors) · [Configuration](/reference/configuration)
