/**
 * File Name: generate-curated.tsx
 * Purpose: Generates src/curated.tsx - the Tangen icon set as SELF-CONTAINED
 *          components (SVG markup snapshotted from @remixicon/react), so the
 *          barrel has no runtime remixicon import and the 2.3MB single-file
 *          pack stays out of every eager chunk. Run after editing the alias
 *          list in src/remix-aliases.ts:  bun scripts/generate-curated.tsx
 *
 * Author: Raghunath J
 * License: MIT
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
// Resolved from the admin package (icons itself has no react-dom dep).
import { createElement } from '../../admin/node_modules/react/index.js'
import { renderToStaticMarkup } from '../../admin/node_modules/react-dom/server.browser.js'
import * as Remix from '@remixicon/react'

// The alias list lives in src/remix-aliases.ts as `RiX as IconY` re-export pairs -
// parse it so there is exactly one place to add icons.
const indexSrc = readFileSync(join(import.meta.dir, '..', 'src', 'remix-aliases.ts'), 'utf8')
const pairs: Array<[string, string]> = []
for (const m of indexSrc.matchAll(/(Ri[A-Za-z0-9]+)\s+as\s+(Icon[A-Za-z0-9]+)/g)) {
  pairs.push([m[1], m[2]])
}
if (pairs.length === 0) throw new Error('no alias pairs found in src/index.ts')

const seen = new Set<string>()
const comps: string[] = []
for (const [ri, alias] of pairs) {
  if (seen.has(alias)) continue
  seen.add(alias)
  const Comp = (Remix as Record<string, unknown>)[ri] as React.ComponentType | undefined
  if (!Comp) throw new Error(`@remixicon/react has no export ${ri} (alias ${alias})`)
  const markup = renderToStaticMarkup(createElement(Comp))
  const inner = markup.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
  const viewBox = markup.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 24 24'
  comps.push(
    `export const ${alias} = mk(${JSON.stringify(viewBox)}, ${JSON.stringify(inner)})`,
  )
}

const out = `/**
 * File Name: curated.tsx
 * Purpose: GENERATED - the Tangen icon set as self-contained SVG components
 *          (snapshotted from @remixicon/react by scripts/generate-curated.tsx;
 *          do not edit by hand). Keeping these free of any remixicon import is
 *          what keeps the 2.3MB single-file pack out of eager bundles - the
 *          full pack stays available lazily via '@tangen/icons/all'.
 *
 * Author: Raghunath J
 * License: MIT (icon artwork: Remix Icon, Apache-2.0)
 */
import { createElement, forwardRef } from 'react'
import type { SVGProps } from 'react'

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number | string
  color?: string
}

function mk(viewBox: string, inner: string) {
  return forwardRef<SVGSVGElement, IconProps>(function Icon(
    { size = 24, color = 'currentColor', ...rest }, ref,
  ) {
    return createElement('svg', {
      ref, xmlns: 'http://www.w3.org/2000/svg', viewBox,
      width: size, height: size, fill: color,
      dangerouslySetInnerHTML: { __html: inner },
      ...rest,
    })
  })
}

${comps.join('\n')}
`
writeFileSync(join(import.meta.dir, '..', 'src', 'curated.tsx'), out)
console.log(`generated ${seen.size} curated icons`)
