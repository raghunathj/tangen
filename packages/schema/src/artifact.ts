/**
 * File Name: artifact.ts
 * Purpose: What a generated content artifact says about itself (closure plan
 *          Phase 6B, Unit 3). `tangen push` writes `content-tables.ts` from
 *          the schema in the project's code; nothing in the file recorded
 *          WHICH workspace and environment that schema had been pushed to,
 *          so a file generated while pushing to development and a server
 *          serving production looked identical, and a column that exists in
 *          one environment and not the other was discovered as a query
 *          error. The artifact now carries its provenance and a fingerprint
 *          of the schema it describes, and `artifactStatus` answers whether
 *          it belongs here and is current.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The fingerprint is the same cheap, stable hash the
 *          drift check already uses (`schema-drift.ts`), moved here so the
 *          generator and the checker cannot drift apart - one hashing
 *          system, not two. The artifact's PATH does not change: the tables
 *          it describes are physical, one set per database, and the 44
 *          modules that import `@tangen/db/content-tables` keep working
 *          unchanged. What was missing was not a second copy of the file
 *          per environment, but the answer to "which environment is this
 *          file's schema, and is that still the schema here?".
 */
import type { SchemaDefinition } from '@tangen/types'

/** The generated-artifact format. Bumped when the emitted shape changes. */
export const ARTIFACT_FORMAT = 1

/** What a generated artifact records about where it came from. */
export interface ArtifactMeta {
  /** The emitted shape's version; a reader refuses a format it does not know. */
  format: number
  /** The workspace whose schema this describes. */
  workspaceId: string
  /** A stable hash of the types and fields the artifact describes. */
  fingerprint: string
  /** The tables in the artifact, for a quick eyeball and a cheap diff. */
  types: string[]
}

/**
 * A cheap, stable hash of the content schema: the type names, their
 * localization flag, and each field's name, type and config. Two schemas
 * that would generate the same tables hash the same; any change a push
 * would apply changes it.
 */
export function contentSchemaFingerprint(schema: SchemaDefinition): string {
  const text = JSON.stringify(schema.types.map((t) => [
    t.name,
    (t as { localized?: boolean }).localized === true,
    (t.fields ?? []).map((f) => [f.name, f.fieldType, f.config ?? {}]),
  ]))
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return `${h.toString(16)}:${text.length}`
}

/** Builds the provenance for a generation of `schema` for one workspace. */
export function artifactMeta(schema: SchemaDefinition, where: { workspaceId: string }): ArtifactMeta {
  return {
    format: ARTIFACT_FORMAT,
    workspaceId: where.workspaceId,
    fingerprint: contentSchemaFingerprint(schema),
    types: schema.types.map((t) => t.name).sort(),
  }
}

export type ArtifactState =
  /** Generated here, from this schema. */
  | 'current'
  /** Generated before provenance existed: it may or may not match. */
  | 'unstamped'
  /** A format this build does not understand. */
  | 'unknown-format'
  /** Generated for another workspace. */
  | 'foreign-workspace'
  /** This workspace, but an older schema. */
  | 'stale'

export interface ArtifactStatus {
  state: ArtifactState
  ok: boolean
  /** One sentence an operator can act on. */
  detail: string
}

/**
 * Is this artifact the one this deployment should be running?
 *
 * `meta` is what the file recorded (null when it predates provenance);
 * `here` is the deployment asking, with the fingerprint of ITS schema.
 */
export function artifactStatus(meta: ArtifactMeta | null | undefined, here: { workspaceId: string; fingerprint: string }): ArtifactStatus {
  if (!meta) {
    return { state: 'unstamped', ok: true, detail: 'the generated content artifact predates provenance: run `tangen push` (or `tangen schema regenerate`) to stamp it with the workspace and schema it describes' }
  }
  if (meta.format !== ARTIFACT_FORMAT) {
    return { state: 'unknown-format', ok: false, detail: `the generated content artifact is format ${meta.format} and this build reads format ${ARTIFACT_FORMAT}: regenerate it with this version of Tangen` }
  }
  if (meta.workspaceId !== here.workspaceId) {
    return { state: 'foreign-workspace', ok: false, detail: `the generated content artifact was generated for workspace ${meta.workspaceId} and this is ${here.workspaceId}: it describes another project's tables` }
  }
  if (meta.fingerprint !== here.fingerprint) {
    return { state: 'stale', ok: false, detail: `the generated content artifact describes an older schema (${meta.fingerprint} vs ${here.fingerprint}): run \`tangen push\`, or \`tangen schema regenerate\` to rewrite it from the registry` }
  }
  return { state: 'current', ok: true, detail: `the generated content artifact matches the registry (${here.fingerprint})` }
}
