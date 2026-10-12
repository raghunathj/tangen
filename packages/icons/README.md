# @tangen/icons

The Tangen icon set: ~100 curated, SELF-CONTAINED SVG components (no runtime
remixicon import), plus the full Remix Icon pack behind a lazy subpath.

## Why this shape

`@remixicon/react` ships one 2.3MB module. Any static import of it drags the
whole pack into every eager bundle (single-module granularity defeats
tree-splitting once a namespace consumer exists). So:

- `@tangen/icons` (the barrel) exports only the curated `Icon*` components,
  generated as standalone SVG snapshots - eager bundles carry ~46KB of icons.
- `@tangen/icons/all` re-exports the full `@remixicon/react` namespace. Import
  it ONLY dynamically (the admin's `DynamicIcon` and the schema builder's icon
  picker do); a static import would pull the 2.3MB pack back into the entry.

## Adding an icon

1. Add the alias line in `src/remix-aliases.ts` (`RiSomethingLine as IconSomething`).
   That file is the source of truth; it is parsed as text, never imported.
2. Run `bun scripts/generate-curated.tsx` (from `packages/admin`, which has
   react-dom) - regenerates `src/curated.tsx`.
3. Add the name to `ICON_NAMES` in `@tangen/types` (`src/object-types.ts`) -
   the drift test in `__tests__/icon-names.test.ts` fails until both match.

Raw `Ri*` names in configs keep working - `DynamicIcon` resolves them from the
lazy full pack.
