/**
 * File Name: protection-declaration.ts
 * Purpose: Reading a Block's `protection` declaration off a component
 *          definition - validated, and loud when it is wrong.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `styleAccess` (style-access.ts) is the model, and it
 *          assumes a well-formed declaration. The declaration itself is data
 *          out of workspace config, and data goes wrong quietly: `level:
 *          'locked '` with a trailing space would read as Open and leave a
 *          checkout unprotected, and `properties: ['colour']` would expose a
 *          part that accepts nothing, so every edit is refused with a reason
 *          that is true and useless. Both are worse than an error.
 *
 *          So reading THROWS. The error names the component and the exact
 *          key (`protection.parts.root.properties[0]`), because "invalid
 *          protection" on a config with forty components is not a fix. The
 *          validator is also exported as a list of issues, for a push or a
 *          boot that wants to report everything at once rather than the
 *          first thing it hit.
 *
 *          Two rules are deliberate rather than merely structural. Parts on
 *          an Open Block are refused, because Open exposes everything and the
 *          list would be ignored without a trace. A DANGEROUS property in a
 *          part's list is refused, because the model never grants it on a
 *          protected Block and the author would be promising something the
 *          compiler will not deliver.
 *
 *          Dependency-free like the rest of this package: the property ids
 *          are checked against STYLE_PROPERTIES, which lives here.
 */
import { DANGEROUS_PROPERTIES, type BlockProtection, type StylePart } from './style-access'
import { propertyById } from './style-properties'

/** One thing wrong with a declaration, and where. */
export interface ProtectionIssue {
  component: string
  /** A path into the declaration, `protection.parts.root.properties[0]`. */
  key: string
  message: string
}

/** Thrown by `readProtectionDeclaration`; carries the first issue's location. */
export class ProtectionDeclarationError extends Error {
  readonly component: string
  readonly key: string
  readonly issues: ProtectionIssue[]

  constructor(issues: ProtectionIssue[]) {
    const first = issues[0]
    const rest = issues.length > 1 ? ` (and ${issues.length - 1} more)` : ''
    super(`Component "${first.component}": ${first.key} ${first.message}${rest}`)
    this.name = 'ProtectionDeclarationError'
    this.component = first.component
    this.key = first.key
    this.issues = issues
  }
}

const LEVELS = ['open', 'guided', 'locked'] as const
const PROTECTION_KEYS = new Set(['level', 'parts'])
const PART_KEYS = new Set(['properties'])

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Every issue with a declaration. Empty when it is well-formed, and empty for
 * `undefined`, which is simply "no declaration" and means Open.
 */
export function validateProtectionDeclaration(component: string, raw: unknown): ProtectionIssue[] {
  if (raw === undefined) return []
  const issues: ProtectionIssue[] = []
  const issue = (key: string, message: string) => { issues.push({ component, key, message }) }

  if (!isRecord(raw)) {
    issue('protection', 'must be an object with a level and optional parts')
    return issues
  }

  for (const key of Object.keys(raw)) {
    if (!PROTECTION_KEYS.has(key)) issue(`protection.${key}`, 'is not a protection key (expected level or parts)')
  }

  const level = raw.level
  if (typeof level !== 'string' || !(LEVELS as readonly string[]).includes(level)) {
    issue('protection.level', `must be one of open, guided or locked${typeof level === 'string' ? `, not "${level}"` : ''}`)
  }

  if (raw.parts === undefined) return issues

  if (level === 'open') {
    issue('protection.parts', 'has no effect on an open Block, which exposes everything - remove it or raise the level')
  }
  if (!isRecord(raw.parts)) {
    issue('protection.parts', 'must be an object of named Style Parts')
    return issues
  }

  for (const [name, part] of Object.entries(raw.parts)) {
    if (name.trim() === '' || /\s/.test(name)) {
      issue('protection.parts', `has a part name that is blank or contains whitespace ("${name}")`)
      continue
    }
    const at = `protection.parts.${name}`
    if (!isRecord(part)) {
      issue(at, 'must be an object (use {} to expose every property)')
      continue
    }
    for (const key of Object.keys(part)) {
      if (!PART_KEYS.has(key)) issue(`${at}.${key}`, 'is not a Style Part key (expected properties)')
    }
    if (part.properties === undefined) continue
    if (!Array.isArray(part.properties)) {
      issue(`${at}.properties`, 'must be a list of style property ids')
      continue
    }
    part.properties.forEach((id, i) => {
      const where = `${at}.properties[${i}]`
      if (typeof id !== 'string') { issue(where, 'must be a style property id'); return }
      if (!propertyById(id)) { issue(where, `"${id}" is not a style property the Style panel has`); return }
      if (DANGEROUS_PROPERTIES.includes(id)) {
        issue(where, `"${id}" can break a Block and is never editable on a protected one, so it cannot be exposed`)
      }
    })
  }

  return issues
}

/**
 * The declaration a component definition carries, or undefined for none.
 *
 * Throws `ProtectionDeclarationError` on anything malformed. Never returns a
 * guess: a declaration that reads as Open because of a typo is a Block that
 * is unprotected without anyone deciding so.
 */
export function readProtectionDeclaration(component: string, raw: unknown): BlockProtection | undefined {
  if (raw === undefined) return undefined
  const issues = validateProtectionDeclaration(component, raw)
  if (issues.length > 0) throw new ProtectionDeclarationError(issues)

  const decl = raw as { level: BlockProtection['level']; parts?: Record<string, { properties?: string[] }> }
  if (decl.parts === undefined) return { level: decl.level }
  const parts: Record<string, StylePart> = {}
  for (const [name, part] of Object.entries(decl.parts)) {
    parts[name] = part.properties === undefined ? {} : { properties: [...part.properties] }
  }
  return { level: decl.level, parts }
}
