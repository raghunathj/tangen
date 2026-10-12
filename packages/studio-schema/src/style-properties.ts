/**
 * File Name: style-properties.ts
 * Purpose: The style property registry - the single declarative list that
 *          drives the Style panel, the CSS emission and validation.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: ONE list, three consumers. Adding a property is a data
 *          change here rather than eight edits across UI, emitter and
 *          validator - which is the only way a ~60-property surface stays
 *          maintainable.
 *
 *          `id` is the key stored on a class and must never change: renaming
 *          one orphans every stored value using it. `css` is what gets
 *          emitted, and the two are deliberately allowed to differ.
 */

export type StyleSectionId =
  | 'layout' | 'spacing' | 'size' | 'position'
  | 'typography' | 'background' | 'borders' | 'effects'

export interface StyleSection {
  id: StyleSectionId
  label: string
}

/** Panel order, top to bottom - the order a designer works in. */
export const STYLE_SECTIONS: readonly StyleSection[] = [
  { id: 'layout', label: 'Layout' },
  { id: 'spacing', label: 'Spacing' },
  { id: 'size', label: 'Size' },
  { id: 'position', label: 'Position' },
  { id: 'typography', label: 'Typography' },
  { id: 'background', label: 'Background' },
  { id: 'borders', label: 'Borders' },
  { id: 'effects', label: 'Effects' },
] as const

/** How a value is edited. Every kind needs a renderer in the Style panel. */
export type StyleControl = 'length' | 'number' | 'color' | 'enum' | 'text' | 'shadow'

import type { TokenRefFamily } from './token-ref'

export interface StyleProperty {
  /** Stored key on a class. NEVER rename - stored values are keyed by it. */
  id: string
  section: StyleSectionId
  label: string
  /** The CSS property emitted. */
  css: string
  control: StyleControl
  options?: readonly string[]
  units?: readonly string[]
  /**
   * The design-token family this property may reference. A picker offers
   * ONLY this family, so a spacing slot can never land on a colour. Absent
   * means the property takes literals only.
   */
  tokenFamily?: TokenRefFamily
  /**
   * `content`: the property lays out a block's CHILDREN, so it compiles to
   * the element that holds them rather than the block's outer wrapper. A
   * kit.section renders wrapper > section > inner > children; `display:flex`
   * on the wrapper lays out one child and the children never see it - the
   * reported "section layout does not change child behaviour". Properties
   * that describe the block as a child of ITS parent (align-self, flex-grow,
   * order) stay on the wrapper.
   * `text`: typography. The kit widgets give their text element its own
   * classes (`tg-heading`, `tg-text-2xl`), which beat anything merely
   * inherited from the wrapper - so typography lands on the text element
   * itself, where a later-loaded class of equal specificity wins.
   */
  target?: 'content' | 'text'
  /**
   * Only a design-token reference works here. A typed literal is refused
   * rather than emitted, because it would name something the stylesheet
   * never defined - CSS the browser parses and then silently ignores.
   */
  tokensOnly?: true
  /**
   * A free-text value must match this (a RegExp source, matched
   * case-insensitively). The registry is the only place that knows a
   * background image is not a bare path.
   */
  pattern?: string
  /** What the panel says when a value is refused. */
  hint?: string
  /** An example of the shape a free-text value takes, shown in the control. */
  placeholder?: string
  /**
   * Show only when another property holds one of these values. Flex controls
   * on a block element are noise, and a panel of inapplicable controls is
   * how a designer stops trusting it.
   */
  when?: { id: string; oneOf: readonly string[] }
}

const LEN = ['px', 'rem', '%', 'em', 'vh', 'vw'] as const
const LEN_NO_PCT = ['px', 'rem', 'em'] as const
const FLEX_ONLY = { id: 'display', oneOf: ['flex', 'inline-flex'] } as const
const FLEXGRID = { id: 'display', oneOf: ['flex', 'inline-flex', 'grid'] } as const

/**
 * What CSS will actually paint as an image. A bare path is the natural thing
 * to type and the one thing that cannot work: `background-image:/hero.jpg`
 * parses, applies nothing, and reports nothing.
 */
const IMAGE_VALUE = '^(none|url\\(|(repeating-)?(linear|radial|conic)-gradient\\(|image-set\\(|var\\()'

/** One entry per editable CSS property. */
export const STYLE_PROPERTIES: readonly StyleProperty[] = [
  // ── Layout ──────────────────────────────────────────────────────────────
  { id: 'display', target: 'content', section: 'layout', label: 'Display', css: 'display', control: 'enum',
    // inline-flex: an atomic inline box whose children lay out as flex -
    // computes exactly in all three engines. `inline` stays for site
    // components that render inline content; display-support.ts keeps it
    // off kit blocks, whose structure cannot honour it.
    options: ['block', 'flex', 'grid', 'inline-block', 'inline-flex', 'inline', 'none'] },
  { id: 'flex-direction', target: 'content', section: 'layout', label: 'Direction', css: 'flex-direction', control: 'enum',
    options: ['row', 'row-reverse', 'column', 'column-reverse'], when: FLEX_ONLY },
  { id: 'justify-content', target: 'content', section: 'layout', label: 'Justify', css: 'justify-content', control: 'enum',
    options: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around'], when: FLEXGRID },
  { id: 'align-items', target: 'content', section: 'layout', label: 'Align', css: 'align-items', control: 'enum',
    options: ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'], when: FLEXGRID },
  { id: 'flex-wrap', target: 'content', section: 'layout', label: 'Wrap', css: 'flex-wrap', control: 'enum',
    options: ['nowrap', 'wrap', 'wrap-reverse'], when: FLEX_ONLY },
  { id: 'gap', target: 'content', section: 'layout', label: 'Gap', css: 'gap', control: 'length', units: LEN_NO_PCT, when: FLEXGRID, tokenFamily: 'space' },
  { id: 'grid-template-columns', target: 'content', section: 'layout', label: 'Columns', css: 'grid-template-columns', control: 'text',
    when: { id: 'display', oneOf: ['grid'] } },
  // Flex CHILD properties: set on the item, not the container, so they are
  // never gated on this element's own display - the parent's is what matters,
  // and the panel cannot see it.
  { id: 'align-self', section: 'layout', label: 'Align self', css: 'align-self', control: 'enum',
    options: ['auto', 'flex-start', 'center', 'flex-end', 'stretch'] },
  { id: 'flex-grow', section: 'layout', label: 'Grow', css: 'flex-grow', control: 'number' },
  { id: 'flex-shrink', section: 'layout', label: 'Shrink', css: 'flex-shrink', control: 'number' },
  { id: 'order', section: 'layout', label: 'Order', css: 'order', control: 'number' },

  // ── Spacing - four sides, independently. The original ask. ──────────────
  { id: 'margin-top', section: 'spacing', label: 'Margin top', css: 'margin-top', control: 'length', units: LEN, tokenFamily: 'space' },
  { id: 'margin-right', section: 'spacing', label: 'Margin right', css: 'margin-right', control: 'length', units: LEN, tokenFamily: 'space' },
  { id: 'margin-bottom', section: 'spacing', label: 'Margin bottom', css: 'margin-bottom', control: 'length', units: LEN, tokenFamily: 'space' },
  { id: 'margin-left', section: 'spacing', label: 'Margin left', css: 'margin-left', control: 'length', units: LEN, tokenFamily: 'space' },
  { id: 'padding-top', section: 'spacing', label: 'Padding top', css: 'padding-top', control: 'length', units: LEN, tokenFamily: 'space' },
  { id: 'padding-right', section: 'spacing', label: 'Padding right', css: 'padding-right', control: 'length', units: LEN, tokenFamily: 'space' },
  { id: 'padding-bottom', section: 'spacing', label: 'Padding bottom', css: 'padding-bottom', control: 'length', units: LEN, tokenFamily: 'space' },
  { id: 'padding-left', section: 'spacing', label: 'Padding left', css: 'padding-left', control: 'length', units: LEN, tokenFamily: 'space' },

  // ── Size ────────────────────────────────────────────────────────────────
  { id: 'width', section: 'size', label: 'Width', css: 'width', control: 'length', units: LEN, tokenFamily: 'width' },
  { id: 'height', section: 'size', label: 'Height', css: 'height', control: 'length', units: LEN },
  { id: 'min-width', section: 'size', label: 'Min width', css: 'min-width', control: 'length', units: LEN, tokenFamily: 'width' },
  { id: 'min-height', section: 'size', label: 'Min height', css: 'min-height', control: 'length', units: LEN },
  { id: 'max-width', section: 'size', label: 'Max width', css: 'max-width', control: 'length', units: LEN, tokenFamily: 'width' },
  { id: 'max-height', section: 'size', label: 'Max height', css: 'max-height', control: 'length', units: LEN },
  { id: 'overflow', section: 'size', label: 'Overflow', css: 'overflow', control: 'enum',
    options: ['visible', 'hidden', 'scroll', 'auto'] },

  // ── Position ────────────────────────────────────────────────────────────
  { id: 'position', section: 'position', label: 'Position', css: 'position', control: 'enum',
    options: ['static', 'relative', 'absolute', 'fixed', 'sticky'] },
  { id: 'top', section: 'position', label: 'Top', css: 'top', control: 'length', units: LEN,
    when: { id: 'position', oneOf: ['relative', 'absolute', 'fixed', 'sticky'] } },
  { id: 'right', section: 'position', label: 'Right', css: 'right', control: 'length', units: LEN,
    when: { id: 'position', oneOf: ['relative', 'absolute', 'fixed', 'sticky'] } },
  { id: 'bottom', section: 'position', label: 'Bottom', css: 'bottom', control: 'length', units: LEN,
    when: { id: 'position', oneOf: ['relative', 'absolute', 'fixed', 'sticky'] } },
  { id: 'left', section: 'position', label: 'Left', css: 'left', control: 'length', units: LEN,
    when: { id: 'position', oneOf: ['relative', 'absolute', 'fixed', 'sticky'] } },
  { id: 'z-index', section: 'position', label: 'Z index', css: 'z-index', control: 'number' },

  // ── Typography ──────────────────────────────────────────────────────────
  // Tokens ONLY: the stylesheet loads exactly the workspace's font tokens
  // (see fontCss in studio-compiler), so a typed family named a face nothing
  // had downloaded and the browser quietly substituted a fallback.
  { id: 'font-family', target: 'text', section: 'typography', label: 'Font', css: 'font-family', control: 'text', tokenFamily: 'font',
    tokensOnly: true,
    hint: 'Fonts come from the workspace\'s font tokens, which is what the stylesheet loads. Add one in the workspace config to use it here.' },
  { id: 'font-size', target: 'text', section: 'typography', label: 'Size', css: 'font-size', control: 'length', units: LEN, tokenFamily: 'type' },
  { id: 'font-weight', target: 'text', section: 'typography', label: 'Weight', css: 'font-weight', control: 'enum',
    options: ['300', '400', '500', '600', '700', '800'] },
  { id: 'line-height', target: 'text', section: 'typography', label: 'Line height', css: 'line-height', control: 'number' },
  { id: 'letter-spacing', target: 'text', section: 'typography', label: 'Letter spacing', css: 'letter-spacing', control: 'length', units: LEN_NO_PCT },
  { id: 'text-align', target: 'text', section: 'typography', label: 'Align', css: 'text-align', control: 'enum',
    options: ['left', 'center', 'right', 'justify'] },
  { id: 'color', target: 'text', section: 'typography', label: 'Colour', css: 'color', control: 'color', tokenFamily: 'palette' },
  { id: 'text-transform', target: 'text', section: 'typography', label: 'Transform', css: 'text-transform', control: 'enum',
    options: ['none', 'uppercase', 'lowercase', 'capitalize'] },
  { id: 'text-decoration', target: 'text', section: 'typography', label: 'Decoration', css: 'text-decoration', control: 'enum',
    options: ['none', 'underline', 'line-through'] },

  // ── Background ──────────────────────────────────────────────────────────
  { id: 'background-color', section: 'background', label: 'Colour', css: 'background-color', control: 'color', tokenFamily: 'palette' },
  { id: 'background-image', section: 'background', label: 'Image', css: 'background-image', control: 'text',
    pattern: IMAGE_VALUE, placeholder: 'url(/hero.jpg)',
    hint: 'Wrap a path in url(...) - url(/hero.jpg) - or use a gradient. A bare path is ignored by the browser.' },
  { id: 'background-size', section: 'background', label: 'Size', css: 'background-size', control: 'enum',
    options: ['auto', 'cover', 'contain'] },
  { id: 'background-position', section: 'background', label: 'Position', css: 'background-position', control: 'enum',
    options: ['center', 'top', 'bottom', 'left', 'right'] },
  { id: 'background-repeat', section: 'background', label: 'Repeat', css: 'background-repeat', control: 'enum',
    options: ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'] },

  // ── Borders ─────────────────────────────────────────────────────────────
  { id: 'border-style', section: 'borders', label: 'Style', css: 'border-style', control: 'enum',
    options: ['none', 'solid', 'dashed', 'dotted'] },
  { id: 'border-color', section: 'borders', label: 'Colour', css: 'border-color', control: 'color', tokenFamily: 'palette' },
  { id: 'border-top-width', section: 'borders', label: 'Top', css: 'border-top-width', control: 'length', units: LEN_NO_PCT },
  { id: 'border-right-width', section: 'borders', label: 'Right', css: 'border-right-width', control: 'length', units: LEN_NO_PCT },
  { id: 'border-bottom-width', section: 'borders', label: 'Bottom', css: 'border-bottom-width', control: 'length', units: LEN_NO_PCT },
  { id: 'border-left-width', section: 'borders', label: 'Left', css: 'border-left-width', control: 'length', units: LEN_NO_PCT },
  { id: 'border-top-left-radius', section: 'borders', label: 'Top left', css: 'border-top-left-radius', control: 'length', units: LEN, tokenFamily: 'radius' },
  { id: 'border-top-right-radius', section: 'borders', label: 'Top right', css: 'border-top-right-radius', control: 'length', units: LEN, tokenFamily: 'radius' },
  { id: 'border-bottom-right-radius', section: 'borders', label: 'Bottom right', css: 'border-bottom-right-radius', control: 'length', units: LEN, tokenFamily: 'radius' },
  { id: 'border-bottom-left-radius', section: 'borders', label: 'Bottom left', css: 'border-bottom-left-radius', control: 'length', units: LEN, tokenFamily: 'radius' },

  // ── Effects ─────────────────────────────────────────────────────────────
  { id: 'opacity', section: 'effects', label: 'Opacity', css: 'opacity', control: 'number' },
  { id: 'box-shadow', section: 'effects', label: 'Shadow', css: 'box-shadow', control: 'shadow' },
  { id: 'transform', section: 'effects', label: 'Transform', css: 'transform', control: 'text' },
  { id: 'transition', section: 'effects', label: 'Transition', css: 'transition', control: 'text' },
  { id: 'cursor', section: 'effects', label: 'Cursor', css: 'cursor', control: 'enum',
    options: ['auto', 'pointer', 'default', 'not-allowed'] },
] as const

const BY_ID = new Map(STYLE_PROPERTIES.map((p) => [p.id, p]))

/** One property by its stored id, or null for an id the registry dropped. */
export function propertyById(id: string): StyleProperty | null {
  return BY_ID.get(id) ?? null
}

/** A section's properties, in registry order. */
export function propertiesInSection(section: StyleSectionId): StyleProperty[] {
  return STYLE_PROPERTIES.filter((p) => p.section === section)
}
