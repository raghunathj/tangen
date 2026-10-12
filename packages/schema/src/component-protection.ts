/**
 * File Name: component-protection.ts
 * Purpose: The STRUCTURAL check on a component's `protection` declaration -
 *          enough for `tangen push` to refuse a malformed one by component
 *          and key, without this package knowing what a style property is.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Two validators exist on purpose, and this is the
 *          smaller one. The model lives in @tangen/studio-schema
 *          (`validateProtectionDeclaration`), which also knows the style
 *          property registry and the dangerous set, so it can say that
 *          `colour` is not a property and that `display` can never be
 *          exposed. @tangen/schema is the shared layer every site and the
 *          CLI read, and it must not depend on an optional Studio package -
 *          the same reason `ComponentProtection` is re-declared structurally
 *          in @tangen/types rather than imported. So this validator checks
 *          the SHAPE only: the level, the keys, that parts are objects of
 *          objects, that properties are a list of strings, that an Open
 *          Block lists no parts. The issue paths and the wording follow the
 *          richer validator's, so a site that passes its defs through
 *          `withBuilderKit` (which runs the richer one at boot) and one that
 *          does not get the same message for the same mistake, and the
 *          parity is held by a test on the Studio side.
 *
 *          What this cannot catch - a property id the Style panel does not
 *          have, a dangerous property in a part's list - is caught the
 *          first time Studio reads the def (`protectionsFor` at draft and
 *          publish), loudly, with the component and the key. Push catching
 *          the structure first is what stops `level: 'locked '` (trailing
 *          space) from reading as Open in production.
 */

const LEVELS = ['open', 'guided', 'locked'] as const
const PROTECTION_KEYS = new Set(['level', 'parts'])
const PART_KEYS = new Set(['properties'])

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Every structural issue with a declaration, as `<key> <message>` strings
 * (`protection.level must be one of open, guided or locked, not "lockd"`).
 * Empty when it is well-formed, and empty for `undefined`, which is simply
 * "no declaration" and means Open.
 */
export function validateComponentProtection(raw: unknown): string[] {
  if (raw === undefined) return []
  const issues: string[] = []
  const issue = (key: string, message: string) => { issues.push(`${key} ${message}`) }

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
      if (typeof id !== 'string') issue(`${at}.properties[${i}]`, 'must be a style property id')
    })
  }

  return issues
}
