# @tangen/sdk

## 0.4.1

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangen/types@0.6.0

## 0.4.0

### Minor Changes

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

### Patch Changes

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
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangen/types@0.5.0

## 0.3.0

### Minor Changes

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

### Patch Changes

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
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [120fff5]
  - @tangen/types@0.4.0

## 0.2.0

### Minor Changes

- a33a309: A link can point at a path on your own site.
  
  A real publish failed on `{ type: 'external', url: '/design' }`, and the refusal was correct: a relative URL is not an absolute one. The design was wrong, not the value. A site has routes that are not content objects, and neither existing branch took them: `internal` stores `{ type, id }` and a hand-built route has no object to point at, while `external` stores an absolute URL, so putting `https://acme.com/pricing` in content makes staging link to production. The error even said "use an internal link for content in this workspace", which is advice that cannot be followed when there is no entry to pick.
  
  `LINK_KINDS` gains `path`. It stores `{ type: 'path', path: '/pricing' }`, verbatim, and a read returns one derived href the way the external branch does. Nothing is loaded to produce it, because the application owns that route.
  
  This reads the existing boundary from the other side rather than bending it. "Tangen resolves content identity; the application resolves site routing" - and a path IS site routing, so Tangen resolves nothing about it and can be wrong about nothing. The objection that a stored path breaks when a route moves is a content objection: a slug rename is a content action nobody tracks, while `/pricing` is a route its own developer moves in code and knows they moved. Where the destination genuinely is an entry, `internal` still gives exactly that protection.
  
  One value is refused: a path beginning `//`, such as `//example.com/x`. It reads as a path and is protocol-relative, so it leaves the site. That is what makes this branch more than "a string starting with a slash", and it has its own gate. An absolute URL in the path box answers the new `absolute` reason with its scheme, a path in the URL box answers `relative`, and each message now names the branch that would take the value instead of guessing at the author's intent.
  
  **The editor reports a bad destination where it is typed.** `type="url"` on the input did nothing: native constraint validation surfaces only on a form submit, and these are controlled inputs with no form, so `/design` saved into the draft in silence and surfaced as a failed publish on another screen. The dialog now says what is wrong when you leave the box, and a `?` or `#` typed into the path box moves into the Postfix instead of being swallowed by normalization.
  
  New in `@tangen/sdk`: `isPathLink`, and `linkHref(link)` for the two branches that already carry an href, returning `null` for an internal link whose path only your router can build. `tangen types` emits `TangenPathLink` and narrows a field to exactly the branches it offers.
  
  An existing field keeps what it declared: `allowedKinds: ['internal', 'external']` still offers those two, and only an undeclared field widens to all three.

### Patch Changes

- Updated dependencies [a33a309]
- Updated dependencies [809bb12]
  - @tangen/types@0.3.0

## 0.1.45

### Patch Changes

- Registry metadata: these packages pointed at the private development
  monorepo, so each one's page on npm linked to a repository nobody outside
  could open. They now name the public repository and carry the `homepage` and
  `bugs` fields npm renders.
  
  A patch rather than nothing, because a manifest only reaches the registry with
  a new version.
- Updated dependencies
  - @tangen/types@0.2.0
