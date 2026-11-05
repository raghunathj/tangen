# @tangen/schema

## 0.2.2

### Patch Changes

- A component that may contain itself no longer takes down the workspace config.
  
  Resolving component references expanded them by name with no end, so a
  self-referential component, or two that name each other, threw
  `RangeError: Maximum call stack size exceeded` while the workspace config was
  loading. That took the whole workspace down rather than one type.
  
  The guard is per PATH rather than global, so two sibling branches may both
  expand the same component, because that is reuse rather than recursion. A name
  already being expanded is left as the name it was authored as, which is the
  shape an unresolved reference already has everywhere downstream.
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangen/types@0.6.0

## 0.2.1

### Patch Changes

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
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangen/types@0.5.0

## 0.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [d54f1ba]
- Updated dependencies [120fff5]
  - @tangen/types@0.4.0

## 0.1.44

### Patch Changes

- fb4bd7a: Two presentation controls the platform defines, and a sub-field that says what it falls back to.
  
  `blockPresentationFields()` gives an `anchorId` (slug-validated DOM id and URL fragment) and a `className` (design-system utility classes, applied verbatim), both declaring `group: 'advanced'` so they land on a block's Advanced tab. That is where Gutenberg keeps an HTML anchor and additional CSS classes too. A class list is never parsed back, the same contract Studio gives its escape-hatch classes: a class that does not exist does nothing, which is what separates it from a free-form stylesheet field. Its only validation is that it cannot contain what would close an attribute or open a tag.
  
  A project spreads them into the blocks that want them, through one shared function of its own. An earlier version of this declared named sets in the workspace config and injected them into every block and repeater; that is gone, along with its config slot, its two `ComponentDef` keys, the resolver's third argument and a reader for the loaded project. It worked and it was worse: a block whose schema file lists six fields while the block has ten is how an author loses track of their own component, and a shared function already gives the "change it once" property that injection was supposed to buy.
  
  Separately, `config.default` on a sub-field was offered by the type and read nowhere. The editor now names the fallback while the value is empty, resolving a select's default through its option labels rather than its stored value, in a block card and a repeater row alike.
  
  That is a hint and never a write, which matters on existing content: add a control to a block a hundred pages already use and all hundred have no value for it. Writing the default in would be a hundred revisions and would freeze the value, so a later change to the design default would move none of them. Absent-means-default is what lets one line of code change every page at once, so the editor's job is to say what absent resolves to. The frontend side of the contract is to read `block.spacing ?? 'normal'`.
- Updated dependencies [a33a309]
- Updated dependencies [809bb12]
  - @tangen/types@0.3.0

## 0.1.43

### Patch Changes

- Registry metadata: these packages pointed at the private development
  monorepo, so each one's page on npm linked to a repository nobody outside
  could open. They now name the public repository and carry the `homepage` and
  `bugs` fields npm renders.
  
  A patch rather than nothing, because a manifest only reaches the registry with
  a new version.
- Updated dependencies
  - @tangen/types@0.2.0
