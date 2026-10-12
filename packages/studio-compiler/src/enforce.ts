/**
 * File Name: enforce.ts
 * Purpose: Compiling styles WITH ownership enforced - where a protected
 *          Block's boundary stops being a design and starts being real.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `styleAccess` in @tangen/studio-schema decides what a
 *          designer may target. This is where that decision becomes binding.
 *          A panel that merely declines to offer a control is a suggestion; a
 *          compiler that will not emit the rule is a boundary. Both matter -
 *          the panel for the explanation, this for the guarantee.
 *
 *          Refusals are REPORTED rather than silently dropped, and they are
 *          per PROPERTY rather than per rule. A designer whose work vanished
 *          with no explanation learns to distrust the tool, and losing four
 *          good declarations because a fifth was out of bounds would be worse
 *          than the problem being solved.
 *
 *          The structural invariant is the part that survives future edits:
 *          no emitted selector may contain a combinator, because a combinator
 *          is exactly how a workspace rule reaches inside a Block.
 */
import { styleAccess, internalPartClass, type BlockProtection } from '@tangen/studio-schema'
import { renderStylesheet, type StylesheetInput, type StyleRule } from './stylesheet'
import { compileSectionStyles, type SectionStyle } from './section-css'
import { compilePageStyles, type PageStyle } from './page-css'

/** Which Block, and which part of it, a rule points at. */
export interface RuleTarget {
  blockType: string
  kind: 'root' | 'part' | 'internal'
  part?: string
}

const TARGET_KINDS = new Set(['root', 'part', 'internal'])

/**
 * The Block part a stored class row is aimed at, if it says.
 *
 * A malformed target reads as untargeted, which is the safe reading: an
 * untargeted class is an ordinary workspace class, and the compiler emits no
 * combinator for it, so it cannot reach an internal whatever the row
 * intended.
 *
 * Lives beside RuleTarget rather than in the Studio extension because THREE
 * sides read it: the extension's class routes, the publish path, and (since
 * WF-S10) the platform's Porter provider, which may not import extension
 * code. `extensions/studio/src/lib/protections.ts` re-exports it.
 */
export function classTarget(row: Record<string, unknown>): RuleTarget | undefined {
  const raw = row?.target
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const { blockType, kind, part } = raw as Record<string, unknown>
  if (typeof blockType !== 'string' || !blockType) return undefined
  if (typeof kind !== 'string' || !TARGET_KINDS.has(kind)) return undefined
  if (kind === 'part') {
    if (typeof part !== 'string' || !part) return undefined
    return { blockType, kind, part }
  }
  return { blockType, kind: kind as RuleTarget['kind'] }
}

/** A style rule that may be aimed at a specific Block part. */
export interface TargetedRule extends StyleRule {
  /** Absent means an ordinary workspace class, applied wherever it is worn. */
  target?: RuleTarget
}

export interface EnforceInput extends Omit<StylesheetInput, 'classes'> {
  classes?: TargetedRule[]
  /** Protection declared per block type. An absent entry means Open. */
  protections?: Record<string, BlockProtection>
  /**
   * Raw CSS per block (X-T1), compiled AFTER the workspace stylesheet into
   * one generated class each - see section-css.ts. Page-specific, so a
   * workspace render passes none and a page render passes its own.
   */
  sections?: SectionStyle[]
  /**
   * The page's own raw CSS (X-T2), scoped to its top-level blocks - see
   * page-css.ts. Between the stylesheet and the sections: a page tweak beats
   * the workspace class it overrides and loses to a section's own CSS.
   */
  page?: PageStyle
}

/** One declaration that did not make it, and why. */
export interface Refusal {
  rule: string
  property: string
  reason: string
}

export interface CompiledStyles {
  css: string
  /** Empty when everything compiled. Publish can surface this. */
  refused: Refusal[]
}

/**
 * Compiles styles, dropping anything a Block's author has not exposed.
 *
 * An untargeted class is left alone: applying `.card` to a protected Block
 * styles its public ROOT, which is allowed by design. What is not allowed is
 * reaching past that root, and a rule cannot do so without a combinator - so
 * the containment is structural rather than a list of banned selectors.
 */
export function compileStyles(input: EnforceInput): CompiledStyles {
  const refused: Refusal[] = []
  const classes: StyleRule[] = []

  for (const rule of input.classes ?? []) {
    if (!rule.target) {
      classes.push(rule)
      continue
    }

    const { blockType, kind, part } = rule.target
    const protection = input.protections?.[blockType]

    const props: Record<string, unknown> = {}
    for (const [propertyId, value] of Object.entries(rule.props ?? {})) {
      const access = styleAccess({
        protection,
        scope: 'workspace',
        target: { kind, part },
        propertyId,
      })
      if (access.allowed) props[propertyId] = value
      else refused.push({ rule: rule.name, property: propertyId, reason: access.reason ?? 'Refused' })
    }

    // A rule left with nothing to say is dropped rather than emitted empty.
    if (Object.keys(props).length === 0) continue

    const isPart = kind === 'part' && !!part
    classes.push({
      ...rule,
      // A part is emitted under its scoped class, so neither the block type,
      // the part name nor the author's class name appears in the CSS and no
      // workspace selector can match it. The class is keyed by the rule's
      // own name too, because the runtime stamps one per class the block
      // WEARS - that is what ties `.card`'s button rule to blocks wearing
      // `.card` and no others. The root keeps the author's own class name,
      // since the root is public by definition.
      name: isPart ? internalPartClass(blockType, part, rule.name) : rule.name,
      // A part is one element wearing one class: everything lands on it.
      ...(isPart ? { oneElement: true } : {}),
      props: props as StyleRule['props'],
    })
  }

  // Then the page's own CSS, then section CSS last: each layer is a more
  // specific intent than the one before, so each wins over it at every
  // breakpoint. Their refusals join the list - a declaration that vanished
  // without a word is the silent failure the ownership model exists to end,
  // raw or not.
  const page = compilePageStyles({ page: input.page, protections: input.protections })
  const sections = compileSectionStyles({ sections: input.sections, protections: input.protections })
  return {
    css: renderStylesheet({ ...input, classes }) + page.css + sections.css,
    refused: [...refused, ...page.refused, ...sections.refused],
  }
}
