/**
 * File Name: stylesheet.ts
 * Purpose: Generates the CSS a site loads - token values, tag defaults,
 *          classes and their per-breakpoint and per-state overrides.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The LAST line before stored values become CSS text, so
 *          it escapes defensively even though the write path validates too. A
 *          value carrying `}` could close its rule and write its own - the
 *          one way a class could restyle a whole site.
 *
 *          Output is grouped BY BREAKPOINT, not by selector: every base rule
 *          first, then one `@media` per breakpoint containing every override
 *          for it. A narrower breakpoint's block therefore always sits after
 *          every base rule and wins, whichever class declared it.
 *
 *          Order is stable everywhere - classes by name (code point order, see
 *          cascade.ts), properties by id - because the served ETag is a hash
 *          of this string, and a churning hash would break caching on every
 *          save. Class order is also the CASCADE: with one global stylesheet
 *          and one rule per class there is no "application order" to honour,
 *          so the alphabetically later class is the one that wins.
 */
import {
  propertyById, fontStack, googleFontsUrl,
  readValue, hasOverride, BREAKPOINTS, STATES,
  type StoredValue, type Breakpoint, type StyleState, parseTokenRef, tokenRefToVar, contentClassName,
  styleValueError, compareClassNames, textClassName, type StyleProperty,
} from '@tangen/studio-schema'
import { safeRawCss } from './raw-css'

export interface StyleRule {
  /** Class name without the dot. */
  name: string
  props: Record<string, StoredValue>
  /** The raw-CSS escape hatch, emitted inside this rule only. */
  custom?: string
  /**
   * The rule lands on ONE element - every declaration goes on the selector
   * itself, like a tag default, and no derived `--text` / `--content` rule
   * is written. A Style Part is one element (a button, an image, an item)
   * and wears exactly one class, so a rule split across derived classes
   * would style nothing there.
   */
  oneElement?: boolean
}

export interface TagDefault {
  tag: string
  props: Record<string, StoredValue>
}

/** A named font and where it comes from - mirrors the config token. */
export interface StylesheetFont {
  name: string
  google?: string
  files?: Array<{ url: string; weight?: number; style?: string }>
  stack?: string
}

export interface StylesheetInput {
  /** Named fonts to LOAD and expose as --tg-font-<name>. */
  fonts?: StylesheetFont[]
  /** Design token values: slot name -> value, emitted as --tg-<name>. */
  tokens?: Record<string, string>
  tagDefaults?: TagDefault[]
  classes?: StyleRule[]
}

/** Widths the breakpoints mean - the runtime's existing boundaries. */
const MEDIA: Record<Exclude<Breakpoint, 'base'>, string> = {
  tablet: '(max-width: 63.999rem)',
  mobile: '(max-width: 47.999rem)',
}

/**
 * Tag defaults are scoped to Studio-rendered content: a bare `h2 {}` would
 * restyle the SITE's own header and footer, which Studio neither owns nor
 * authored. `data-tangen-block` is stamped on every rendered block, live as
 * well as in preview.
 *
 * `:where()` contributes ZERO specificity, so the selector scores the same as
 * a bare tag. Without it this would be (0,1,1) and BEAT every class,
 * inverting the cascade the four levels depend on.
 */
const TAG_SCOPE = ':where([data-tangen-block])'

/** A selector fragment we are willing to write. */
const SAFE_NAME = /^[a-zA-Z_][a-zA-Z0-9_-]*$/
/** A declaration value that cannot terminate its own rule. */
const UNSAFE_VALUE = /[{};<>]/
const FORBIDDEN = ['@import', '@charset', 'expression(', 'javascript:', '</']

/**
 * Why this declaration value cannot be emitted, or null when it can be.
 *
 * The EMITTER's rule, named. `safeValue` is the emitter's own use of it, and
 * Porter's Studio provider is the other: a `class:` or `tag:` row arriving
 * from another environment carries values that will land in a stylesheet
 * every published page loads, and refusing one with a reason is worth more
 * than emitting the row and silently dropping the declaration.
 */
export function declarationValueError(value: unknown): string | null {
  if (typeof value !== 'string') return 'a declaration value must be text'
  const v = value.trim()
  if (v === '') return 'a declaration value cannot be empty'
  if (v.length > 200) return 'a declaration value is limited to 200 characters'
  if (UNSAFE_VALUE.test(v)) return 'a declaration value cannot contain braces, semicolons or angle brackets'
  const lower = v.toLowerCase()
  const bad = FORBIDDEN.find((needle) => lower.includes(needle))
  return bad ? `a declaration value cannot contain "${bad}"` : null
}

function safeValue(value: string | undefined): string | null {
  return declarationValueError(value) === null ? value!.trim() : null
}

/**
 * Raw CSS, allowed to carry semicolons (it is several declarations) but never
 * a brace - that is the difference between styling this class and styling the
 * whole document. The rules live in raw-css.ts, shared with the write path
 * and every panel, so what a panel accepts is what this writes.
 */
function safeCustom(value: string | undefined): string | null {
  return safeRawCss(value)
}

/** The element of a block a property lands on. */
type Target = 'wrapper' | 'content' | 'text'

const HEIGHTS = new Set(['height', 'min-height', 'max-height'])
const LAYOUT_DISPLAY = /^(inline-)?(flex|grid)$/

/**
 * Whether this class makes the CONTENT element the layout container - flex
 * or grid at any breakpoint or state.
 */
function layoutOnContent(props: Record<string, StoredValue>): boolean {
  const display = props.display
  if (display === undefined) return false
  for (const state of STATES) {
    for (const breakpoint of BREAKPOINTS) {
      const v = readValue(display, { state, breakpoint })
      if (typeof v === 'string' && LAYOUT_DISPLAY.test(v.trim())) return true
    }
  }
  return false
}

/**
 * Where an authored property goes. The designer styles the Block; the
 * wrapper, content and text elements are the renderer's business, and this
 * is the one place that knows about them.
 *
 * Height follows the layout it controls: when the class turns the content
 * element into a flex or grid container, `height`, `min-height` and
 * `max-height` go there too - otherwise a column `space-between` has no free
 * space to distribute, because the height sat on the wrapper one level up.
 * Decided once per class, so a breakpoint override of the height lands on
 * the same element as its base value.
 */
function targetOf(id: string, property: StyleProperty, props: Record<string, StoredValue>): Target {
  if (HEIGHTS.has(id)) return layoutOnContent(props) ? 'content' : 'wrapper'
  return property.target ?? 'wrapper'
}

/** True when any hover or focus value is set, at any breakpoint. */
function hasStateOverride(value: StoredValue | undefined): boolean {
  for (const state of STATES) {
    if (state === 'normal') continue
    for (const breakpoint of BREAKPOINTS) {
      if (hasOverride(value, { state, breakpoint })) return true
    }
  }
  return false
}

/**
 * The custom property through which a block's wrapper hands a state value
 * to its own content or text element. `--` cannot occur inside a normalised
 * class name, so the name cannot collide with another class's.
 */
function stateVar(name: string, css: string): string {
  return `--tg-${name}--${css}`
}

/**
 * Declarations for one element of one class at one breakpoint and state.
 *
 * States on the inner targets are the subtle part. A hover on a section is
 * a hover on its WRAPPER - the pointer may be over the padding, nowhere near
 * the text - so `.s--text:hover` would only fire over the text itself, and
 * `.s:hover .s--text` is a combinator, which no workspace rule may ever
 * emit: a combinator is how a rule reaches inside a Block. Instead the
 * wrapper's own state rule sets a custom property scoped to this class,
 * `--tg-s--color`, and the text rule reads it: `color:var(--tg-s--color,
 * #111)`. Custom properties inherit, so the text element sees the wrapper's
 * hover value; no selector reaches anywhere; and a block whose one element
 * wears both classes resolves the variable on itself. `display` is the one
 * exception - it is already split per element and keeps a plain state rule.
 */
function declarations(
  name: string,
  props: Record<string, StoredValue>,
  state: StyleState,
  breakpoint: Breakpoint,
  target: Target | 'all' = 'wrapper',
): string[] {
  const out: string[] = []
  // The wrapper's state rule carries the inner targets' state values.
  const scoped: string[] = []
  const atBase = breakpoint === 'base' && state === 'normal'
  // The kit's content element stacks children as a flex COLUMN by default.
  // When the designer turns on flex and says nothing about direction, CSS
  // semantics say the container is a row - so the initial value is declared
  // rather than letting the kit's default answer a question it was not asked.
  if (target === 'content' && !('flex-direction' in props)) {
    const d = atBase ? readValue(props.display, {}) : (hasOverride(props.display, { state, breakpoint }) ? readValue(props.display, { state, breakpoint }) : undefined)
    if (typeof d === 'string' && /^(inline-)?flex$/.test(d.trim())) out.push('flex-direction:row')
  }
  for (const id of Object.keys(props).sort()) {
    const property = propertyById(id)
    if (!property) continue    // an id the registry dropped
    const value = props[id]
    // Base emits whatever applies; a narrower breakpoint or a state emits
    // ONLY what it overrides, or every rule would repeat the whole block.
    const applies = atBase
      ? readValue(value, {})
      : hasOverride(value, { state, breakpoint })
        ? readValue(value, { state, breakpoint })
        : undefined

    // Refuse anything a browser would parse and then silently ignore. The
    // check runs on the STORED value, so a token reference is judged against
    // the family it names rather than against the var() it becomes - see
    // style-validate.ts, which the Style panel reads too so the designer is
    // told the same thing before the save rather than after the publish.
    if (styleValueError(property, applies)) continue
    const resolved = resolveToken(applies, id, property.tokenFamily)
    const safe = resolved === undefined ? null : safeValue(resolved)

    // A tag default styles the tag element itself, so every target lands on
    // that one element and nothing is split or scoped.
    if (target === 'all') {
      if (safe) out.push(`${property.css}:${safe}`)
      continue
    }

    // `display` belongs to BOTH elements: CSS display sets an element's outer
    // type (how it sits in its parent) and its inner type (how its children
    // lay out), and those land on different elements once a block has an
    // inner content element - see displayFor.
    if (id === 'display') {
      const split = displayFor(resolved, target)
      const safeSplit = split === undefined ? null : safeValue(split)
      if (safeSplit) out.push(`display:${safeSplit}`)
      continue
    }

    const wants = targetOf(id, property, props)
    // font-size is a text property, but on a one-element class it is also
    // what `em` units on width and padding resolve against. An ABSOLUTE size
    // is therefore declared on the wrapper as well, so `width:10em` with
    // `font-size:20px` measures 200px the way it would on one element. A
    // relative size (em, %) stays on the text element alone - declared on
    // both it would compound, 120% of 120%.
    const dual = id === 'font-size' && target === 'wrapper' && isAbsoluteLength(resolved)

    if (target === 'wrapper') {
      if (wants === 'wrapper' || dual) {
        if (safe) out.push(`${property.css}:${safe}`)
        if (!dual || wants === 'wrapper') continue
      }
      // An inner target's state value travels through the wrapper's rule.
      if (state !== 'normal' && safe) scoped.push(`${stateVar(name, property.css)}:${safe}`)
      continue
    }

    if (wants !== target) continue
    // The inner targets carry no state rule of their own - see above.
    if (state !== 'normal') continue
    if (!hasStateOverride(value)) {
      if (safe) out.push(`${property.css}:${safe}`)
      continue
    }
    // A state value exists somewhere, so this rule reads the variable, with
    // its own value as the fallback. With no value of its own at base the
    // reference still has to exist, or the wrapper would set a variable
    // nothing reads.
    if (safe) out.push(`${property.css}:var(${stateVar(name, property.css)},${safe})`)
    else if (atBase) out.push(`${property.css}:var(${stateVar(name, property.css)})`)
  }
  return [...out, ...scoped]
}

/** A length that does not depend on the element's own font: px, rem, pt, or a token. */
function isAbsoluteLength(value: string | undefined): boolean {
  if (value === undefined) return false
  const v = value.trim()
  return /^var\(/.test(v) || /^-?\d*\.?\d+(px|rem|pt)$/.test(v)
}

/**
 * The half of a `display` value each element gets.
 *
 * Outer type to the wrapper: a block stays a block in its parent, an inline
 * variant sits inline, `none` hides the whole block, `contents` dissolves it.
 * Inner type to the content element: flex stays flex, grid stays grid, the
 * inline variants lose their prefix because the content element's own
 * placement is the wrapper's business, and `block`/`inline`/`inline-block`
 * all mean "flow layout" for the children.
 *
 * A block with no inner element wears BOTH classes on one element. Its
 * content rule is emitted first and its wrapper rule second, so the exact
 * value the designer chose wins there - the split is only ever visible where
 * two elements exist.
 */
function displayFor(value: string | undefined, target: Target | 'all'): string | undefined {
  if (value === undefined || target === 'text') return undefined
  const v = value.trim().toLowerCase()
  if (target === 'wrapper') {
    // Only an outer type that CHANGES the wrapper is declared on it. block,
    // flex and grid all sit as a block in the parent, which the wrapper
    // already is - and declaring `block` there would override the content
    // rule on a single-element block that wears both classes.
    if (v === 'none' || v === 'contents' || v === 'inline' || v.startsWith('inline-')) return v
    return undefined
  }
  if (v === 'none' || v === 'contents') return v
  if (v === 'flex' || v === 'inline-flex') return 'flex'
  if (v === 'grid' || v === 'inline-grid') return 'grid'
  return 'block'
}

/**
 * A token reference becomes its CSS variable here, at emit time. The
 * reference is the source of truth; the variable is only ever derived.
 *
 * A reference to the wrong family - a spacing slot on a colour - is dropped
 * rather than emitted, because the panel never offers it and a stylesheet
 * that asks for `--tg-space-lg` as a colour is a silently invisible rule.
 */
function resolveToken(value: string | undefined, propertyId: string, family: string | undefined): string | undefined {
  const ref = parseTokenRef(value)
  if (!ref) return value
  if (!family || ref.family !== family) return undefined
  return tokenRefToVar(ref, propertyId)
}

function selectorFor(name: string, state: StyleState): string {
  if (state === 'normal') return `.${name}`
  // The class lands on the block's wrapper, which is never itself
  // focusable - the button inside it is. `:focus` compiled correctly and
  // could never match; `:focus-within` is what "this block has focus" means
  // on a wrapper, and it also matches when the wrapper IS the control.
  return state === 'focus' ? `.${name}:focus-within` : `.${name}:${state}`
}

function rule(selector: string, decls: string[], custom?: string | null): string {
  const body = custom ? [...decls, custom].join(';') : decls.join(';')
  return body === '' ? '' : `${selector}{${body}}`
}

/** The whole stylesheet, or an empty string when there is nothing to say. */
/** A url safe to place inside url('...'). */
function safeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (v === '' || v.length > 500) return null
  // Quotes, braces and parens would let a stored url close the url() and the
  // rule around it - the one way a font token could restyle a whole site.
  if (/["'(){}<>\\\s]/.test(v)) return null
  const lower = v.toLowerCase()
  return FORBIDDEN.some((bad) => lower.includes(bad)) ? null : v
}

/** `@font-face` rules and the token variables for the named fonts. */
function fontCss(fonts: StylesheetFont[]): { imports: string[]; faces: string[]; vars: string[] } {
  const imports: string[] = []
  const faces: string[] = []
  const vars: string[] = []

  const googleFamilies: string[] = []
  for (const font of [...fonts].sort((a, b) => compareClassNames(a.name, b.name))) {
    if (!SAFE_NAME.test(String(font?.name ?? ''))) continue

    if (font.stack) {
      const safe = safeValue(font.stack)
      if (safe) vars.push(`--tg-font-${font.name}:${safe}`)
      continue
    }

    if (font.google) {
      googleFamilies.push(font.google)
      vars.push(`--tg-font-${font.name}:${fontStack(font.google)}`)
      continue
    }

    const files = (font.files ?? []).filter((f) => safeUrl(f?.url))
    if (files.length === 0) continue
    for (const file of files) {
      const url = safeUrl(file.url) as string
      // ONE rule per weight, with matching descriptors: a family declaring
      // 400 and 700 in a single rule leaves the browser synthesising fake
      // bold, which looks subtly wrong and is hard to trace.
      const descriptors = [
        `font-family:"${font.name}"`,
        `src:url('${url}') format('woff2')`,
        `font-weight:${typeof file.weight === 'number' ? file.weight : 400}`,
        `font-style:${safeValue(file.style) ?? 'normal'}`,
        // Without swap the text is invisible while the font loads.
        'font-display:swap',
      ]
      faces.push(`@font-face{${descriptors.join(';')}}`)
    }
    vars.push(`--tg-font-${font.name}:"${font.name}", sans-serif`)
  }

  const href = googleFontsUrl(googleFamilies)
  // @import is legal only at the very top of a stylesheet, so the caller
  // places this first. It is Studio's own import, never a stored value -
  // user CSS still has @import forbidden outright.
  if (href) imports.push(`@import url('${href}');`)

  return { imports, faces, vars }
}

export function renderStylesheet(input: StylesheetInput): string {
  const classes = (input.classes ?? []).filter((c) => SAFE_NAME.test(String(c?.name ?? '')))
  const tags = (input.tagDefaults ?? []).filter((t) => SAFE_NAME.test(String(t?.tag ?? '')))
  const out: string[] = []

  // 0. Fonts. The @import must be the FIRST thing in the file.
  const { imports, faces, vars } = fontCss(input.fonts ?? [])
  out.push(...imports, ...faces)

  // 1. Token values, first: everything below may reference them.
  const tokens = input.tokens ?? {}
  const tokenDecls = Object.keys(tokens).sort()
    .map((name) => (SAFE_NAME.test(name) ? [name, safeValue(tokens[name])] as const : null))
    .filter((e): e is readonly [string, string] => !!e && e[1] !== null)
    .map(([name, value]) => `--tg-${name}:${value}`)
  const rootDecls = [...vars, ...tokenDecls]
  if (rootDecls.length > 0) out.push(`:root{${rootDecls.join(';')}}`)

  // 2 & 3. Tag defaults before classes, so a class always wins on equal
  // footing rather than depending on which was written first.
  const blockFor = (breakpoint: Breakpoint): string[] => {
    const rules: string[] = []
    for (const tag of [...tags].sort((a, b) => compareClassNames(a.tag, b.tag))) {
      for (const state of STATES) {
        const decls = declarations(tag.tag, tag.props ?? {}, state, breakpoint, 'all')
        const selector = state === 'normal' ? `${TAG_SCOPE} ${tag.tag}` : `${TAG_SCOPE} ${tag.tag}:${state}`
        const r = rule(selector, decls)
        if (r) rules.push(r)
      }
    }
    // Class order IS the cascade - see cascade.ts. Code point order, because
    // locale collation depends on the runtime's ICU data and the served ETag
    // is a hash of this string.
    for (const c of [...classes].sort((a, b) => compareClassNames(a.name, b.name))) {
      for (const state of STATES) {
        const decls = declarations(c.name, c.props ?? {}, state, breakpoint)
        // Raw CSS belongs to the base normal rule only - it has no breakpoint
        // or state of its own to be scoped by.
        const custom = breakpoint === 'base' && state === 'normal' ? safeCustom(c.custom) : null
        // A one-element rule (a Style Part) is emitted like a tag default:
        // everything on the selector, states as the element's own
        // pseudo-class, because the element IS the thing hovered.
        if (c.oneElement) {
          const flat = rule(selectorFor(c.name, state), declarations(c.name, c.props ?? {}, state, breakpoint, 'all'), custom)
          if (flat) rules.push(flat)
          continue
        }
        // The content rule comes FIRST. A block with no inner element wears
        // both classes on one element, and emitting the wrapper rule second
        // lets the designer's exact display value win there - see displayFor.
        // Typography lands on the element that carries the text - the kit's
        // own text classes would otherwise beat anything inherited from the
        // wrapper. Emitted first, then content, then wrapper.
        const text = rule(selectorFor(textClassName(c.name), state), declarations(c.name, c.props ?? {}, state, breakpoint, 'text'))
        if (text) rules.push(text)
        const content = rule(selectorFor(contentClassName(c.name), state), declarations(c.name, c.props ?? {}, state, breakpoint, 'content'))
        if (content) rules.push(content)
        const r = rule(selectorFor(c.name, state), decls, custom)
        if (r) rules.push(r)
      }
    }
    return rules
  }

  out.push(...blockFor('base'))

  for (const breakpoint of BREAKPOINTS) {
    if (breakpoint === 'base') continue
    const rules = blockFor(breakpoint)
    if (rules.length > 0) out.push(`@media ${MEDIA[breakpoint]}{${rules.join('')}}`)
  }

  // 4. Anyone who asked for less motion gets none of ours. One rule naming
  // every selector that transitions, rather than an audit of each.
  const moving = classes
    .filter((c) => readValue(c.props?.transition, {}) !== undefined)
    .map((c) => `.${c.name}`)
    .sort()
  if (moving.length > 0) {
    out.push(`@media (prefers-reduced-motion: reduce){${moving.join(',')}{transition:none}}`)
  }

  return out.filter(Boolean).join('')
}
