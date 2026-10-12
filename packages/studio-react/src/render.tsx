/**
 * File Name: render.tsx
 * Purpose: <StudioBlocks/> - the one component a site drops in to render a
 *          Builder Kit block tree - plus the per-block dispatcher: overrides
 *          first, then the built-in kit, then the unknown-_type policy.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Server-component-safe (no 'use client', no hooks).
 *          Every rendered block is wrapped in a plain <div data-tangen-block
 *          ={_key}> - one uniform stamp for built-ins, overrides and
 *          placeholders alike, which is what the Studio overlay outlines
 *          (same pattern as the dogfood site's renderer). kit.video is
 *          rendered THROUGH its 'use client' leaf with only serializable
 *          props, so Next App Router RSC boundaries stay legal.
 */
import { contentClassName, textClassName, sectionClassName, INSTANCE_BLOCK_TYPE } from '@tangen/studio-schema'
import type { CSSProperties, ReactNode } from 'react'
import { googleFontsUrl } from '@tangen/studio'
import type { BlockNode, RenderContext, StudioBlocksProps, WidgetRenderer } from './types'
import { slot, str } from './util'
import { creativeStyle } from './creative'
import { wornClasses } from './parts'
import { renderAccordion } from './widgets/accordion'
import { renderButtons } from './widgets/buttons'
import { renderContainer } from './widgets/container'
import { renderDiv } from './widgets/div'
import { renderDivider } from './widgets/divider'
import { renderForm } from './widgets/form'
import { renderGrid } from './widgets/grid'
import { renderHeading } from './widgets/heading'
import { renderIconList } from './widgets/icon-list'
import { renderImage } from './widgets/image'
import { renderLink } from './widgets/link'
import { renderList } from './widgets/list'
import { renderLoop } from './widgets/loop'
import { renderRichText } from './widgets/rich-text'
import { renderRow } from './widgets/row'
import { renderSection } from './widgets/section'
import { renderSpacer } from './widgets/spacer'
import { renderText } from './widgets/text'
import { VideoBlock } from './widgets/video'

/** The built-in Builder Kit, by canonical `_type`. */
const KIT: Record<string, WidgetRenderer> = {
  'kit.section': renderSection,
  'kit.row': renderRow,
  'kit.loop': renderLoop,
  'kit.container': renderContainer,
  'kit.div': renderDiv,
  'kit.grid': renderGrid,
  'kit.heading': renderHeading,
  'kit.text': renderText,
  'kit.image': renderImage,
  'kit.buttons': renderButtons,
  'kit.spacer': renderSpacer,
  'kit.divider': renderDivider,
  // The island: hand it ONLY serializable props, never the block object as
  // typed context or the render context (functions cannot cross the RSC
  // client boundary).
  'kit.video': (block) => <VideoBlock url={str(block.url) || undefined} aspect={str(block.aspect) || undefined} />,
  'kit.iconList': renderIconList,
  'kit.accordion': renderAccordion,
  'kit.form': renderForm,
  'kit.link': renderLink,
  'kit.list': renderList,
  'kit.richText': renderRichText,
}

function isBlock(value: unknown): value is BlockNode {
  return !!value && typeof value === 'object' && typeof (value as BlockNode)._type === 'string'
}

/**
 * One Studio wrapper value. Chrome lives under the reserved `_studio` key so
 * it can never collide with a developer's own prop names; the flat fallback
 * keeps content written before that move rendering, with no migration.
 */
function wrapper(block: BlockNode, name: string): unknown {
  const bag = block._studio
  if (bag && typeof bag === 'object' && !Array.isArray(bag)) {
    const inner = (bag as Record<string, unknown>)[name]
    if (inner !== undefined) return inner
  }
  return block[name]
}

/**
 * Layout blocks own their style props - the wrapper must not double-apply.
 * This is now the ONLY exclusion: the box set used to also require a `kit.`
 * prefix, which meant a developer's own component could be hidden per
 * breakpoint but never given a background. Studio supplies the wrapper to
 * every block, so the runtime honours it on every block.
 */
const SELF_STYLED = new Set(['kit.section', 'kit.row', 'kit.loop'])
const BREAKPOINTS = ['mobile', 'tablet', 'desktop'] as const

/**
 * v2 style depth, applied centrally on the per-block wrapper: the uniform
 * box set (background/color/padding/rounded token slots) for kit widgets,
 * and tg-hide-* visibility classes for EVERY block (overrides included -
 * hiding is universal, styling belongs to whoever renders). kit.image keeps
 * `rounded` for the image itself, so the wrapper skips it there. Returns
 * only what the block asks for - a style-less block gets a pristine wrapper.
 */
/** Blocks that render an inner element holding their children. */
const CONTENT_SLOT = new Set(['kit.section', 'kit.row', 'kit.container', 'kit.div', 'kit.grid'])

/** Blocks whose widget places the text class itself - on its text element,
 *  or on the content element so children inherit. Everything else wears it
 *  on the wrapper, where inheritance still reaches a text child. */
const TEXT_SLOT = new Set(['kit.section', 'kit.row', 'kit.container', 'kit.div', 'kit.grid', 'kit.heading', 'kit.text', 'kit.link'])

/** The derived classes for the element carrying a block's text. */
export function textClassNames(block: BlockNode): string[] {
  return wornClasses(block).map(textClassName)
}

/**
 * The derived classes the element holding a block's children wears, so the
 * compiler's container-layout rules (`.hero--content{display:flex}`) reach
 * the children. See @tangen/studio-schema content-class.ts for why this is a
 * derived class and not a combinator. A Style Part's class is the third
 * derived class, stamped by the widget that owns the part - see parts.ts.
 */
export function contentClassNames(block: BlockNode): string[] {
  return wornClasses(block).map(contentClassName)
}

function wrapperProps(block: BlockNode): { className?: string; style?: CSSProperties } {
  const classes: string[] = []
  const hideOn = wrapper(block, 'hideOn')
  if (Array.isArray(hideOn)) {
    for (const bp of BREAKPOINTS) {
      if ((hideOn as unknown[]).includes(bp)) classes.push(`tg-hide-${bp}`)
    }
  }
  // The Studio style classes. This is the seam the whole class-based styling
  // system hangs on: the stylesheet emits `.hero { ... }`, and a block that
  // wears `hero` is what makes that rule apply. It was missing, so every
  // class-based style - resize, box model, tokens, interactions - compiled
  // correctly and reached no element. Names are validated here as well as
  // at the store, because a block arrives as data and data is not trusted.
  classes.push(...wornClasses(block))
  // A block with no inner content element lays its children out on the
  // wrapper itself, so the wrapper wears the derived class too. Blocks WITH
  // one (section, row) put it on the inner element instead.
  if (!CONTENT_SLOT.has(block._type)) {
    for (const name of contentClassNames(block)) classes.push(name)
  }
  if (!TEXT_SLOT.has(block._type)) {
    for (const name of textClassNames(block)) classes.push(name)
  }
  // The block's OWN raw CSS (X-T1) compiles to one generated class, and the
  // wrapper is the element it means - the block's public root, where every
  // workspace class lands. Stamped only when there is CSS to scope: a page
  // that never used the escape hatch renders byte-identical, and its
  // artifact id (a hash of the render) stays put.
  // Read from the bag only, never the flat fallback: a flat `css` prop is
  // the developer's own.
  const bag = block._studio
  const own = bag && typeof bag === 'object' && !Array.isArray(bag) ? (bag as Record<string, unknown>).css : undefined
  if (typeof own === 'string' && own.trim() !== '') {
    const section = sectionClassName(block._key)
    if (section) classes.push(section)
  }
  const style: CSSProperties = {}
  if (!SELF_STYLED.has(block._type)) {
    const background = wrapper(block, 'background')
    const color = wrapper(block, 'color')
    const padding = wrapper(block, 'padding')
    const rounded = wrapper(block, 'rounded')
    if (typeof background === 'string') {
      const bg = slot(background, 'default')
      classes.push('tg-box', `tg-bg-${bg}`)
      style.backgroundColor = `var(--tg-bg-${bg})`
    }
    if (typeof color === 'string') {
      const fg = slot(color, 'default')
      classes.push('tg-box', `tg-fg-${fg}`)
      style.color = `var(--tg-fg-${fg})`
    }
    if (typeof padding === 'string') {
      const pad = slot(padding, 'none')
      classes.push('tg-box', `tg-boxpad-${pad}`)
      style.padding = `var(--tg-space-${pad})`
    }
    if (block._type !== 'kit.image' && typeof rounded === 'string') {
      const r = slot(rounded, 'none')
      classes.push('tg-box', `tg-boxround-${r}`)
      style.borderRadius = `var(--tg-radius-${r})`
    }
  }
  // Creative overrides layer ON TOP: applied last, so they win per property
  // while every property the author did not override keeps its token value.
  // A block with no usable overrides contributes nothing, which is what
  // keeps governed blocks byte-identical.
  const creative = creativeStyle(block.styleCreative)
  Object.assign(style, creative.style)
  classes.push(...creative.classes)

  const className = classes.length > 0 ? [...new Set(classes)].join(' ') : undefined
  return {
    ...(className ? { className } : {}),
    ...(Object.keys(style).length > 0 ? { style } : {}),
  }
}

/**
 * Renders one Builder Kit block tree. Server-component-safe; drop it into a
 * Next App Router page (or any React 18+ renderer) as-is.
 */
/** Slots a block may nest children under - kept in step with the renderer. */
const NEST_SLOTS = ['children', 'col1', 'col2', 'col3', 'itemTemplate', 'emptyState', 'errorState']

/** Every webfont family used anywhere in the tree. */
function collectFontFamilies(blocks: unknown, out: Set<string> = new Set()): Set<string> {
  if (!Array.isArray(blocks)) return out
  for (const entry of blocks) {
    if (!entry || typeof entry !== 'object') continue
    const block = entry as Record<string, unknown>
    const bag = block.styleCreative
    if (bag && typeof bag === 'object') {
      const family = (bag as Record<string, unknown>).fontFamily
      if (typeof family === 'string' && family !== '') out.add(family)
    }
    for (const slot of NEST_SLOTS) collectFontFamilies(block[slot], out)
  }
  return out
}

export function StudioBlocks({ blocks, components, formRenderer, unknown = 'skip', loopData }: StudioBlocksProps): ReactNode {
  if (!Array.isArray(blocks) || blocks.length === 0) return null

  // Webfonts are LOADED here, not merely referenced. A site that had to add
  // its own <link> for every font a marketer picked would need a deploy per
  // font choice, which is exactly the build step Studio exists to avoid.
  // Only families the curated list knows are requested - the URL is built
  // from stored values and must never become a pass-through.
  const fontHref = googleFontsUrl([...collectFontFamilies(blocks)])

  const ctx: RenderContext = {
    formRenderer,
    loopData,
    renderList: (nested: unknown) => renderList(nested, ctx),
  }

  function renderList(nested: unknown, context: RenderContext): ReactNode {
    if (!Array.isArray(nested) || nested.length === 0) return null
    return nested.map((entry, i) => {
      if (!isBlock(entry)) return null
      if (entry._disabled === true) return null
      const key = typeof entry._key === 'string' && entry._key !== '' ? entry._key : undefined
      const wrap = wrapperProps(entry)
      const Override = components?.[entry._type]
      if (Override) {
        return (
          <div key={key ?? `${entry._type}-${i}`} data-tangen-block={key} {...wrap}>
            <Override block={entry} />
          </div>
        )
      }
      const widget = KIT[entry._type]
      if (widget) {
        return (
          <div key={key ?? `${entry._type}-${i}`} data-tangen-block={key} {...wrap}>
            {widget(entry, context)}
          </div>
        )
      }
      if (unknown === 'placeholder') {
        return (
          <div
            key={key ?? `${entry._type}-${i}`}
            data-tangen-block={key}
            {...wrap}
            className={wrap.className ? `tg-unknown ${wrap.className}` : 'tg-unknown'}
          >
            {/* A reference reaching the dispatcher means composition could
                not resolve it: the instance is unpublished, deleted, or part
                of a cycle. Said as itself rather than as "unknown block",
                which would send a designer looking for a missing renderer.
                The id is deliberately not shown - it is not a fact anyone
                outside Studio can act on. */}
            {entry._type === INSTANCE_BLOCK_TYPE
              ? 'This instance is not published here yet.'
              : `Unknown block: ${entry._type}`}
          </div>
        )
      }
      return null
    })
  }

  return (
    <>
      {fontHref && <link rel="stylesheet" href={fontHref} />}
      {renderList(blocks, ctx)}
    </>
  )
}
