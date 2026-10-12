---
title: Custom field types
description: Adding a field type by inheriting a built-in primitive.
audience: extension-developer
type: guide
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g8/cardfield
---

# Custom field types

An extension can add a field type - a `credit_card` that stores like text,
validates with Luhn and renders a masked input - without patching the platform.

**A custom type never invents storage.** It declares which built-in primitive
it `inherits`, and gets that primitive's column, baseline validation, Delivery
representation and TangenQL behaviour for free.

## Declare it

```ts tangen.extension.ts
fieldTypes: [
  {
    name: 'credit_card',
    label: 'Credit card',
    inherits: 'text',
    configSchema: { /* the options a site developer may set */ },
  },
],
```

A site developer then uses it by naming the type. **There is no
`field.credit_card()` builder** - the `field.*` builders exist for the 28
built-ins, and a custom type is authored as a plain field object:

```ts app/content-objects/order/schema.ts
fields: {
  card: { label: 'Card', fieldType: 'credit_card', config: {}, required: false },
},
```

The Admin's schema builder writes exactly this shape when an editor picks your
type, so most projects never type it by hand.

## Server behaviour

```ts src/server.ts
export default {
  fieldTypes: {
    credit_card: {
      validate: (value) => (luhn(String(value)) ? null : 'Not a valid card number'),
    },
  },
} satisfies TangenExtensionServer
```

Your validation runs **after** the inherited primitive's, so you never re-check
that a text value is a string.

## Admin editor

The editor is a named export of your browser entry, registered as a field-type
UI. It receives the value and an onChange, and it is an ordinary React
component - the same rules as any
[Admin contribution](/extend/contributions/admin) apply, including that the
browser entry must be browser-safe.

## What you inherit, and what you do not

| | |
|---|---|
| **storage** | the primitive's column. `inherits: 'text'` is a `TEXT` column |
| **Delivery** | the primitive's representation |
| **TangenQL** | the primitive's operators. A `text`-inheriting type filters with `contains`, `startsWith` and the rest |
| **generated types** | the primitive's TypeScript type |
| **validation** | the primitive's, then yours |

Because the storage is a primitive's, you **cannot** invent a new query
behaviour, a new index or a new column type. Choose the primitive that matches
what you actually store: `text` for a formatted string, `number` for a
quantity, `json` for a structure.

## When to build one

Build one when the **semantics** differ, not only the input. A masked input over
`text` is a custom type; a text field with a different placeholder is a config
option.

If it would only ever be used once, in one project, it is a `text` field with
validation.

## Testing

```ts
import server from '../src/server'

const validate = server.fieldTypes!.credit_card.validate!

it('accepts a valid number and rejects a mistyped one', () => {
  expect(validate('4111111111111111')).toBeNull()
  expect(validate('4111111111111112')).toBeTruthy()
})

it('never echoes the rejected value in its message', () => {
  expect(String(validate('4111111111111112'))).not.toContain('4111')
})
```

## Related

- [Fields reference](/reference/fields) - the 28 primitives you may inherit ·
  [Admin contributions](/extend/contributions/admin) ·
  [Server contributions](/extend/contributions/server)
