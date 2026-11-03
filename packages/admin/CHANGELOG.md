# @tangen/admin

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
- A chosen relation shows the record's publish status again
  
  The badge beside the selected entry read a bare `status`, and the component
  that drew it binds no such name, so it resolved to `window.status` - the
  deprecated DOM global, whose value is the empty string. Every chosen record
  got a blank grey pill, published and archived alike. Nothing reported it:
  lib.dom declares that global as a `string` and the prop wants a string, so
  there was no type error to notice. The sibling multi-relation picker passed
  the record's own value and was always right, which is why one picker showed a
  status and the other did not.
  
  Both pickers' narrowed locals are `rowStatus` now. A local named after a DOM
  global reads identically to the global at the call site, which is how this
  survived a file whose header already documented an earlier badge defect.
- The jump list names the error, and offers only fields that are on the page
  
  A refused publish put the offending field at the top of the "Jump to" menu in
  red text and stopped there. For a container field that is not enough: every
  block on a page lives under one `blocks` field, so "Blocks" said a block was
  wrong and never which one. The row now carries an alert icon and the
  validation message under the label, so "Media showcase (block 7): Video file
  is required" is readable from the header.
  
  The list also dropped only fields hidden outright, not fields hidden by their
  own conditional rule, so it offered rows that scrolled nowhere: the target is
  found by the `data-field` attribute a drawn row carries, and an undrawn field
  has none. Both reasons a field is undrawn are now read, the same way the
  editor reads them.
  
  The error row is the kit's `destructive` menu item now rather than a
  hand-rolled `text-danger-fg`, which colours the icon with it and keeps
  contrast while the row is highlighted.
- Updated dependencies
  - @tangen/ui@0.2.8

## 0.2.7

### Patch Changes

- A sub-field hidden by its own rule no longer blocks publishing
  
  The editor draws no input for it and the server waives it, but the admin's own
  pre-publish check read `required` against the stored value with no rule in
  sight. A media block whose video source was YouTube refused to publish, naming
  the MP4 file field that the editor had never offered. The same check now reads
  the rule through `subFieldVisibility`, in a repeater row and a component block
  alike, and skips a block the eye hid or a block-level rule excludes - which is
  the order the server has always used.
- @tangen/ui@0.2.7

## 0.2.6

### Patch Changes

- An extension's declared richtext node reaches the editor, and HTML mode says
  what it is about to discard.
  
  The contribution point and the vocabulary shipped last release on the server
  side. The editor now draws what the schema says rather than what its own
  extension list happens to support:
  
  - a contributed node appears in the document, saves, and serialises from its
    declaration with no extension code running in the browser
  - an **Insert** control puts one into a document, so a declared element is
    reachable without typing markup
  - switching to HTML mode names the nodes and marks the round trip will drop,
    before it drops them
- A type's declared address crosses the push boundary, and the site's own code
  can read it.
  
  The grammar and the composer shipped last release; what shipped with them
  could not leave the process that declared them. A `path` written as a pattern
  is now a column on the type, so the Admin, the GUI builder and the generated
  types all read the same declaration, and `tangen push` plans it like any other
  structural change.
  
  - `path` is pushed and diffed, so changing an address is a plan line rather
    than a restart
  - the settings sheet edits it, with the same grammar validation the file gets
  - `tangen types` emits it, so a site composes its own URLs from the same
    declaration the server reads
  - a function form stays in code: it is marked in the stored value
    (`PATH_FN_MARKER`) rather than serialised, because a function cannot be, and
    the marker is what stops a push from writing a lie into the column
  
  New in `@tangen/types`: `isPathFnMarker`, `storedPathOf`, `PATH_FN_MARKER`,
  and the `ContentPathFnMarker` / `StoredContentPath` types.
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
- A read can ask for the chain a row sits under, and deleting a parent names
  what is inside it.
  
  Three things that were each a consequence of the tree being invisible to a
  paged read:
  
  - **`includeAncestors`** on the object read and the list read attaches
    `_ancestors` to every row, root first, in one extra query whatever the page
    size. Building the tree from the rows in hand needs every row at once: a
    parent on another page reads as no parent, so its children render at the top
    level. The Admin's one data table now draws the nesting as a prefix from it.
  - **Deleting a parent is refused**, and the refusal lists the pages inside it.
    The auto-provided parent relation takes `onDelete: restrict`; declaring
    `parent` yourself with `setNull` keeps the old promote-the-children
    behaviour, which is now a choice rather than the only option.
  - **The parent picker stops offering the page being edited**, which is the one
    value that cannot be a valid answer.
- Every entry picker offers every entry, and a chosen one reads as its title.
  
  A read past `maxQueryLimit` is CLAMPED rather than refused, so a picker that
  asked for everything was quietly served the first 100 and presented that as the
  whole list. Both entry pickers now search, order and page on the SERVER, which
  is also what makes a selection outside the first page show its own title
  instead of its id.
  
  - the relation and link pickers page the server, with the search term sent
    with the page
  - a link renders as the target's title, resolved rather than guessed
  - the route accepts every key a picker sends, which a test now pins
- The TypeScript we publish is gated, and what the gate found is fixed.
  
  `typecheck:shipped` compiles the published surface the way a consumer's
  compiler sees it, rather than the way the monorepo does. It found real
  breakage in declarations that only ever ran in-repo, and it now runs with the
  release guards, so a type that would not compile for an installer cannot ship.
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangen/types@0.5.0
  - @tangen/ui@0.2.6
  - @tangen/schema@0.2.1
  - @tangen/icons@0.1.2

## 0.2.5

### Patch Changes

- d54f1ba: A content list's primary action names ONE item, so it reads "New Post" rather
  than "New Posts".
  
  `label` is the collection heading: it is the page title, the sidebar entry and
  the `collectionLabel`, so it is plural for every collection anyone would
  declare. Nothing held a singular, and three buttons that create one item named
  many. `docs/fields.md` called `label` "(singular display)", which is the same
  two-places-disagree shape as the richtext toolbar default; the doc says what the
  admin does now.
  
  `admin.labelSingular` wins where declared, because English irregulars are not
  inflectable and nothing should try: "People" has to be told it is "Person".
  Where it is absent the label is inflected, and the inflection is new public API
  on `@tangen/types`, `singularLabel` and `pluralLabel`, which preserve a prose
  label rather than camelCasing an identifier the way `graphql-naming`'s
  `singularize`/`pluralize` must. `singularLabel` is idempotent on a label that is
  already singular, so the fix is right under either reading of `label`.
  
  It also replaces TaxonomyPicker's own hand-rolled pluraliser, which was "ends
  with y ? ies : + s" and made 'Box' into 'Boxs' and 'Day' into 'Daies'.
  
  Worth knowing for anyone who trusts the browser lanes with copy: the responsive
  lane had PINNED `/^New Posts$/`, so a passing test was holding the defect in
  place, and the visual lane could not have caught it either. Its `maxDiffRatio`
  is 0.001 and a word changing at 1440x900 is about 0.034% of the frame, so four
  desktop baselines would have kept "New Posts" forever.
- d54f1ba: A dashboard widget column renders according to its `displayType`, and a wide
  table scrolls inside its card instead of pushing the page sideways.
  
  `displayType` sat in the contract unread. A date column printed its raw ISO
  instant, and a status column printed the bare enum value, lowercase, with every
  lane green, because no fixture had ever declared a `displayType` at all: the
  branch a fixture never takes is the branch that ships broken. A status reads as
  a pill now, a date as an absolute date, a number grouped, a boolean as Yes or
  No, an undeclared ISO instant as a date, and an empty value as a dash.
  `docs/dashboard.md` carries that as a table rather than a one-line note.
  
  The status pill also removes a three-way duplication. Two relation pickers each
  carried a byte-identical copy of the chip and the dashboard had none, and all of
  it painted raw palette steps, a fixed green fill, text and border, which the
  design system's own Badge says a badge must never do: a palette step is one
  colour and a surface has two themes. `statusBadge()` names a Badge VARIANT now,
  so the colour decision stays where dark mode is already answered, and
  `lib/relation-picker.ts` goes from seven raw palette classes to zero with the
  ratchet locked there.
  
  Four tables had `overflow-x-auto` on a wrapper with a `w-full` table inside it.
  `w-full` makes the table shrink to its container, so the scroller never engaged
  and the cells squashed instead: the dashboard, the query monitor, the telemetry
  screen, bulk edit and the configuration settings table are all `min-w-full`.
- 650069d: A global's field renders its help text.
  
  The globals edit sheet drew a label and a control and stopped, so every
  `helpText` authored on a top-level global field was dead text in a config
  file. It is the only instruction a global can carry: there is no column
  header, no per-field description, and nothing else on the row.
  
  Found while adding fields to a real site's `header` global, where the one
  sentence that matters most was invisible: "The id only, not the whole watch
  URL" on a YouTube id. A pasted watch URL fails silently in the player, and
  the field had no way to say so.
  
  The row is now its own component, which is what makes the fix assertable -
  the sheet fetches and holds locale state, so a static render of the sheet
  only ever proves its skeleton. It resolves the options through the same
  `subFieldAdmin` a repeater's rows use, so both homes work: `config.admin`,
  where every global authors them, and a root `admin`, which used to be
  dropped without a word.
  
  The two gates that pin the column-span mapping to one place follow the row,
  and still cover the globals sheet through it.
- d54f1ba: A richtext document is held to a declared vocabulary, and a `javascript:` link
  can no longer reach emitted HTML.
  
  The format had no owner. There was no `richtext` case in `validateFieldValue`,
  the route typed the body `t.Any()`, and the column accepts bare scalars, so any
  shape at all reached storage and surfaced later, inside a serializer, as an
  empty string.
  
  `CONTENT_DOC_VOCABULARY` is today's shape written down: the twelve nodes and six
  marks the editor's own extension list can produce, as DATA. Not a new format, so
  nothing stored needs migrating. `validateContentDoc` holds a document to it and
  NAMES what it refused, the node, the mark or the attribute, with a depth bound
  so a pathological document cannot exhaust the stack. It validates and never
  normalizes: `object-snapshot` fingerprints the whole field value, so a document
  reshaped on write would make every existing object read as edited.
  
  Four defects close with it.
  
  **A `javascript:` href survived into emitted HTML.** An `href` is scheme-checked
  against http, https, mailto and tel now; a refused one drops the link MARK and
  keeps the text, which is what the site-side renderer already did. A heading
  level is clamped to the range the vocabulary declares, so `<h9>` is no longer
  emitted for whatever a document happened to carry. Neither is something the
  validator can help with, because a document stored before the validator existed
  is still a document.
  
  **A `required` richtext field was satisfied by an EMPTY document.**
  `{ type: 'doc', content: [] }` is an object and so not `isEmpty`, so publishing
  with an untouched editor passed the requirement. `isBlankDocument` decides that
  now, and counts an image-only or rule-only document as content, because those
  are content without text.
  
  **Four walkers disagreed about one document's text**, and two were wrong. The
  serializer put NOTHING between list items, so a bullet list of one, two, three
  extracted as `onetwothree`, through the `serialize: 'text'` hint and the CSV
  export alike. Search put a space between EVERY child, so a word that marks had
  divided into two text nodes (`inter` plus bold `national`) became two tokens.
  `contentDocText(value, { separator })` is the one walker, and the separator is
  the whole difference between the two legitimate purposes: readable text wants a
  newline between blocks, a search index only needs words not to fuse.
  
  **An empty richtext field could not be opened at all.** `doc` declared
  `group: 'block'`, making the document root a member of the group it holds.
  ProseMirror fills a container by searching its content group in schema order,
  `doc` is declared first, so "find a block for this" found `doc`, and filling a
  `doc` needs another block: `RangeError: Maximum call stack size exceeded` out of
  `ContentMatch.fillBefore`. That fires wherever the engine asks the schema to
  invent a block, which is every value that is null, empty, a non-object or
  `{ content: [] }`, so it was every richtext field on every newly created object.
  `group: 'root'` is a group nothing admits. The same declaration had also told
  the validator a `doc` may sit inside any container.
  
  The serializer reads the vocabulary rather than a switch statement, so a node
  added to the vocabulary renders with no edit to that file. The toolbar's default
  is read from one place too, instead of a second list that contradicted the
  contract it was meant to implement.
- d54f1ba: A content type declares where its objects live, and a read can ask for the
  address.
  
  The question it started from was a link's: a link stores identity, so a read
  could answer only with the target's slug. A link to a post three categories
  deep could not render its URL, and a page under About then Company showed
  `/company` in its own editor, because the slug was the only thing anything
  had.
  
  A type now says it once, in one of four forms:
  
  - `'/blog/:category/:slug'` is STRUCTURE, so it pushes to the database and the
    Admin and the GUI builder can both read it
  - `{ pattern: '/:parent*/:slug', root: 'home' }` declares the home page, so
    the object whose slug is `home` lives at `/` whatever tree it sits in
  - `{ field: 'legacyUrl' }` honours a migration's existing addresses, and
    supersedes the SEO extension's `urlField`
  - a function, in the behaviour overlay beside `validate`, for rules a pattern
    cannot state
  
  The grammar is three tokens, and `*` carries the load: `:field` is exactly one
  segment, `:field*` is that relation AND its ancestors root first, `:field|x` is
  a literal fallback. `*` reads as it does in a glob, so an empty chain is LEGAL
  and contributes nothing, which is what lets one pattern serve a root page and a
  nested one at once. A bare `:field` refuses an empty value unless a fallback
  fills it, and the reason is worth stating because the opposite looks friendlier:
  a shortened address is one the site's own router cannot match, so the link would
  render, read correctly, and 404.
  
  **What it costs to read.** `includePath` on the object read, the list read and
  TangenQL, and the bargain is the one `depth` and `populate` already offer: a
  default read carries no `_path` and sends no statement for one. A read that asks
  pays one query per type the pattern reaches, whatever the page size. A
  relation's slugs come back in one grouped select; an ancestor chain in one
  recursive query, however deep the tree. The test for that counts statements:
  five pages across three levels, one query.
  
  **The link field answers properly now.** The loader asks the resolver for the
  target's address and returns two keys for one resolve: `target.path`, the
  destination's own locale-prefixed address, and `href`, that address with this
  link's postfix already appended, so `?source=footer#team` is in it and one key
  renders all three link kinds. `href` is ABSENT rather than null when the type
  declares no path, because "this type has no route" and "this page lives at
  nothing" are different answers. `linkHref()` in the SDK answers an internal
  link too: the rule it guarded was never "no internal href", it was "never
  invent a route", and a pattern the type declares is not an invention.
  
  **SEO stops needing a function.** The extension exists to turn content into a
  canonical, a sitemap entry and an llms.txt line, and every one needs the same
  fact. There are three answers now, most explicit first: the site's
  `resolveUrl`, then a field named in `urlField`, then the composed address. A
  resolver is handed the other two, so a site that only wants a locale prefix
  reads the composed address instead of rebuilding the route. None of the three
  is still no URL, and no URL still omits the object rather than inventing one.
  llms.txt no longer requires the site to have written a resolver at all.
  
  **The editor types inside the URL.** The load asks for `_path` and
  `_pathTemplate`, the template being the address with `:slug` left as a hole, so
  the row recomposes on every keystroke with no round trip. The save asks too,
  because moving a page under a different parent is the one edit that changes an
  address and only the server knows the ancestors' slugs. The preview is right
  the moment the parent is saved, autosave included, at no extra request. A type
  that declares no path answers null, costs no query, and keeps the plain
  `/<slug>` row it always had. `{path}` works in a live-preview URL template for
  the same reason a `{slug}` one could not reach a nested page.
  
  **A cycle is refused on save, not just survived on read.** The resolver's
  recursive query already carried a `seen` array, so a loop rendered as a short
  address rather than hanging. This is about telling an editor BEFORE they create
  a branch of pages that quietly becomes unreachable. The case worth testing is
  not "its own parent", which an editor notices, but three hops: About's parent
  set to Team, which sits under Company, which sits under About. Nothing in the
  picker looks wrong, so the message names both ends. It walks UP from the
  proposed parent, because up is bounded by the tree's height and down by its
  size, and it is wired into `runBeforeChange`, the one funnel every write path
  already passes through, so no hook can be reached through a cycle.
  
  A wrong pattern is a sentence at load naming the type and the field, rather
  than an empty address found on a page months later. A segment must be a
  relation and must not hold many, since a segment holds one value and taking the
  first would be a silent choice nobody declared. Another workspace cannot
  contribute a segment: both halves of the recursive term filter `workspace_id`,
  so a parent id pointing across the boundary resolves to nothing rather than to
  someone else's slug.
- d54f1ba: A published object stops reporting draft changes after a publish, and opening an
  editor reads its lifecycle policy once rather than twice.
  
  **The phantom draft changes** were reported as "even after publish changes I
  still see changes in draft unless I reload", and the reload is the clue. Panels
  are given `savedAt` precisely so one whose server state depends on the content
  can re-read after a save, and a publish changes `savedAt`, so the panel re-reads
  and emits its data again. The guard in front of `setHasPendingPanelChanges` then
  compared that emit against `panelDataMap[id]`, and the two are different SHAPES:
  the read hands panel data over wrapped as `{ draft, published, schemaVersion }`
  while a panel emits its bare draft. A raw compare of those can never be equal,
  so every re-emit registered as an edit.
  
  **The double policy read.** The editor passes `[object?.updatedAt]` to
  `useLifecycleActions` so the policy re-reads after a save, since a published
  object that just gained draft changes offers different actions. But `object` is
  null on the first render, so `updatedAt` is undefined, and the value ARRIVING is
  indistinguishable from a save unless the rule says so. Every editor open
  therefore read `/objects/:type/actions` twice, the second time chained behind
  the object GET. That endpoint runs a validation dry run, the relation-cascade
  check and every installed extension's publish policy, so it is the expensive one
  to repeat for an answer already in hand.
- 120fff5: The editor's prose resolves through the theme ramps, and no field is a raw
  number input any more.
  
  Two fixes already on master that had no release of their own.
  
  **The editor's prose.** `.tiptap` carried 14 hard-coded colours across 13
  rules, so a heading, a blockquote, a code block and a link all ignored the
  theme. They now read the ramps and work in both. One deliberate visible
  change: a light-mode code block is a neutral well rather than dark indigo,
  which is what inline code already looked like. The tempting token for it,
  `--tg-surface-inverted`, is LIGHT in the dark ramp and would have turned a
  code block white.
  
  A gate came with it, because this class of mistake is silent: CSS resolves an
  undefined custom property to nothing and the element renders whatever it
  inherited, which usually passes a glance in light mode. Every `--tg-` token
  the stylesheet reads is now asserted to exist in both ramps.
  
  **Number inputs.** Eight raw `<input type="number">` controls went through the
  component that exists to replace them. Six were in the object list's filter
  bar, where it matters most: a filter whose value silently empties returns the
  WRONG ROWS, with Apply disabled and nothing saying why. Also the bulk editor,
  which could write null to every selected row, and the live preview's
  breakpoint box, which now refuses a decimal instead of rounding it.
  
  The five kit `Input type="number"` sites are left as declared debt: the numeric
  component deliberately does not use the kit's `Input`, so swapping them changes
  how the field looks, and a visual change does not belong in a correctness fix.
  
  The kit lint was counting its own documentation while this was measured - over
  a fifth of the 857 "raw controls" it tracked were comments, including the
  header of the file that fixes the problem. It measures code now, and the
  ratchet drops to 680.
- d54f1ba: Dependency advisories go from 45 to 1, and the one critical among them was for a
  package that was never installed.
  
  `tar` was reported through `@tangen/knowledge-pdf > unpdf`, but unpdf 0.12
  reached it only through `canvas`, an `optionalDependencies` entry that bun never
  installed: neither `tar` nor `canvas` existed on disk anywhere. `bun audit` reads
  the LOCKFILE rather than `node_modules`, so it rated as critical something never
  loaded. Bumping unpdf to 1.9.1 was still right, because the lockfile is what
  forks to a consumer whose platform CAN build canvas, and 1.9.1 has zero
  dependencies and makes `@napi-rs/canvas` an optional PEER. Twelve advisories
  left at once, and the PDF extractor still pulls real text out of a real PDF.
  
  Two bumps could not have arrived by re-resolving. `nodemailer` goes to `^10.1.7`
  because the advisory range is `>=9.1.0 <10.0.9`, so no 9.x fixes it; usage is
  `createTransport` and `sendMail` only. `elysia` goes `1.4.28` to `1.4.30` for
  GHSA-9643-4qgh-g8mx, which is an exact pin `docs/deployment.md` requires to be
  bumped with the suite and the boot benchmark rerun, and both were.
  
  The rest were already inside the declared ranges and only needed re-resolving:
  sharp, vite, `@vitejs/plugin-react`, `@tailwindcss/postcss`, react-router-dom,
  and a root `overrides` entry for brace-expansion.
  
  One advisory stays, and it is not the Admin's whatever `bun audit` prints. It
  lists `esbuild <=0.24.2` under `@tangen/admin > vite`, but vite 8.3.5 declares
  esbuild as an OPTIONAL PEER and uses rolldown, so it installs none: every copy
  is drizzle-kit's. It is the `esbuild serve` dev-server issue and nothing here
  runs `esbuild serve`, and clearing it means a drizzle-kit major that changes the
  migration generator.
  
  Also removes a second module-scope singleton found on the way. `@tangen/admin`
  declared `react-router: ^8.5.0` beside `react-router-dom: ^7.18.4`, and nothing
  imported `react-router`: 92 import sites, all `react-router-dom`. The 8.x copy
  was dead weight putting two routers in the tree, and `vite.config.ts` already
  carried an alias whose comments say the store may hold multiple react-router
  majors and that React context breaks across copies, so the workaround was
  written before the cause was found. `react-router-dom@7.18.4` pins
  `react-router` at `7.18.4` exactly, which is the Radix mechanism again, so
  `react-router` joins the dedupe gate's singleton scopes.
- d54f1ba: Text a person has to read no longer sits on the decorative colour tier.
  
  `globals.css` states the rule beside the token, that the 50% tier is decorative
  only and readable text stops at the 60% tier, and nothing enforced it, so twenty
  places had drifted past it. The 50% tier measures 3.94:1 on a page; the 60% tier
  measures 5.7:1.
  
  In the Admin: the object list's "not translated" and "No file", bulk edit's "No
  options", the permission tree's resource label and slugs, settings > connections'
  group count, the roles table's empty dash, and eight lines in the AI panel
  (timestamps, token counts, two outcome lines, a step title). In the SEO manager:
  "Falls back to the page title" and "Not set". In Notes: the panel's "Internal:
  never shown on the site.", which was the only color-contrast violation on either
  editor surface. Two were not token changes at all, a rating's unfilled star and
  a separator.
  
  The a11y lane goes from 14 failures to 16 passing with it.
- d54f1ba: The richtext editor is ProseMirror, behind one interface, and its schema is
  compiled from Tangen's own vocabulary.
  
  The field component used to import six tiptap packages and call
  `editor.chain().focus().toggleBold().run()` directly, so the engine was a
  decision the UI had an opinion about. It talks to a `RichtextEngine` now: a
  closed command set that names what the TOOLBAR offers rather than what an
  engine happens to expose, which is what makes it portable. Three files where
  there was one, and exactly one of them imports an editor.
  
  Then the swap itself. `richtext-schema.ts` compiles `CONTENT_DOC_VOCABULARY`
  into a ProseMirror schema, so the editor READS the format instead of declaring
  it a second time, which is the thing the programme existed to fix; a ledger test
  holds the compiler to four spelled-out vocabulary names. The schema is pure, so
  a vocabulary change that would break the editor fails in `bun test` rather than
  only in a browser. It is stricter than the stored format in exactly one declared
  place, because ProseMirror takes the shortest wrapping a content expression
  allows and would otherwise put a paragraph straight inside a `<ul>`: a validator
  must accept what is already in a database, an editor must refuse to create it.
  
  Two things follow that a consumer will notice. `bun audit` no longer reports the
  prosemirror-view paste XSS, nor the tiptap `mergeAttributes`, markdown-it and
  linkify-it advisories that came with `@tiptap/pm`'s markdown subpath. And the
  richtext chunk measures 105.84 KB gzip down to 72.96 KB, a 31% drop, most of it
  a DUPLICATE `prosemirror-view` that a stale nested resolution had kept at 1.41.9
  beside 1.42.6, which meant the vulnerable copy was still shipping and two
  `Decoration` classes were in one page. Root `overrides` pin `prosemirror-view`
  and `prosemirror-model` to one version each.
  
  The `@tiptap/pm` workaround is gone from `vite.config.ts`, and the stylesheet's
  `.tiptap` prose is `.tg-richtext`, which is the platform's own name.
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
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [120fff5]
- Updated dependencies [d54f1ba]
  - @tangen/types@0.4.0
  - @tangen/ui@0.2.5
  - @tangen/icons@0.1.1

## 0.2.4

### Patch Changes

- 4edc9c1: `vite.config.ts` imports `./vite-dev-cache.ts` with its extension, which is
  what the three imports above it already did.
  
  Bun warned on every `tangen dev` start: `import "./vite-dev-cache" without a
  file extension`. It resolved anyway, so it was only noise - but it was noise
  on the exact line that shipped broken, and the file's own convention was
  already the fix.
  
  The release dry run now also starts the admin dev server from the installed
  package, which is the step whose absence let that breakage ship.
- Updated dependencies [4edc9c1]
  - @tangen/icons@0.1.0
  - @tangen/ui@0.2.4

## 0.2.3

### Patch Changes

- e809c2a: The admin dev server could not start from an npm install: `vite.config.ts`
  imports `./vite-dev-cache`, and `files` named each root vite module one by
  one, so the new one was never packed. `files` now takes `vite*.ts`, which
  removes the class rather than the instance, and a release gate reads the
  imports of every packed file and fails when one resolves to nothing.
- @tangen/ui@0.2.3

## 0.2.2

### Patch Changes

- cd9bac6: The admin has a tab icon.
  
  `index.html` declared none, so the browser asked for `/favicon.ico`, the SPA fallback answered with the app shell, and the tab showed the browser's blank-page glyph beside "Tangen CMS".
  
  It is inline rather than a file in `public/`, because the Admin runs both from `packages/admin` in the monorepo and from `node_modules/@tangen/admin` in a consumer install: an asset would have to resolve, be listed in `files`, and survive publishing in both. A data URI has none of that surface and costs no request.
  
  It is the Tangen mark itself - the same path `app/(auth)/login` draws, in the same brand indigo - rather than something drawn for the purpose. The viewBox is the mark's own bounding box squared off around its centre, so it keeps its proportions instead of being stretched to fit; checked by rendering at 16px, where the knocked-out inner triangle still survives as a cutout.
  
  The gate that earns its keep compares the two paths. An icon copied out of a logo is a copy, and a copy drifts the first time the logo changes and nobody thinks of the tab, so a change to one now fails on the other.
  
  One trap the gate exists for: `#` inside a data URI begins a fragment, so an unescaped `fill="#4f46e5"` truncates the SVG at the first colour and the icon vanishes with no console error and no broken-image glyph - just the default again. It stays percent-encoded.
- 300ea88: A component block's card honours a sub-field's declared width.
  
  The repeater row, the object editor and the globals sheet were all taught the six-column grid; the block card was not. It read `subFieldAdmin(sf).helpText` and never `.width`, and stacked every sub-field in a `space-y-3` column, so a block declaring two `'half'` headline fields got them one above the other. That is the same defect the globals sheet had: an option the type offers and nothing reads.
  
  The card now lays its sub-fields on the same grid through `fieldColSpanSm`, so `'half'` means three of six and `'third'` means two of six in a block exactly as in a row. An absent width spans full, which is the documented default. A container sub-field, a nested repeater or block list, always spans the row whatever it declares, because a container in half a card cannot be authored.
  
  The source gate that keeps the mapping in one place now covers the block editor too, so a fourth surface cannot drift the way the third one did.
- 5d27e50: A block's fields are arranged as Content / Style / Advanced tabs.
  
  `SubField.group` has been in the type all along, documented as "which inspector tab this prop belongs to in visual editors", and the admin read it nowhere. It does now, as tabs built from the kit's own `Tabs` primitive, used as a control with the panel rendered below it exactly as the schema builder's field config and the container modal already use it. The admin had chosen tabs for this kind of thing long ago; anything else here would have been a one-off.
  
  They are KINDS, not arrangements. The question the three answer is what sort of thing a field is - what it says, how it looks, plumbing - which has the same three answers for every block anyone writes. Author-declared tabs would instead answer "how do I want to lay out this form", which drifts per block and would put a classification and a layout choice in the same row, so a block whose Content grows long wants a fieldset within that tab rather than a fourth tab.
  
  Four rules. A tab appears only when it has fields. One kind of field means no tab row at all, so a content-only block looks exactly as it did before and a style-only block gets no lonely single tab. A required-empty field's tab is the one that opens until the editor picks another, and it is marked, because an error behind an unopened tab is worse than no grouping. And with working locales active, an open settings tab whose fields are all shared says so, as a note and never a disabled state.
  
  Grouping classifies a field DEFINITION and stores nothing: the block's value stays flat, the database holds only the component's name, `tangen diff` reports no schema change, and no tab name reaches REST or GraphQL data.
- fb4bd7a: Two presentation controls the platform defines, and a sub-field that says what it falls back to.
  
  `blockPresentationFields()` gives an `anchorId` (slug-validated DOM id and URL fragment) and a `className` (design-system utility classes, applied verbatim), both declaring `group: 'advanced'` so they land on a block's Advanced tab. That is where Gutenberg keeps an HTML anchor and additional CSS classes too. A class list is never parsed back, the same contract Studio gives its escape-hatch classes: a class that does not exist does nothing, which is what separates it from a free-form stylesheet field. Its only validation is that it cannot contain what would close an attribute or open a tag.
  
  A project spreads them into the blocks that want them, through one shared function of its own. An earlier version of this declared named sets in the workspace config and injected them into every block and repeater; that is gone, along with its config slot, its two `ComponentDef` keys, the resolver's third argument and a reader for the loaded project. It worked and it was worse: a block whose schema file lists six fields while the block has ten is how an author loses track of their own component, and a shared function already gives the "change it once" property that injection was supposed to buy.
  
  Separately, `config.default` on a sub-field was offered by the type and read nowhere. The editor now names the fallback while the value is empty, resolving a select's default through its option labels rather than its stored value, in a block card and a repeater row alike.
  
  That is a hint and never a write, which matters on existing content: add a control to a block a hundred pages already use and all hundred have no value for it. Writing the default in would be a hundred revisions and would freeze the value, so a later change to the design default would move none of them. Absent-means-default is what lets one line of code change every page at once, so the editor's job is to say what absent resolves to. The frontend side of the contract is to read `block.spacing ?? 'normal'`.
- f17d799: A block's shared settings say so when locales are in play.
  
  A localized sub-field shows a coloured rail per working locale; a shared one shows a single input. With a locale selected, nothing told an editor that the input they were about to change in Style or Advanced is the one every language reads. A section whose fields are all shared now carries a note saying it applies everywhere.
  
  A note rather than a disabled state, deliberately. There is no "edit in German" mode in the admin: the base input IS the default-locale surface and per-locale rails are added beneath localized fields, so making a shared field read-only while a locale was selected would mean it could never be edited at all. The server states the same model when a locale write carries a shared field: shared values are edited in the default locale.
  
  The note is only shown where it is true, so a section holding a localized field does not claim to be shared, and nothing appears when no locale is in play. A separate test pins the server rule that a locale write, including a block overlay, may name only localized sub-fields, since the editor note is worth having only while the server is the one enforcing it.
- 2c270e5: A content blocker can no longer blank the admin, and no request path carries a word a privacy filter list matches.
  
  A developer's fresh clone came up with an empty admin, and the cause was uBlock Origin. `web-vitals` is a name several privacy filter lists match, and it sat in the eager boot graph: `src/main.tsx` -> `lib/shared-runtime.ts` -> `lib/runtime-extensions.ts` -> `lib/api.ts` -> `lib/perf-vitals.ts`. Five eager hops from the entry, so the request went out before React mounted, and an extension refusing it took the whole module graph down with nothing rendered and nothing to read. The production build happened to be safe, because rolldown tree-shakes the library into a lazily-loaded page chunk, but dev serves the static graph as written and dev is where developers live.
  
  `web-vitals` is now loaded on demand inside the Performance Monitor, through a `startVitals` that reports failure rather than raising it. A refused import costs the pill's Page section and nothing else. Registering after the await still collects LCP, FCP and TTFB, because the library reads buffered performance entries.
  
  `index.html` gained a boot fallback: if the module graph never executes, the page says the admin could not load and names a blocking extension as the usual cause, instead of staying white. It is inline and sits above the module script, because an inline script still runs when a network request is refused and the error listener has to be registered before the script it watches. `main.tsx` marks a successful boot so a working admin never shows it.
  
  Four admin request paths were renamed off filter-list vocabulary, since whether they arrive was the viewer's extension's decision rather than ours:
  
  - `GET /api/v1/admin/telemetry/overview` is now `GET /api/v1/admin/runtime/overview`
  - `GET /api/v1/admin/telemetry/events` is now `GET /api/v1/admin/runtime/events`
  - `DELETE /api/v1/admin/telemetry/events` is now `DELETE /api/v1/admin/runtime/events`
  - `GET /api/v1/admin/search-analytics` is now `GET /api/v1/admin/search-insights`
  
  Telemetry remains the product concept, the Devspace screen and the docs; only the URL changed. Three gates hold the properties: the eager import graph is walked from the entry and fails with the offending chain, `startVitals` is driven with a rejecting loader, and the boot fallback is extracted from `index.html` and run against a fake document.
- 81a8c5d: The dev server no longer promises that the admin's own source will never change.
  
  In a consumer install the admin's TypeScript lives in `node_modules`, so Vite stamps its modules with the dependency optimizer's `?v=<hash>` and then, because a version query is present, serves them `Cache-Control: max-age=31536000,immutable`. That hash is derived from the dependency metadata - the lockfile and the `optimizeDeps` config - and not from file contents. A file patched in place therefore keeps a byte-identical URL, the browser keeps its copy for a year, and the tab dies on an export the module demonstrably has:
  
  ```
  Uncaught SyntaxError: The requested module '/lib/field-presentation.ts?v=af9fb6d8'
  does not provide an export named 'subFieldSelectPlaceholder'
  ```
  
  Measured against a running server: `/lib/field-presentation.ts` answered `no-cache`, the same path with `?v=` answered immutable, so the query alone decides it. Restarting did not help, because the hash is deterministic - two incidents a day apart both read `af9fb6d8` - and clearing the Vite cache did not help for the same reason. Only a hard reload did, and only until the next change.
  
  `devSourceCachePlugin` now downgrades `immutable` to `no-cache` for every served URL that is not a pre-bundled dependency under `.vite/deps`. Those keep the promise, because they are rebuilt from scratch whenever that directory is cleared and nothing overwrites them in place. The ETag is untouched, so an unchanged module still answers 304 and the cost is one conditional request.
- 86d5644: The three picker dialogs align on one gutter, lose their grey action bar, and keep their buttons at the bottom.
  
  `withDialogPadding` wraps any child that is not a `DialogHeader` or `DialogFooter` in a padded `DialogBody`. That rescue exists because dialogs kept forgetting the body and rendering flush to the edges, and it cannot tell a forgotten body from a hand-rolled one. All three pickers hand-rolled header, body and footer as plain divs, so each of those was padded twice:
  
  - the search field sat 36px in while the title above it sat at 16px, which is the misalignment;
  - the footer, being a stray child, was indented 20px from both edges, so the tint it carried stopped short of the dialog's corners;
  - and because that auto body is `flex-1 overflow-y-auto` but not a flex column, the footer stacked directly under however much content there was. On the media picker, which has a fixed `80vh` height, the buttons sat halfway up the dialog with blank surface beneath them.
  
  All three now use `DialogBody` and `DialogFooter`, with the body explicitly unpadded so each section carries the single `px-5` gutter the header and footer sit on. The footer is a sibling of the body, so it is pinned to the bottom whatever the body holds, and it takes the dialog's own surface divided by a rule instead of `surface-sunken`.
  
  Alongside that: the relation picker takes the `lg` size this design system documents for pickers, rather than a `max-w-lg` that fought the prop and left a title, two actions, a status chip and a timestamp sharing 512px; its status filters drop the four competing borders so only the active one is drawn; its result list has a fixed minimum height so changing filter no longer resizes the dialog under the pointer; and its empty state says which type found nothing and what to do next. The media picker's two hand-rolled buttons become the product's own `Button`, which also removes a raw `text-white`.
- 1cef5cf: Every dialog in the Admin now pays its gutter once.
  
  `withDialogPadding` wraps any child of a `DialogContent` that is not a `DialogHeader` or `DialogFooter` in a padded `DialogBody`. It exists because dialogs kept forgetting the body and rendering flush to the edges, and it cannot tell a forgotten body from a hand-rolled one - so a section carrying its own horizontal padding got the gutter twice and sat indented under a header that did not. Nineteen dialogs across eighteen files were built that way.
  
  They were being found one at a time, by opening them, and that was the real problem: a gate written around the first four passed the fifth, whose footer was already right and whose body was not. The gate is now the property over every `.tsx` in the package - no `DialogContent` may have a self-padded child outside a `DialogBody` - which immediately turned up eight more that two rounds of hand-written sweeps had missed, `relation-picker` (the single-select sibling of the one already fixed) and `block-palette` ("Add New Block") among them.
  
  An unpadded stray child is left alone, because that is the auto-wrap being used as intended; five dialogs rely on it correctly. The fix is one of two shapes: content that is a single block drops its own padding and lets the body supply it, while a dialog with several sections declares `DialogBody` with `p-0` and puts each section on the one `px-5` gutter the header and footer sit on. Sections that were `px-6` are now `px-5`, which also removes a 4px misalignment they had against the header regardless of the doubling.
  
  Along the way the four pickers lost the tinted action bars that stopped short of their corners, their footers moved outside the scrolling body so the buttons sit at the bottom instead of halfway up, and their status filters dropped the borders around the inactive ones so only the active filter is drawn.
- ac967c3: Collapse all moved into the field's own header bar.
  
  It was sitting on a row of its own above the cards, spending a full row of height on one control. It now sits in the `h-9` bar that already holds the field's label and its kind chip, to the right, costing nothing.
  
  That bar is itself a click target that folds the whole field, so the button stops propagation: without that, one click would fold the cards and then close the field over them, and the result would never be seen.
  
  Moving it meant the control and the cards are now drawn by two different components - the object editor draws the header, the editor below draws the cards - so the fold record is lifted into a `FoldProvider` mounted once per editor screen. Two independent copies of the same record would not have seen each other's toggles. Without a provider the hook keeps its own copy, which is what keeps these editors working standalone in Studio and under `renderToString`.
  
  `foldControl` is how a caller says it has a header: `FieldRenderer` passes `host` because every field reaching it is top-level and gets a header bar, while a nested editor - a repeater inside a block card - has no header and keeps drawing its own. The default is `self`, so nothing silently loses the control.
  
  One honest edge: the header derives its cards from the stored value, so a block hidden by a visibility rule is counted there but not by the editor, which filters to what it renders. If a hidden block is the only expanded one, the first click appears to do nothing visible and the second expands. Taking the keys from the editor instead would need it to register them in an effect, which pops the button in a frame late on every load; one rare extra click is the better trade.
  
  Two of the three gates here exist because proving them exposed holes. Deleting `foldControl="host"` from `FieldRenderer` left every behavioural test green, since they pass the prop themselves, so the wiring is asserted at the source. And that source gate was itself vacuous at first: it matched the sentence in `FieldRenderer`'s own header explaining the prop, and passed with the prop deleted from the JSX. Comments are stripped before the assertion now, because a gate that reads its own documentation proves nothing.
- 4f1a1f4: The Gen AI button is readable in dark mode.
  
  `.genai-border` painted its padding-box fill with a literal `#fff`, so in the dark ramp the button kept a white interior while `text-accent-fg` resolved to indigo-300. Light lavender on white: the label was effectively invisible, which a screenshot of the dark top bar showed plainly.
  
  The fill is `--tg-surface-raised` now, which is right by meaning as well as by value. The ramp reserves that token for "popovers, menus, dialogs, inputs" and this is a control; it is `#ffffff` in light, so light mode is byte-identical to before, and `oklch(0.24)` in dark, where indigo-300 sits around 6.5:1. It also has to stay opaque, because the conic gradient is painted on the border box underneath and a translucent fill would show it through the face of the button.
  
  **Nothing scanned the stylesheet.** `token-contract` ratchets raw palette classes in `.tsx` sources, so a literal in `globals.css` passed every gate. `stylesheet-tokens.test.ts` closes that: no colour literal in a rule body, since a literal has exactly one value for every theme, which is the defect. A literal in a `--tg-*` definition is still where a literal belongs.
  
  Writing that gate turned up three more things. The four scrollbar-thumb declarations were **not** the defect, each having an explicit `.dark` sibling, but a hand-written pair is the duplication the ramp exists to remove, so they became `--tg-scrollbar-thumb` with identical computed values. A dead `var(--tg-accent-contrast, #fff)` fallback on a token defined in all three ramps was dropped, leaving the gate with no exception to make for it. And the `.tiptap` prose block is listed as recorded debt rather than excused: it was written against light mode throughout, and mapping editor prose onto tokens is a design decision that wants someone's eye, not a mechanical substitution.
  
  Adding the scrollbar token was then caught by `studio-scope`, which asserts the Studio scope redefines every token the dark scope does. It does again.
  
  The gate strips comments before reading, because the fix for this bug is explained in a comment that names `#fff`, and a gate that reads its own documentation proves nothing.
- a33a309: A link can point at a path on your own site.
  
  A real publish failed on `{ type: 'external', url: '/design' }`, and the refusal was correct: a relative URL is not an absolute one. The design was wrong, not the value. A site has routes that are not content objects, and neither existing branch took them: `internal` stores `{ type, id }` and a hand-built route has no object to point at, while `external` stores an absolute URL, so putting `https://acme.com/pricing` in content makes staging link to production. The error even said "use an internal link for content in this workspace", which is advice that cannot be followed when there is no entry to pick.
  
  `LINK_KINDS` gains `path`. It stores `{ type: 'path', path: '/pricing' }`, verbatim, and a read returns one derived href the way the external branch does. Nothing is loaded to produce it, because the application owns that route.
  
  This reads the existing boundary from the other side rather than bending it. "Tangen resolves content identity; the application resolves site routing" - and a path IS site routing, so Tangen resolves nothing about it and can be wrong about nothing. The objection that a stored path breaks when a route moves is a content objection: a slug rename is a content action nobody tracks, while `/pricing` is a route its own developer moves in code and knows they moved. Where the destination genuinely is an entry, `internal` still gives exactly that protection.
  
  One value is refused: a path beginning `//`, such as `//example.com/x`. It reads as a path and is protocol-relative, so it leaves the site. That is what makes this branch more than "a string starting with a slash", and it has its own gate. An absolute URL in the path box answers the new `absolute` reason with its scheme, a path in the URL box answers `relative`, and each message now names the branch that would take the value instead of guessing at the author's intent.
  
  **The editor reports a bad destination where it is typed.** `type="url"` on the input did nothing: native constraint validation surfaces only on a form submit, and these are controlled inputs with no form, so `/design` saved into the draft in silence and surfaced as a failed publish on another screen. The dialog now says what is wrong when you leave the box, and a `?` or `#` typed into the path box moves into the Postfix instead of being swallowed by normalization.
  
  New in `@tangen/sdk`: `isPathLink`, and `linkHref(link)` for the two branches that already carry an href, returning `null` for an internal link whose path only your router can build. `tangen types` emits `TangenPathLink` and narrows a field to exactly the branches it offers.
  
  An existing field keeps what it declared: `allowedKinds: ['internal', 'external']` still offers those two, and only an undeclared field widens to all three.
- 809bb12: A link or url field can never hold `javascript:`, and a declared deep link now works.
  
  Two defects in the same rule, found by measuring `externalUrlIssue` against the URL shapes an editor would actually type rather than by reading its tests.
  
  **The allow-list was the only gate, and the Admin said otherwise.** The schema builder's help text read "javascript: and data: are never accepted", and nothing anywhere enforced it: `allowedSchemes: ['javascript']` accepted `javascript://example.com/%0aalert(1)`, which parses with a hostname and still executes in a browser. `DENIED_LINK_SCHEMES` is now a floor beneath the allow-list, checked first, naming six schemes that are code or a local handle rather than a destination. It answers `reason: 'unsafe'`, distinct from `'scheme'`, because the two are different answers to a developer: one is a field decision `allowedSchemes` fixes, the other is nothing's to allow. A `validation.messages` entry cannot replace either refusal.
  
  The `url` field had the same hole with no opt-in at all: it validates structure and `httpsOnly` and has no scheme policy, so **any** writer could store `javascript:alert(1)` in one, and every consumer renders a `url` as an `href`. It shares the floor now.
  
  **Opaque deep links were refused even when the schema declared them.** Only `mailto` and `tel` were exempt from the "must have a hostname" check, and the exemption was two hardcoded names rather than a rule, so `sms:+15551234`, `fb-messenger:user?id=1` and `intent:#Intent;package=com.x;end` all failed as malformed. A scheme is opaque or not by whether `//` follows the colon, which is what the check asks now, with the WHATWG special schemes still always host-checked because the parser reads `https:example.com` as that host anyway.
  
  `externalHref` follows the same shape test, so the two can no longer disagree about what is opaque. That matters more than it reads: merging into an opaque URL rewrites rather than appends, because the parser sees `intent:#Intent;package=com.x;end` as an empty path plus a fragment, so setting a hash on it yields `intent:#x` and the destination is gone.
  
  Both fixes are gated by tests proven to fail without them: four on the floor, two on the opaque rule, two on the url field.
- 4c6b2d0: A number field says what is wrong as you type it, and never shows a value it is not storing.
  
  Typing `100+` into a number field left the box reading `100+`, stored `null`, came back blank on reload, and the first news of it was "is required" at publish, on a different screen. The field looked filled and was not.
  
  Two causes, one outcome. `<input type="number">` reports an **empty** value for any text it cannot parse while leaving the characters on screen, so the handler received `''` and stored nothing. And native constraint validation only surfaces on a form submit, which these editors do not have, so there was no client-side validation at all: the field had no way to say the value was not a number, and `required` is only evaluated at publish. That is the same root cause as the link field's `type="url"` doing nothing, found earlier the same day.
  
  `NumericInput` replaces every raw number control an editor can type into. It is a text input with `inputMode`, which makes the invariant unconditional: what is on screen is what the draft holds. It validates on every keystroke and puts the reason on the field, naming where a sign or a unit belongs rather than only refusing. The native spinners go, which is a small loss next to a field that silently discards input; the phone keypad comes from `inputMode`, and `min`/`max`/`step` were always enforced server-side by `field-validator` rather than by the widget.
  
  What it cannot do is keep `100+` for you, since a number column holds no such thing. The honest ceiling is to say so immediately.
  
  Five controls changed, not one: the top-level number field, a repeater row's, a block sub-field's, **both ends of a range**, **both ends of a geopoint**, and **currency**. All had the identical defect, and currency is the one where silently dropping a typed figure costs most. The gate asserts no editor renders a raw `type="number"` again, since a sixth appearing later would reintroduce it silently.
  
  It carries a kit-lint budget of 2 rather than using the kit's `Input`, and that is recorded debt, not a design: the kit wraps its control in a div and styles the inner element, while all the call sites pass their own classes straight to the input, so routing them through the kit changes how every number field looks. That migration is worth doing on its own, with someone looking at the result.
- d90cf3f: The object picker, which an internal link opens, aligns on one gutter.
  
  It is the fourth dialog with the same cause: `withDialogPadding` wraps any child that is not a `DialogHeader` or `DialogFooter` in a padded `DialogBody`, and this one left its search and results as stray children, so both carried that body's `px-5` on top of their own `px-4` and sat indented under a header overridden to 16px. Unlike the other three it already used `DialogFooter`, so only the body half was wrong - which is why a gate written around the footer alone would have passed it.
  
  It now declares its `DialogBody` explicitly and unpadded, with each section on the single `px-5` gutter, takes the `lg` size this design system documents for pickers, and drops the borders around its inactive status filters so only the active one is drawn.
  
  The gate records the rest of the class. Sweeping for dialogs with a full-width banded section and no `DialogBody` finds twelve more, `block-palette` ("Add New Block") among them; they are listed in the test rather than asserted, because a gate that fails for twelve files is a red suite nobody can act on.
- 03269e0: A sub-field's default is worn by its control, and the playground stops hiding blocks and by-field queries.
  
  A select whose value is empty now reads `Normal (default)` on its empty option, and a text sub-field takes `Defaults to Normal` as its placeholder unless one is authored. The first version of this put a caption under the control, which was the wrong shape: an empty control with a line of text beneath it reads as broken, while a control that states its own fallback reads as configured and is still honest, since nothing is stored until an editor picks a real option. The default resolves through option LABELS, because an editor recognises `Normal` and not the stored `normal`. A block card's select also gained an empty option, which it never had, so an unset select can say what unset means and can be cleared again.
  
  In the API Playground, a `component` field's sample is now built from its resolved component definitions and carries `_type`, and a `repeater`'s is one row built from its sub-fields. Both were skipped as "too structural to fake usefully", which left the least guessable part of the API absent from the one screen built for learning it: a create body for a page with blocks simply had no `blocks` key, and nothing taught that a block needs a `_type`.
  
  The query sample used to emit `{ contains: '' }` on whatever text-ish field came first, which matches every row, ignores `index` and `unique`, and made the picker look as though `Get by id` were the only way to find a record. It now picks an indexed or unique field before an arbitrary one and uses an operator that returns something, `Query` says "find by ANY field, not just id", and `Get by id` says where to go instead.
- deb8a1a: Collapsed blocks and repeater rows stay collapsed, one control folds them all, and the sidebar's recents no longer follow the next person who signs in.
  
  **Folds survive a reload.** Both editors held `useState(true)` per card, so every reload reopened a forty block page. They are now controlled by the field, which keeps the collapsed set in `localStorage` under `tangen:folds:<memberId>` - the same mechanism the sidebar already uses for its own sections and the same per member scoping as `dashboard-prefs`. Not the database: this is one person's view of one editor on one device, so a column would impose an editor's folds on everyone and would dirty the object for pure chrome.
  
  What is stored is the **collapsed** set rather than the expanded one, because expanded is the default. A page nobody folded costs an empty array, and a card added after a Collapse all opens expanded, which is what you want immediately after clicking Add and what storing "is expanded" would get wrong. The record is capped at 50 editing surfaces, most recently touched kept: without a cap it grows with every object anyone ever opens, and the failure mode is a `QuotaExceededError` thrown mid edit rather than anything visible.
  
  **One control folds the lot.** It is one button labelled with the action it performs, not two: while any card is open it says Collapse all, and once they are all closed it says Expand all. It appears from two cards up, and only counts the cards actually rendered, so a block hidden by a visibility rule cannot decide the label.
  
  **The sidebar's pins and recents are scoped per member.** A recents entry's label is read from `document.title`, so for an object editor it is the object's title. Unscoped, those labels survived sign out and rendered for whoever signed in next, from a workspace that person may not even belong to. A `memberId` is minted per (workspace, email) and the workspace switcher calls `setAuth` with a fresh one, so one key part closes both halves. Recents are additionally cleared on an explicit sign out, since nobody curated them and titles should not outlive the session that collected them; pins are deliberate, so they are kept. Device preferences are deliberately untouched: resetting someone's theme every time they sign back in would be the wrong trade for state that names nothing.
  
  The fold hook reads `window.location` rather than react-router's `useLocation`, which throws outside a Router: a field editor must not be able to crash for want of one, and these components also render in Studio and in tests that call `renderToString` directly. Gated by a test that renders both editors with neither a Router nor a session, proven to fail against the first version.
- c133431: A repeater row edits each sub-field with its real control, the server type-checks what a row holds, and the editor grid honours the documented width default.
  
  `SubFieldControl` had a compact control for ten field types and a text box for everything else, so twelve of the types the admin handles fell through: `code`, `color`, `currency`, `geopoint`, `json`, `link`, `object`, `range`, `rating`, `slug`, `tags`, `time`, plus every extension-contributed type. For seven of those the text box also stored the wrong shape. A `link` value is an object, and a row wrote a bare string that the link editor reads back as null; `rating`, `range` and `currency` stored strings where numbers belong. The server does not backstop it, because the repeater branch of the field validator checks row count and sub-field required-ness and never a sub-field's type. The fallback is now the real `FieldControl`.
  
  The globals editor read an absent `admin.width` as half, spanning full only for `textarea`, `richtext` and `json`, while the field type documents "Defaults to 'full'" and the object editor honours that. One mapping now serves all three call sites, the globals sheet is six columns like the object editor, and a repeater row honours each sub-field's declared width, except a nested container, which always spans the row.
  
  `SubField.admin.width` was offered by the type and read nowhere. It is read now, and a raw sub-field's `helpText` and `width` are accepted from either `admin` or `config.admin`, the top-level one winning, so there is one rule rather than two homes split by key.
  
  On the server, the repeater and component branches of the field validator checked row count and, on publish, required-ness, and never what a row actually held. Every row and block sub-field now goes through `validateFieldValue` itself, so it gets the per-type rules, its own `validation` config and recursion at any depth. Type-correctness is enforced on a draft save as well as a publish, because the draft is what reaches the column; required-ness stays publish-only and its message is unchanged.
  
  A global whose definition names no `icon` renders a fallback glyph instead of an empty grey square.
- 65d55e0: A repeater row sorts its sub-fields by `group`, the way a block card already did.
  
  `SubField.group` was read for a block card's sub-fields, which split into Content, Style and Advanced, and ignored entirely for a repeater row, which rendered one flat grid. The same declaration therefore produced two different editors depending on which container it sat in, and the block card's own comment claimed the opposite: that the vocabulary means one thing wherever a block is edited.
  
  The three kinds now live in `lib/field-presentation` as `SUBFIELD_TABS`, with `subFieldGroup` and `activeSubFieldTabs` beside them, and both editors read from there so the two cannot drift again.
  
  Nothing changes for a declaration that names no group. A row with one group has one tab, `activeTabs.length > 1` is false, and it renders the same flat grid as before with no strip, no migration and no stored value: grouping is presentation only.
  
  A required field left empty decides which tab opens, so an error never hides behind a tab nobody clicked. Unlike a block card this does not also mark the field red, because a row tracks no touched set; opening the right tab is the whole of it.
  
  The gate proves the no-group case explicitly, since every repeater that existed before this change is that case.
- 3b6e5d5: A Select's placeholder is muted again, and an unset sub-field select reports a value instead of a sentence.
  
  `@tangen/ui`: the trigger's placeholder styling never applied. `data-[placeholder]:text-fg-subtle` sat on the value SPAN while Radix sets `data-placeholder` on the TRIGGER, so the variant waited on an attribute that span never receives and placeholder text rendered at full `text-fg` - visually identical to a value the user had chosen. It is now scoped to the trigger's `group/trigger`, which is what the chevron beside it has always done for `data-disabled`. Every Select in the product gets its placeholder back, not only the ones below.
  
  `@tangen/admin`: a closed sub-field select read "Defaults to Dark". A trigger's job is to state what is in effect, so it leads with the value: "Dark (default)". The qualifier stays, because bare "Dark" cannot be told apart from a pinned value and that difference decides whether a later change to a design default moves the block or leaves it behind.
  
  The trigger and the open menu now carry deliberately DIFFERENT wording for the one state: the trigger reports "Dark (default)", the menu offers "Use default (Dark)". The menu sits beside a real "Dark" option and has to read as an action; the trigger stands alone and has to read as a value. One wording cannot do both, which is what the previous two attempts each discovered from opposite ends.
- 8e29c86: An unset select on a block card no longer shows its default twice, and the closed control no longer contradicts the open menu.
  
  A sub-field select's empty option read "Dark (default)" and sat directly above a real "Dark" option, with nothing to tell an editor which was which or that one writes nothing while the other writes `dark`. That collision was structural, not an edge case: `subFieldDefaultLabel` finds the label by looking the default up AMONG that select's own options, so the empty option was guaranteed to duplicate one of them. It now names the action instead of the value, "Use default (Dark)", which keeps the honesty (it still says which one) while being unmistakably not a third tone.
  
  The closed trigger meanwhile said "- Select -". Neither the block card nor the repeater row passed `placeholder` to the kit Select, so it fell back to the ui package's generic prompt while the open menu described the same state differently. Both now pass `subFieldPlaceholder(field)`, so an unset control reads "Defaults to Dark" and the two halves agree.
  
  Nothing about the contract changed: picking the empty option still stores nothing, which is what lets a later change to a design default move every existing block at once instead of freezing a hundred pages at the value they were authored with.
  
  The first gate for this feature recorded, correctly, that a Radix Select's options are not in static markup and asserted the resolver directly instead. That limit is exactly where the defect lived, because nothing looked at the trigger, which IS in static markup. It is read now, and the "adds no caption" assertion that blocked the fix has been rewritten to say what it meant: the default belongs inside the trigger, not in a caption beneath it.
- 672f628: A sub-field with an unrecognised `group` renders under Content instead of vanishing.
  
  `SubField.group` is typed as a plain string, so `group: 'gallery'` type-checks. It then matched none of the three tabs, which meant the field rendered in no tab at all: no error, no empty tab, nothing, and a value sitting in the database with no way to reach it. A field under the wrong heading is a cosmetic problem; a field nobody can edit is a data one.
  
  Found while checking what the type permits rather than what the schemas happen to use, and it was never repeater-specific: a block card filtered by group the same way, so a typo in any block's declaration lost a field there too.
  
  `subFieldGroup` is total now, answering `content` for anything outside the three keys. The gate covers a row and a block card, since both had the hole.
- Updated dependencies [a33a309]
- Updated dependencies [809bb12]
- Updated dependencies [3b6e5d5]
  - @tangen/types@0.3.0
  - @tangen/ui@0.2.2

## 0.2.1

### Patch Changes

- @tangen/ui@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @tangen/types@0.2.0
  - @tangen/icons@0.0.26
  - @tangen/realtime@0.1.4
  - @tangen/realtime-admin@0.1.4
  - @tangen/ui@0.2.0
