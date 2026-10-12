/**
 * File Name: SchemasTab.tsx
 * Purpose: The SEO Manager's Schemas tab (plan-seo-next Phase 2). Maps each
 *          content type to a JSON-LD kind (Article, Product, ...) and its
 *          properties to content fields, over GET/POST /admin/ext/seo/schemas.
 *          The generated node then rides every published page's /meta. Built on
 *          the Lightfield kit (@/kit); the server codec normalizeSchemaMap is
 *          the source of truth.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @/kit only, no raw form elements (kit-lint). No em dashes.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  adminFetch, useCan, toast,
  FormSection, FormRow, FormFooter,
  Select, SelectItem, Button, Callout, Skeleton, Text,
} from '@/kit'
import { SCHEMA_KINDS, schemaPropsFor, type SchemaKind, type SchemaMap, type TypeSchemaConfig } from '../lib/schema-map'

const UNMAPPED = '__none__'
const KIND_NONE = 'none'

interface TypeInfo { name: string; label: string; fields: { name: string; label: string }[] }

export function SchemasPanel() {
  const { hasCapability } = useCan()
  const mayWrite = hasCapability('seo:write' as never)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [types, setTypes] = useState<TypeInfo[]>([])
  const [map, setMap] = useState<SchemaMap>({})

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await adminFetch<{ data: { map: SchemaMap; types: TypeInfo[] } }>('/admin/ext/seo/schemas')
      setTypes(res.data.types ?? [])
      setMap(res.data.map ?? {})
    } catch (e) {
      setError((e as Error).message || 'The schema settings could not be loaded.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function setKind(type: string, kind: string) {
    setMap((prev) => {
      const next = { ...prev }
      if (kind === KIND_NONE) delete next[type]
      else next[type] = { kind: kind as SchemaKind, fieldMap: prev[type]?.fieldMap ?? {} }
      return next
    })
  }

  function setField(type: string, prop: string, field: string) {
    setMap((prev) => {
      const cfg = prev[type]
      if (!cfg) return prev
      const fieldMap = { ...cfg.fieldMap }
      if (field === UNMAPPED) delete fieldMap[prop]
      else fieldMap[prop] = field
      return { ...prev, [type]: { ...cfg, fieldMap } }
    })
  }

  async function save() {
    setSaving(true); setError(null)
    try {
      const res = await adminFetch<{ data: SchemaMap }>('/admin/ext/seo/schemas', { method: 'POST', body: JSON.stringify(map) })
      setMap(res.data)
      toast.success('Schema mapping saved')
    } catch (e) {
      setError((e as Error).message || 'The schema mapping could not be saved.')
    } finally { setSaving(false) }
  }

  if (loading) return <div className="space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>

  const ro = !mayWrite

  return (
    <div className="max-w-2xl space-y-5">
      {error && <Callout variant="danger">{error}</Callout>}
      {ro && <Callout variant="info">You can view the schema mapping but not change it. Managing it needs the seo:write permission.</Callout>}
      <Text variant="help">
        Pick a schema.org type for each content type, then map its properties to your fields. The generated JSON-LD is added to every published page of that type; a page can still add its own structured data.
      </Text>

      {types.length === 0 && <Callout variant="info">No content types yet. Add a content type and it will appear here.</Callout>}

      {types.map((t) => {
        const cfg: TypeSchemaConfig | undefined = map[t.name]
        const kind = cfg?.kind ?? KIND_NONE
        const props = schemaPropsFor(kind)
        return (
          <FormSection key={t.name} title={t.label} description={`Content type: ${t.name}`}>
            <FormRow label="Schema type" htmlFor={`seo-schema-kind-${t.name}`}>
              {/* The trigger is a button: it needs its own name, since the row
                  label cannot give one (see @tangen/ui select.tsx). */}
              <Select id={`seo-schema-kind-${t.name}`} aria-label={`Schema type for ${t.label}`} value={kind} onValueChange={(v) => setKind(t.name, v)} disabled={ro}>
                <SelectItem value={KIND_NONE}>No schema</SelectItem>
                {SCHEMA_KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
              </Select>
            </FormRow>
            {props.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {props.map((prop) => (
                  <FormRow key={prop} label={prop} htmlFor={`seo-schema-${t.name}-${prop}`}>
                    <Select id={`seo-schema-${t.name}-${prop}`} aria-label={`${prop} for ${t.label}`} value={cfg?.fieldMap[prop] ?? UNMAPPED} onValueChange={(v) => setField(t.name, prop, v)} disabled={ro}>
                      <SelectItem value={UNMAPPED}>Not mapped</SelectItem>
                      {t.fields.map((f) => <SelectItem key={f.name} value={f.name}>{f.label}</SelectItem>)}
                    </Select>
                  </FormRow>
                ))}
              </div>
            )}
          </FormSection>
        )
      })}

      {!ro && types.length > 0 && (
        <FormFooter>
          <Button variant="secondary" size="sm" onClick={load} disabled={saving}>Reset</Button>
          <Button size="sm" isLoading={saving} onClick={save}>Save schemas</Button>
        </FormFooter>
      )}
    </div>
  )
}
