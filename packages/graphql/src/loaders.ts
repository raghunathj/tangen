/**
 * File Name: loaders.ts
 * Purpose: A tiny per-request batch loader — the N+1 killer for relation
 *          fields. Resolvers enqueue (targetType, id) lookups; the loader
 *          coalesces every id requested for a type within a tick into ONE
 *          `where({ id: { in: [...] } })` query, then fans the rows back
 *          out by id. Hand-rolled (≈40 lines) to keep the package
 *          dependency-light — no `dataloader`.
 *
 * Author: Raghunath J
 * License: MIT
 */
type Row = Record<string, unknown>

interface QueryClient {
  objects: (type: string) => {
    where: (filter: unknown) => any
  }
}

interface PendingBatch {
  ids: Set<string>
  resolvers: Array<{ id: string; resolve: (row: Row | null) => void }>
  scheduled: boolean
}

export interface BatchLoaders {
  /** Load one target object by id (batched with sibling loads of the same type). */
  load: (targetType: string, id: string) => Promise<Row | null>
  /** Load many by ids, preserving order (missing ids drop out). */
  loadMany: (targetType: string, ids: string[]) => Promise<Row[]>
}

/**
 * Creates the per-request loaders. `canRead` gates each target type — an
 * ungranted type yields null rows rather than leaking data.
 */
export function createBatchLoaders(client: QueryClient, canRead: (type: string) => boolean): BatchLoaders {
  const batches = new Map<string, PendingBatch>()

  function flush(type: string) {
    const batch = batches.get(type)!
    batches.delete(type)
    const ids = [...batch.ids]
    if (ids.length === 0 || !canRead(type)) {
      for (const r of batch.resolvers) r.resolve(null)
      return
    }
    // Nested relations resolve PUBLISHED targets only — GraphQL is a public
    // surface; a published parent must never leak a draft neighbor.
    client.objects(type).where({ id: { in: ids } }).status('published').get()
      .then((res: { data: Row[] }) => {
        const byId = new Map(res.data.map((r) => [String(r.id), r]))
        for (const r of batch.resolvers) r.resolve(byId.get(r.id) ?? null)
      })
      .catch(() => { for (const r of batch.resolvers) r.resolve(null) })
  }

  function load(type: string, id: string): Promise<Row | null> {
    if (!id) return Promise.resolve(null)
    let batch = batches.get(type)
    if (!batch) {
      batch = { ids: new Set(), resolvers: [], scheduled: false }
      batches.set(type, batch)
    }
    batch.ids.add(id)
    if (!batch.scheduled) {
      batch.scheduled = true
      queueMicrotask(() => flush(type))
    }
    return new Promise((resolve) => batch!.resolvers.push({ id, resolve }))
  }

  return {
    load,
    async loadMany(type, ids) {
      const rows = await Promise.all(ids.map((id) => load(type, id)))
      return rows.filter((r): r is Row => r != null)
    },
  }
}
