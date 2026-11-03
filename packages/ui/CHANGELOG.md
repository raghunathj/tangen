# @tangen/ui

## 0.2.8

### Patch Changes

- A relation in the inspector gets its label above it and the full width
  
  A single relation classified as a compact property, so the inspector drew it
  as a one-line row: a fixed 120px label, and the picker in whatever remained of
  a narrow sidebar. Both relation pickers render a bordered box holding the
  record's title, its status badge, a link that opens it and a button that
  changes it, so what was left of the line went to the badge and the buttons
  while the title truncated away. A relation read as an unlabelled strip of
  icons. `many` was never what made it too wide for one line, so a relation is
  structured now whether or not it is `many`, and stacks like every other
  structured field.
  
  A stacked property row's label also takes the weight the main stage gives a
  field label. Above its control it is doing that same job rather than heading a
  value column, and left light it read as a caption over an unexplained control.

## 0.2.7

No changes in this release.

## 0.2.6

### Patch Changes

- A field that is required only sometimes, or hidden by its own rule, now reads
  the same in the editor as it does on save.
  
  Four defects with one shape: a decision made once in the validator and
  differently in the editor.
  
  - **A sub-field hidden by its own rule is not drawn**, and is not required.
    The rule may be written at either level of a declaration, and both sides now
    read it through one function, so a discriminator inside a block or a repeater
    row (MP4 asks for a file, YouTube asks for an id) is usable rather than
    merely expressible.
  - **A select can be returned to empty, in all three presentations.** A dropdown
    and a radio group offer the empty state as their first choice, reading `None`
    or `Use default (X)`; a `segmented` group un-presses the button that is
    pressed and draws a clear inside the group while a value is set. The
    presentations differ because the controls do: a native radio does not
    un-check and a dropdown has no pressed thing to click twice.
  - **A conditionally required field reads as required only while its condition
    holds**, everywhere it is drawn.
  - **A reload is not an error**, and one absent feature flag no longer takes the
    whole editor down with it.
- @tangen/icons@0.1.2

## 0.2.5

### Patch Changes

- d54f1ba: Escape closes the dropdown that owns the top layer, and a dialog's scrim stops
  covering its own buttons.
  
  `DismissableLayer` keeps its layer stack in MODULE SCOPE, so two copies are two
  independent stacks: an Escape gets handled by the stack that does not own the
  top layer, and whether a dialog's overlay sits above or below its own content
  depends on which Portal mounted first. Both are per-process sticky, which is why
  it read as a coin flip, a dropdown that would not close on Escape with focus
  correctly inside it and a dialog whose own scrim covered its Create button.
  
  The mechanism is worth stating because the obvious reading is wrong. Radix pins
  its internals EXACTLY, not with a caret: `react-dialog@1.1.17` requires
  `react-dismissable-layer@1.1.13` while `react-popover@1.1.23` requires `1.1.19`.
  So two top-level Radix packages from different release vintages can never
  dedupe, however the ranges a consumer declares are written. Ours were all
  `^1.1.0` and permitted one vintage throughout; the lockfile had simply resolved
  them at different times, and 23 internal packages were installed twice as a
  result. The declared ranges now name one vintage, and a gate asserts on the
  LOCKFILE, since that is what is committed, what CI installs and what forks.
- @tangen/icons@0.1.1

## 0.2.4

### Patch Changes

- Updated dependencies [4edc9c1]
  - @tangen/icons@0.1.0

## 0.2.3

No changes in this release.

## 0.2.2

### Patch Changes

- 3b6e5d5: A Select's placeholder is muted again, and an unset sub-field select reports a value instead of a sentence.
  
  `@tangen/ui`: the trigger's placeholder styling never applied. `data-[placeholder]:text-fg-subtle` sat on the value SPAN while Radix sets `data-placeholder` on the TRIGGER, so the variant waited on an attribute that span never receives and placeholder text rendered at full `text-fg` - visually identical to a value the user had chosen. It is now scoped to the trigger's `group/trigger`, which is what the chevron beside it has always done for `data-disabled`. Every Select in the product gets its placeholder back, not only the ones below.
  
  `@tangen/admin`: a closed sub-field select read "Defaults to Dark". A trigger's job is to state what is in effect, so it leads with the value: "Dark (default)". The qualifier stays, because bare "Dark" cannot be told apart from a pinned value and that difference decides whether a later change to a design default moves the block or leaves it behind.
  
  The trigger and the open menu now carry deliberately DIFFERENT wording for the one state: the trigger reports "Dark (default)", the menu offers "Use default (Dark)". The menu sits beside a real "Dark" option and has to read as an action; the trigger stands alone and has to read as a value. One wording cannot do both, which is what the previous two attempts each discovered from opposite ends.

## 0.2.1

No changes in this release.

## 0.2.0

### Patch Changes

- Updated dependencies
  - @tangen/icons@0.0.26
