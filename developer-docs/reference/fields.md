---
title: Fields
description: All 28 built-in field types, their configuration, storage, localization and query behaviour.
audience: site-developer
type: reference
status: stable
package: "@tangen/cms"
lastVerified: 2026-09-01
verification: source
verifiedBy: developer-docs/.generated/platform-facts.json
---

# Fields

A content type declares its fields as an **object map**: the key is the field
name, the value is a `field.*` builder.

```ts app/content-objects/article/schema.ts
import { defineObjectType, field } from '@tangen/cms'

export default defineObjectType({
  name: 'article',
  label: 'Article',
  fields: {
    subtitle: field.text({ label: 'Subtitle', validation: { required: true }, localized: true }),
    body: field.richtext({ label: 'Body', localized: true }),
    heroImage: field.media({ label: 'Hero image', config: { mimeTypes: ['image/jpeg', 'image/webp'] } }),
    publishedAt: field.date({ label: 'Publish date' }),
  },
})
```

`title`, `slug`, `status`, `createdAt`, `updatedAt` and `publishedAt` are
system fields - you do not declare them.

## Every builder takes one object

```ts
field.text({ label: 'Subtitle', validation: { required: true } })
```

The field's **name is the key**, never an argument.

A field may also be written as a **plain object**, which is what the Admin's
schema builder emits and the only form available for an extension-contributed
custom type, since `field.*` covers the built-ins only:

```ts
fields: {
  bio: { label: 'Short bio', fieldType: 'text', config: {}, required: false },
},
```

Options common to every builder:

| option | type | means |
|---|---|---|
| `label` | `string` | **required.** What the editor shows |
| `localized` | `boolean` | this field's value may differ per locale |
| `index` | `boolean` | give this field's column a database index. See below |
| `disabled` | `boolean` | soft-disable: keep the column and the data, hide the field from the Admin, REST, TangenQL and GraphQL. Reversible; `push` keeps the column |
| `previousName` | `string[]` | former names, so a rename moves data instead of dropping it |
| `validation` | rules | per-type validation |
| `admin` | object | editor presentation: `helpText`, `width`, and so on. See [the editor grid](#the-editor-grid) |
| `config` | object | the type's own options (`default`, `options`, `accept`, `targetType`, `min`, `max`, `fields`, `components`, `ai`, …). They live here and only here; writing one at the top level is a compile error, and `tangen check` names the place |
| `hooks`, `validate` | functions | per-field lifecycle and custom validation |

## The 28 types

### Text

| type | stores | notable options |
|---|---|---|
| `text` | a single line | `minLength`, `maxLength`, `pattern` |
| `textarea` | multiple lines | `maxLength` |
| `richtext` | structured rich text | - |
| `slug` | a URL-safe identifier, **unique per type** | `source` names the sibling field the Generate button derives from |
| `email` | an address, format-validated | - |
| `url` | a URL. `javascript:`, `vbscript:`, `data:`, `blob:`, `filesystem:` and `file:` are always refused, since a stored URL becomes an `href` | no scheme allow-list; use [`link`](/reference/link) when you need one |
| `phone` | a phone number | - |
| `code` | source code | `language` |

### Numeric

| type | stores |
|---|---|
| `number` | an integer or decimal |
| `range` | **two** numbers, `min` ≤ `max`, in one `numrange` column |
| `currency` | an amount with a currency |
| `rating` | a bounded score |

### Choice

| type | stores |
|---|---|
| `boolean` | true or false |
| `select` | one of a fixed option list |
| `multiselect` | several of a fixed option list, as an array |
| `tags` | free-form strings |

### Time

| type | stores |
|---|---|
| `date` | a date, or a date and time |
| `time` | a time of day |

### Structure

| type | stores |
|---|---|
| `group` | named sub-fields, **flattened into columns** on the same row |
| `component` | one or more instances of a reusable component definition |
| `repeater` | an ordered list of rows, each with the same sub-fields |
| `object` | a reference to another content object, selectable across types |
| `json` | arbitrary JSON |

### References

| type | stores |
|---|---|
| `relation` | a reference to one or many objects of a target type |
| `link` | a destination: content identity, or an external URL. See [Link](/reference/link) |
| `media` | one media asset |

### Other

| type | stores |
|---|---|
| `color` | a colour value |
| `geopoint` | a latitude and longitude |

## The editor grid

The editor lays fields out on a **six-column grid**, and `admin.width` picks the
span.

| `admin.width` | span |
|---|---|
| absent | **full.** This is the default; a field with no width takes the whole row |
| `'full'` | the whole row |
| `'half'` | three of six, so two sit side by side |
| `'third'` | two of six, so three sit side by side |

Absent means full, not half. A structured field (a repeater, a component, a
group, a media field) is readable only at full width, so leaving `width` off is
usually right and declaring `'half'` is the deliberate choice.

**One mapping, four surfaces.** The same grid lays out the object editor, the
globals sheet, a repeater row and a component block's card, so a sub-field's
declared width means the same thing wherever it is authored.

One field cannot be narrowed: a repeater or a component nested INSIDE a
repeater row or a block card always spans the row, whatever it declares,
because a container in a half column cannot be authored.

### Admin options on a sub-field

A **raw sub-field** (a repeater's `config.fields`, a component block's `fields`)
takes its admin options in either place, and the top-level one wins:

```ts
config: { fields: [
  // both of these work
  { name: 'platform', label: 'Platform', fieldType: 'select', admin: { width: 'half' }, config: { options: [] } },
  { name: 'url', label: 'URL', fieldType: 'url', config: { admin: { width: 'half', helpText: 'With https://' } } },
] }
```

A field built with a **`field.*` builder** is the other way round: `admin` is a
top-level option of the builder call, and putting it inside `config` is a type
error that `tangen check` reports. The builder folds it into `config.admin`,
which is where the editor reads it from, so the authored shape and the stored
shape differ by design:

| authoring | `admin` goes |
|---|---|
| `field.text({ ... })` and every other builder | top level of the builder call |
| a raw sub-field in `config.fields` or a block's `fields` | either place, top level wins |
| reading a stored `FieldDefinition` | always `config.admin` |

**`conditionalVisibility` is read from both places too**, and it means the same
inside a container as it does at the top level: the rule is evaluated against
the ROW or the BLOCK the sub-field sits in, the editor draws only the fields
whose rule holds, and the ones it hides are skipped by validation - so a
`required` sub-field behind a rule is mandatory while its branch is chosen and
absent otherwise. That is what makes a discriminator expressible inside a block:

```ts
fields: [
  { name: 'videoSource', label: 'Video', fieldType: 'select',
    config: { options: [{ label: 'MP4 file', value: 'mp4' }, { label: 'YouTube', value: 'youtube' }] } },
  { name: 'videoFile', label: 'Video file', fieldType: 'media', required: true,
    config: {
      accept: ['video'],
      admin: { conditionalVisibility: { field: 'videoSource', operator: 'eq', value: 'mp4' } },
    } },
  { name: 'videoYoutubeId', label: 'YouTube id', fieldType: 'text', required: true,
    admin: { conditionalVisibility: { field: 'videoSource', operator: 'eq', value: 'youtube' } } },
]
```

A hidden sub-field keeps its stored value, exactly as a hidden block does:
switching the discriminator back brings the branch and its value with it. A
collapsed row or card summarises only the branch in use.

**The discriminator can be switched back OFF**, because every select has a
visible way back to empty. Without one an optional select is a one-way door:
`videoSource` empty means "no video", so if the editor cannot get back to empty
the two branch fields above stay on screen and stay required for a video nobody
wanted.

| `admin.displayAs` | the way back |
|---|---|
| `dropdown` (default) | the menu's first row, `None` - or `Use default (X)` where the field declares one |
| `radio` | a radio for that choice, first in the group |
| `segmented` | the pressed button un-presses, and a `✕` sits inside the group while a value is set |

A `segmented` group differs because the control does: a third button reading
`None` beside two real values makes a two-way decision look like a three-way
one. Neither of the others can un-press - a native radio does not un-check and
a dropdown has no pressed thing to click twice - so for them the empty state is
an option. Picking it stores `null` in all three, and it is offered whether or
not the field is `required`: a required select blanked this way goes red and
refuses to publish, the same as any other required field with no value.

### Presentation controls

The platform defines two controls every site wants and nobody should hand-write,
exported as `blockPresentationFields()`:

| Field | What it is |
|---|---|
| `anchorId` | a slug-validated DOM id and URL fragment, for `/about#our-work` |
| `className` | design-system utility classes, applied verbatim |

Both declare `group: 'advanced'`, so they land on a block's Advanced tab, which
is where Gutenberg keeps an HTML anchor and additional CSS classes too. A class
list is never parsed back, the same contract Studio gives its escape-hatch
classes: a class that does not exist simply does nothing, which is what
separates it from a free-form stylesheet field. Its only validation is that it
cannot contain what would close an attribute or open a tag.

A project SPREADS them, usually through one shared function of its own, into
the blocks that want them:

```ts
// app/components/_shared/presentation.ts
import { blockPresentationFields } from '@tangen/cms'

export const sectionPresentation = () => [tone(), spacing(), ...blockPresentationFields()]
export const plainPresentation = () => [...blockPresentationFields()]
```

```ts
// a block takes the one it wants, and says so
export default defineComponent({
  name: 'hero', label: 'Hero',
  fields: [...heroContent, ...sectionPresentation()],
})

// a repeater row is no different
field.repeater({ config: { fields: [...rowFields, ...plainPresentation()] } })
```

**Spread rather than injected, on purpose.** An earlier version declared named
sets in the workspace config and injected them into every block. It worked, and
it was worse: a block's schema file listing six fields while the block had ten
is how an author loses track of their own component. Spreading keeps the file
honest, costs one line, and gives the same "change it once" property, because a
shared function reaches every caller.

Which tones or spacing steps exist is a project's design decision and belongs
in the project. The platform has no business knowing a site is dark by default.

### A sub-field says what it falls back to

A sub-field may declare `config.default`, and the CONTROL states it rather than
a caption beneath it:

| Control | How it shows |
|---|---|
| `select` | the empty choice reads **`Use default (Normal)`** instead of `None` |
| text-ish | the placeholder reads **`Defaults to Normal`**, unless one is authored |

An empty control with a line of text under it reads as broken; a control that
states its own fallback reads as configured, and is still honest, because
nothing is stored until the editor picks a real option. A select's default is
resolved through its option LABELS, since an editor recognises `Normal` and not
the stored `normal`.

It is a HINT and never a write, which matters most on existing content. Add a
control to a block a hundred pages already use and all hundred have no value
for it. Writing the default into them would be a hundred revisions AND would
freeze the value, so changing the design default later would move none of them.
Absent-means-default is what lets one line of code change every page at once,
so the editor's job is to say what absent resolves to, not to fill it in.

The frontend side of that contract: read `block.spacing ?? 'normal'` and never
assume a presentation key is present.

### Grouping a block's fields

A sub-field may declare `group`, and a component block's card arranges the
groups as tabs:

| `group` | tab |
|---|---|
| absent or `'content'` | **Content** |
| `'style'` | **Style** |
| `'advanced'` | **Advanced** |

```ts
fields: [
  { name: 'headline', label: 'Headline', fieldType: 'text', config: {} },
  { name: 'tone', label: 'Tone', fieldType: 'select', group: 'style',
    config: { options: [{ label: 'Dark', value: 'dark' }, { label: 'Light', value: 'light' }] } },
  { name: 'anchorId', label: 'Anchor ID', fieldType: 'text', group: 'advanced',
    config: { validation: { pattern: '^[a-z][a-z0-9-]*$' } } },
]
```

Four things worth knowing:

- **Grouping stores nothing.** `group` classifies a field DEFINITION, so adding
  it to a block is config, not a migration: `tangen diff` reports no schema
  change, the block's stored value stays flat, and **no tab name ever appears
  in REST or GraphQL data**.
- **A tab appears only when it has fields**, so declaring only `content` and
  `advanced` gives two tabs, not three.
- **One kind of field means no tab row at all.** A block whose fields are all
  content looks exactly as it did before tabs existed, and a block whose fields
  are all style gets no lonely single tab either.
- **A required field cannot hide behind a tab.** Until the editor picks a tab,
  one holding a required-empty field is the one that opens, and it is marked.
  After they pick, their choice holds. An error behind an unopened tab is worse
  than no grouping.

These are KINDS, not arrangements. The question they answer is "what sort of
thing is this field" - what it says, how it looks, plumbing - which has the same
three answers for every block. A block whose Content grows long wants a
fieldset WITHIN the tab rather than a fourth tab, because author-declared tabs
would put a classification and a per-block layout choice in the same row. The
same three values classify props for Studio's inspector, so one block reads the
same wherever it is edited.

**Settings are shared across languages, and the tab says so.** A presentation
value belongs to the block, not to a translation of it, so a `style` or
`advanced` field normally omits `localized`. With working locales active, an
open settings tab whose fields are all shared carries a note to that effect,
because a
localized sub-field shows a coloured rail per locale and a shared one shows a
single input, which left nothing saying that the input applies everywhere.

It is a note and not a disabled state on purpose: there is no "edit in German"
mode, the base input IS the default-locale surface, so locking it would mean a
shared value could never be edited while a locale was selected. The server says
the same thing if a locale write carries a shared field: *shared values are
edited in the default locale*.

The exception, so the rule is not overstated: a layout VARIANT chosen because
translated copy runs longer is genuinely per locale. Mark that one field
`localized: true` and the existing overlay carries it.

### Which control a sub-field gets

A repeater row renders ten types with its own compact control (`text`,
`textarea`, `number`, `boolean`, `date`, `select`, `multiselect`, `email`,
`url`, `phone`) and hands **everything else to the same control the field gets
at the top level**, including every extension-contributed field type. So a
`color` sub-field gets its swatch picker, a `link` sub-field gets the
destination chooser, and a `geopoint` gets two bounded number inputs.

This matters beyond looks: a `link` value is an object, and before this a row
edited it as a text box that stored a bare string the link editor read back as
null.

### A sub-field is validated by type

The server runs every row and every block sub-field through the same validator
a top-level value goes through, so a sub-field gets its per-type rules and its
own `validation` config (a `maxLength` inside a row fires), and a nested
repeater or a block inside a block is checked at any depth.

| | |
|---|---|
| **type** | checked on a draft save AND a publish. The draft is what reaches the column, so a wrong shape must never get there |
| **required** | checked on publish only, so a draft may still be incomplete |

A sub-field hidden by its own visibility rule is skipped, because a field
nobody can fill must not block a publish.

## Content AI

A field can say whether Content AI may write it, and what good output looks
like. It goes under `config.ai`, not at the top level:

```ts
excerpt: field.textarea({
  label: 'Excerpt',
  config: { ai: { hint: 'One sentence, under 160 characters, no headline repetition.' } },
}),
sku: field.text({ label: 'SKU', config: { ai: { enabled: false } } }),
```

| key | default | does |
|---|---|---|
| `enabled` | `true` | whether AI may fill or suggest this field |
| `hint` | - | what the field holds and how to write it |

Turn `enabled` off for identifiers, codes and anything another system owns: a
generated SKU is worse than an empty one.

## Localization

`localized: true` puts the field's values in a per-locale side table. It is
per-field and opt-in: a type can have localized and non-localized fields side by
side.

**Media localizes at the asset level** - per-locale variants - so a media field
needs no flag.

## `index`

A field you filter or sort on repeatedly should carry `index: true`:

```ts
section: field.text({ label: 'Section', index: true }),
topics: field.tags({ label: 'Topics', index: true }),
```

`tangen push` creates `<type>_<field>_idx` for it - a B-tree, or a GIN index for
an array-backed type such as `tags` or `multiselect` so containment queries use
it. `push --plan` names the index before it creates it, and `tangen doctor`
reports a declared index the database does not have.

Not every type can carry one: `richtext`, `group` and the other container types
have no single column to index, and `index: true` on one is ignored rather than
refused. `slug` already has a unique index of its own, per workspace.

Setting `index: false` later drops the index; the column and its data stay.

## Query behaviour

Not every type participates in every operation.

| | |
|---|---|
| **filterable** | most scalar types. `link` is **not** filterable in v1 |
| **unique** | `slug` is unique per type. `link` cannot be unique |
| **listable** | most types appear as list columns; `link` does not |
| **expanded by depth** | `relation` only. `media` resolves at every depth including `0`; `object` fields are values on the row; `link` consumes no depth |
| **backlinks** | `_referencedBy` works through **many relations** only, and refuses `link` |

See [TangenQL](/reference/tangenql).

## Custom field types

An extension can contribute a field type by **inheriting a built-in
primitive** - it gets that primitive's storage and baseline validation, and adds
its own validation and editor. See the Extend section.

## Related

- [Link](/reference/link) · [TangenQL](/reference/tangenql) ·
  [Configuration](/reference/configuration) · [CLI](/reference/cli)
