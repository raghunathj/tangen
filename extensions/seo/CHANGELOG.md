# @tangen/ext-seo

## 0.2.5

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @tangen/ui@0.2.6
  - @tangen/sdk@0.4.0
  - @tangen/icons@0.1.2
  - @tangen/cms@0.2.4

## 0.2.4

### Patch Changes

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
- Updated dependencies [d54f1ba]
- Updated dependencies [120fff5]
- Updated dependencies [d54f1ba]
  - @tangen/sdk@0.3.0
  - @tangen/ui@0.2.5
  - @tangen/icons@0.1.1
  - @tangen/cms@0.2.3

## 0.2.3

### Patch Changes

- bbab122: A `@tangen` peer now declares the line it works with instead of `*`.
  
  `*` says "compatible with every version of this package, past and future".
  It is never true, and it was the only thing npm could have used to warn a
  site that an extension and the platform had drifted apart. It also hid the
  packages from the release tooling: a `*` peer cannot be taken out of range,
  so `changeset version` had no reason to release an extension when the
  platform moved under it, and the old `fixed` group was republishing all of
  them on every patch instead - with their declared compatibility byte for
  byte the same as the version before.
  
  The convention is `^<major>.<minor>` with no patch, which reads as "any patch
  inside this minor line". The patch is deliberately absent: on a 0.0.x package
  a caret pins it, so `^0.0.26` would admit only 0.0.26 and a single
  `@tangen/icons` patch would put every extension out of range at once. `^0.0`
  admits every 0.0.x, `^0.2` every 0.2.x.
  
  A release gate now refuses a `*` peer on a workspace package, and refuses a
  range that no longer admits the version that package is on, so this cannot go
  stale quietly.
- Updated dependencies [4edc9c1]
  - @tangen/icons@0.1.0
  - @tangen/ui@0.2.4

## 0.2.2

### Patch Changes

- Updated dependencies [a33a309]
- Updated dependencies [3b6e5d5]
  - @tangen/sdk@0.2.0
  - @tangen/ui@0.2.2
  - @tangen/cms@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies
  - @tangen/cms@0.2.1
  - @tangen/ui@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies
  - @tangen/icons@0.0.26
  - @tangen/sdk@0.1.45
  - @tangen/cms@0.2.0
  - @tangen/ui@0.2.0
