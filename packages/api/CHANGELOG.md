# @tangen/api

## 0.2.8

### Patch Changes

- Four findings fixed, and the media picker finishes what it starts.
  
  **Adding a block no longer jumps the page to the top.** The new block is
  scrolled into view instead, which is the behaviour that was missing anyway.
  
  **A select is checked against its own options.** There was no rule at all: no
  `case 'select'` in the validator, `multiselect` counting only how many were
  chosen, and `options` appearing nowhere. Checked at publish only, like
  `required`, so an option removed from a schema cannot strand existing rows.
  `tags` is freeform and is never checked.
  
  **Media constraints reach every depth.** They walked a flat field list, so
  `accept` was enforced almost nowhere a project declares it: images live
  inside component blocks and repeater rows. A `many` field was skipped
  entirely. Both now use the same walker the media collapse uses.
  
  **`tangen extension status` names a required grant the installation never
  approved**, with the upgrade command. It reported unapproved OPTIONAL grants
  and said nothing about required ones, which is the more serious of the two:
  the facility behind it silently does not run.
  
  **A Lottie file serves as `application/json`** rather than octet-stream.
  
  **The media picker takes dropped files**, anywhere on it, and an upload now
  selects what it just uploaded instead of asking for the choice twice.

## 0.2.7

### Patch Changes

- The draft marker survives a save that touches a content field.
  
  The UPDATE route picks between two statements: drizzle's
  `.update().returning()`, which hands back camelCase keys, and a raw
  `UPDATE ... RETURNING *`, which hands back the column names. The raw branch
  is not the rare one - every ordinary content field goes through
  `customSetClauses` - so any save that touches a field took it.
  
  That row went to `computeHasDraftChanges` unmapped. It reads
  `publishedValues`, found `published_values` instead, fell through to its
  legacy no-snapshot branch, found no `updatedAt` there either and answered
  `false`. The editor's "Changes in draft" marker therefore went out after
  every autosave, so a page with unpublished edits looked published.
  
  The route now maps the three keys that computation reads. Field columns need
  no mapping: a field's column is its name verbatim.

## 0.2.6

### Patch Changes

- The "Changes in draft" marker is the server's answer, not a second guess.
  
  Every published entry carrying a link showed "Changes in draft" permanently,
  while the content list showed none. The stored values and the published
  snapshot were identical, so nothing had changed and the list was right.
  
  The editor was not comparing those two things. It compared the object the API
  returns against `published_values`, and a read resolves before it answers: an
  external link's `url` becomes a derived `href`, media and relations expand
  from ids to objects, while the snapshot holds the authored form. Per-field
  normalization covered a top-level relation or media field, but a link had no
  case and nothing descended into a `component` field, so any link inside a
  block counted as an edit.
  
  The editor now reads `hasDraftChanges` off the object, which the server
  computes from the raw row against the same snapshot. The update route answers
  it too, so a save on a published entry moves the marker without a reload.
  Unsaved edits, extension panel data and translations stay client-side,
  because the server cannot answer those.

## 0.2.5

### Patch Changes

- The delivery contract belongs to the platform, not to Studio.
  
  `DeliveryProvider` lived in `@tangen/studio-compiler`, which meant
  `packages/api` imported Studio code on the one path that exists to keep
  working when Studio is disabled. The contract now lives in `@tangen/types`,
  imported by the platform delivery route, by the store that resolves a backend,
  and restated by `ctx.delivery`.
  
  Types only, deliberately: a value exported there reaches the public surface of
  `@tangen/cms`, and a site developer has no use for a delivery backend. Core's
  own backends live beside their resolver in the API; `@tangen/studio-compiler`
  keeps its key-value one, and it retires with Studio.
- Forms refuses a content write whose `form` field points at a form that does not exist.
  
  A page could publish a reference to a deleted or renamed form and the only
  sign was an empty section on the live site. The field type could not catch it:
  `SiteFieldValidate` receives a value and nothing else, so an existence check
  was impossible there, and `ContentHookCtx` carried no query access either.
  
  `ContentHookCtx.ext` is the new seam, bound per extension in the hook runner
  the way filters and contributions are already lent their own ctx. It is a
  getter rather than a value, because hooks run on every content write and
  building a ctx is not free; an extension that only reads `nextData` pays
  nothing. It is absent for site hooks and on a host that has not wired
  extensions, which a hook reads as "cannot verify" and proceeds.
  
  Forms walks the type's own definition alongside the values, so a `form` field
  is found inside a component block, a repeater row, or a block within a block,
  and asks one question of the database only when the walk found a reference.
  It fails open on a missing ctx, types or db: a check that refuses writes
  because it could not run is worse than the gap it closes.
  
  The extension manifest moves to 0.3.0 and declares `hooks:content`. Because a
  new REQUIRED grant is not in what an existing installation recorded, every
  workspace with Forms installed must run `tangen extension upgrade forms` and
  approve it; until then the check does not run.
- Link field: a path link may be a same-page anchor, and a field that offers link text now requires it to publish.
  
  `#plans` typed into the path box used to store as `/` and lose the anchor
  entirely. A path link's `path` is now optional, so a value of
  `{ type: 'path', anchor: 'plans' }` is a legitimate same-page link whose href
  is `#plans` rather than `/#plans`. A path and its postfix in one value is
  refused by name instead of silently dropped, which `UrlIssue.reason` reports
  as the new `'postfix'` case.
  
  Five defects went with it: an unset path link counted as a link, so `required`
  could not answer it; the stored-form guard in the link loader read "has a
  string path" where it meant "has no href", so a resolved path link read back
  as null; and the admin's path box was bound to the stored value, so the `#`
  vanished on the first keystroke.
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangen/types@0.6.0
  - @tangen/studio-compiler@0.1.3
  - @tangen/schema@0.2.2
  - @tangen/db@0.1.58
  - @tangen/graphql@0.1.29
  - @tangen/knowledge@0.1.28
  - @tangen/logging@0.0.28
  - @tangen/mcp@0.1.28
  - @tangen/porter@0.1.7

## 0.2.4

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
- The second security pass: two findings in the three areas the first one named.
  
  Both are in how a bundle names things. Porter's key safety and the tar writer
  were the ones that could be reached from outside, and the GraphQL resolver
  change closes the read that made them worth reaching.
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangen/types@0.5.0
  - @tangen/db@0.1.57
  - @tangen/schema@0.2.1
  - @tangen/graphql@0.1.28
  - @tangen/porter@0.1.6
  - @tangen/knowledge@0.1.27
  - @tangen/logging@0.0.27
  - @tangen/mcp@0.1.27

## 0.2.3

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
- d54f1ba: An extension can add an element to the richtext editor by declaring one.
  
  Nothing could contribute to the editor before this: there was no editor
  contribution point at all, so the answer to "can my extension add a callout
  block?" was no.
  
  An extension now declares the element in its manifest and the platform renders
  it, validating a document against it and emitting its HTML server-side from
  `tag` and `htmlAttrs`. Nothing the extension wrote ever runs inside a document,
  which is both the security property and what keeps the vocabulary independent
  of any one editor engine.
  
  It is shaped on ADMIN SLOTS rather than on the `fieldTypeUIs` convention:
  manifest declared, descriptor-only, grant-gated, shape-validated, and
  deterministically ordered by priority then name. `fieldTypeUIs` has no ref, no
  version, no grant, is last-write-wins, and is enforced by a source-text regex,
  which the kernel's own notes call the pre-point convention.
  
  `richtextVocabularyFor(scope)` composes the live vocabulary: the built-in nodes
  and marks plus every element the workspace's ACTIVE extensions declared and
  hold the grant for. It is memoised per workspace against the registry
  generation, because a content read serializes every row and would otherwise
  rebuild it per row. The validator reaches it through a scope declared on
  `CustomFieldTypeResolver`, which is the scope every extension-aware check in a
  validation pass needs, rather than a seventh positional parameter threaded
  through seven call sites and every recursive descent.
  
  A contributor without the grant is skipped and warned by name; an invalid
  declaration is dropped and warned rather than thrown at a request.
- 120fff5: A field is typed from its own configuration, so a navigation menu and a page
  builder's blocks arrive with a shape.
  
  `tangen types` mapped every structured field to `unknown`. The two things a
  site reaches for first were both in that bucket: a `repeater` (a header's
  navigation, a footer's socials) and a `component` field (the page builder). A
  consumer had to cast before reading anything, which is the opposite of what the
  generated file is for.
  
  Codegen now reads what each field already knows:
  
  - `repeater` -> `Array<{ _key, ...sub-fields }>`, nested to its leaves, so a
    two-level menu types all the way down
  - `component` -> `Array<HeroBlock | StatementBlock>`, one interface per
    registered block discriminated by `_type`. The definitions come from the
    workspace config's `components:`, because the pushed schema carries only
    their names
  - `select` / `multiselect` with static options -> a literal union. A field whose
    options come from elsewhere (`optionsSource`) stays `string`, because those
    values are not knowable at codegen time
  - a sub-field's options are read both under `config` and at the field root:
    `defineObjectType` backfills one and a global's fields keep the other, and
    reading a single place typed half the project's sub-fields from their kind
    alone
  
  `richtext` and `json` stay `unknown` on purpose - a document is not described
  here.
  
  A global can also be read per locale now, which the route has always supported
  and no client could reach: `globals('header').locale('ta').get()`, plus
  `'all'` for every locale at once, on the SDK and on `ctx.tangen`. A localized
  write is refused on the local client rather than quietly writing the base,
  because which roles may write which locale is a rule the route enforces and an
  extension acts under its own authority.
  
  Four defects surfaced while building this, each with a test that fails first:
  
  - `validation.allowedComponents` read `block._component`, a key nothing in the
    platform writes (the editor writes `_type`), so the guard evaluated
    `undefined && ...` on every real block and a field declaring one allowed
    component accepted any component at all
  - the local client's `globals().get()` returned `__i18n`, handing every caller
    every locale's values under a key it never asked for
  - a full replace of a global DELETED every translation, on the route and the
    local client both: a read strips `__i18n` and the write went straight over
    the row, so the obvious round trip (read, change one field, write back) wiped
    every language. The leak above was accidentally carrying it through and
    masking this. A replace now addresses the base values and carries the
    translations over; passing `__i18n` explicitly still replaces or clears them
  - `ensureContainerRowKeys` keyed repeater rows, including rows nested inside a
    block, but never the block itself. Blocks are matched by `_key` both for
    carrying historical values across a write and for per-locale overlays, so a
    block written through the API rather than the editor could not be translated
    and lost its history on the next write
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
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [120fff5]
  - @tangen/types@0.4.0
  - @tangen/schema@0.2.0
  - @tangen/db@0.1.56
  - @tangen/graphql@0.1.27
  - @tangen/knowledge@0.1.26
  - @tangen/logging@0.0.26
  - @tangen/mcp@0.1.26
  - @tangen/porter@0.1.5

## 0.2.2

### Patch Changes

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
- 03269e0: A sub-field's default is worn by its control, and the playground stops hiding blocks and by-field queries.
  
  A select whose value is empty now reads `Normal (default)` on its empty option, and a text sub-field takes `Defaults to Normal` as its placeholder unless one is authored. The first version of this put a caption under the control, which was the wrong shape: an empty control with a line of text beneath it reads as broken, while a control that states its own fallback reads as configured and is still honest, since nothing is stored until an editor picks a real option. The default resolves through option LABELS, because an editor recognises `Normal` and not the stored `normal`. A block card's select also gained an empty option, which it never had, so an unset select can say what unset means and can be cleared again.
  
  In the API Playground, a `component` field's sample is now built from its resolved component definitions and carries `_type`, and a `repeater`'s is one row built from its sub-fields. Both were skipped as "too structural to fake usefully", which left the least guessable part of the API absent from the one screen built for learning it: a create body for a page with blocks simply had no `blocks` key, and nothing taught that a block needs a `_type`.
  
  The query sample used to emit `{ contains: '' }` on whatever text-ish field came first, which matches every row, ignores `index` and `unique`, and made the picker look as though `Get by id` were the only way to find a record. It now picks an indexed or unique field before an arbitrary one and uses an operator that returns something, `Query` says "find by ANY field, not just id", and `Get by id` says where to go instead.
- f8a0101: The API Playground offers the globals endpoints.
  
  Globals were missing from the endpoint picker entirely. The catalog is built from content types, custom tables, custom-route groups and active extensions, and a workspace's globals were never an input, so four routes the API serves could not be reached from the one screen built for reaching routes.
  
  There is a `Globals` group now: the definitions list, plus a read and the two writes for each global the workspace declares, labelled with the global's own label and with sample bodies built from its real field names. Three details the samples get right, because getting them wrong is the reason a developer would reach for this screen in the first place: a write body is the values object ITSELF rather than wrapped in `values` the way an object route's is; `?locale=` belongs on the PATCH, since PUT replaces the whole store and refuses a locale with a 422; and the read offers no `depth`, because a global has none and its media and relation fields arrive as bare ids.
  
  The catalog route feeds them in through `globalDefinitionsOf`, the same helper the REST routes, the local client, GraphQL and Studio resolve globals with, so the picker cannot drift from the routes on what a workspace declares.
  
  `CatalogEndpoint.method` gained `PUT`. It was the only one of the three method lists that lacked it: the admin's own `Method` type and the execute route's allowlist have always carried it.
  
  A gate reads the registered method and path pairs out of the globals route source and asserts the catalog covers every one, so a globals route added later cannot go unoffered.
- c133431: A repeater row edits each sub-field with its real control, the server type-checks what a row holds, and the editor grid honours the documented width default.
  
  `SubFieldControl` had a compact control for ten field types and a text box for everything else, so twelve of the types the admin handles fell through: `code`, `color`, `currency`, `geopoint`, `json`, `link`, `object`, `range`, `rating`, `slug`, `tags`, `time`, plus every extension-contributed type. For seven of those the text box also stored the wrong shape. A `link` value is an object, and a row wrote a bare string that the link editor reads back as null; `rating`, `range` and `currency` stored strings where numbers belong. The server does not backstop it, because the repeater branch of the field validator checks row count and sub-field required-ness and never a sub-field's type. The fallback is now the real `FieldControl`.
  
  The globals editor read an absent `admin.width` as half, spanning full only for `textarea`, `richtext` and `json`, while the field type documents "Defaults to 'full'" and the object editor honours that. One mapping now serves all three call sites, the globals sheet is six columns like the object editor, and a repeater row honours each sub-field's declared width, except a nested container, which always spans the row.
  
  `SubField.admin.width` was offered by the type and read nowhere. It is read now, and a raw sub-field's `helpText` and `width` are accepted from either `admin` or `config.admin`, the top-level one winning, so there is one rule rather than two homes split by key.
  
  On the server, the repeater and component branches of the field validator checked row count and, on publish, required-ness, and never what a row actually held. Every row and block sub-field now goes through `validateFieldValue` itself, so it gets the per-type rules, its own `validation` config and recursion at any depth. Type-correctness is enforced on a draft save as well as a publish, because the draft is what reaches the column; required-ness stays publish-only and its message is unchanged.
  
  A global whose definition names no `icon` renders a fallback glyph instead of an empty grey square.
- Updated dependencies [fb4bd7a]
- Updated dependencies [a33a309]
- Updated dependencies [809bb12]
  - @tangen/schema@0.1.44
  - @tangen/types@0.3.0
  - @tangen/db@0.1.55
  - @tangen/graphql@0.1.26
  - @tangen/knowledge@0.1.25
  - @tangen/logging@0.0.25
  - @tangen/mcp@0.1.25
  - @tangen/porter@0.1.4

## 0.2.1

No changes in this release.

## 0.2.0

### Minor Changes

- The Gateway enforces CORS and rate limits by default, and the media library
  listing has a permission check.
  
  **Minor, not patch, deliberately.** Several of these change what an existing
  deployment's requests do, and on a 0.x line a minor is where that belongs:
  
  - **CORS** decides per workspace instead of answering from a process-wide
    union, so an origin declared by one workspace is no longer valid on
    another's routes. A deployment that relied on the union must declare its
    origins per workspace, or set `TANGEN_CORS_MODE=observe` for a migration
    window.
  - **Rate limits are on.** A request over budget now gets `429` with a
    `Retry-After` instead of passing. The budgets that matter are ones there was
    no equivalent of: `auth` at 20/min by IP, and `forms` at 10/min by IP and
    route. Public asset bytes are unaffected - a policy counting by API key does
    not apply to a browser fetching an image. An operator may run observe mode
    with `gateway.rateLimit.enabled: false`; a tenant cannot.
  - **Realtime ceilings enforce** on the same switch: a connection over the
    per-identity ceiling is refused at ticket redemption rather than opening.
  - **`GET /api/v1/media` requires `media:read`**, and every media read, write
    and localize path now honours `media.allowedFolders`. A key without the
    permission loses a listing it previously got.
  - **A preview token minted before this release is refused**, because a token
    now records whose field access it delegates and an old one records none.
    Reloading the preview mints a new one.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @tangen/types@0.2.0
  - @tangen/db@0.1.54
  - @tangen/graphql@0.1.25
  - @tangen/knowledge@0.1.24
  - @tangen/logging@0.0.24
  - @tangen/mcp@0.1.24
  - @tangen/porter@0.1.3
  - @tangen/schema@0.1.43
  - @tangen/studio-compiler@0.1.2
  - @tangen/studio-schema@0.1.2
