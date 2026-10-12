/**
 * File Name: index.ts
 * Purpose: Barrel export for the @tangen/schema package, re-exporting type definition helpers and field builders.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None
 */
export { defineObjectType, flattenGroupFields } from './define-object-type'
export { defineSchema } from './define-schema'
export { findTypeNameCollisions, type TypeNameCollision } from './type-name-collisions'
export { validateColumnNamespace } from './column-namespace'
export { validateComponentProtection } from './component-protection'
export * as field from './fields'
export { defineTable } from './custom-table'
export { defineApiResource } from './api-resource'
export { defineRole } from './role-def'
export { defineTask, defineScheduledJob } from './job-def'
export { generateObjectTypeSource, generateSchemaBarrel, generateComponentSource, generateComponentsBarrel, generateGlobalsFileContent, sanitizeFieldConfig, schemaDirIdentifier } from './codegen'
export type { CodegenField, CodegenObjectType, CodegenComponent, CodegenGlobal } from './codegen'
export { defineComponent, resolveComponentRefs, resolveSchemaComponentRefs } from './components'
export { activeRenameSources, componentRenameConflicts, type RenameableComponent } from './component-rename'
export { relationSubfieldsIn, relationRowFieldsIn, mapNestedRelationIds, mapRowRelationIds, validateContainerEmptiness, validateFieldConfigs, validateCrossReferences, localizedContainerFields, type NestedRelationSubfield, type ComponentBlockValue, type CrossRefIssue } from './component-relations'
export type { ComponentRef } from './components'
export * as col from './custom-table'
export { checkSchemaDrift, expectedSqlKind, fieldIsIndexed, udtToSqlKind, CONTENT_SYSTEM_COLUMNS, I18N_SYSTEM_COLUMNS } from './schema-drift'
export type { GeneratedArtifactMeta, DriftInputs, DriftReport, DriftFinding, DriftCode, DriftSeverity, DriftPair, RegistrySnapshot, GeneratedSnapshot, GeneratedTable, DbSnapshot, DbTable, CustomTableSpec, LocalDelta, SqlKind, DriftColumnKind, DriftType, DriftField } from './schema-drift'
export { ARTIFACT_FORMAT, artifactMeta, artifactStatus, contentSchemaFingerprint, type ArtifactMeta, type ArtifactState, type ArtifactStatus } from './artifact'
