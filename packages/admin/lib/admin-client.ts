/**
 * File Name: admin-client.ts
 * Purpose: Provides a builder-pattern AdminClient for querying and mutating Tangen content objects and database tables from within the admin panel.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Uses a fluent immutable builder pattern (fork on each method call). Depends on adminFetch from ./api for authenticated HTTP calls.
 */
import { useMemo } from "react";
import type {
  QueryFilter,
  QueryResult,
  SerializeHint,
  QueryObject,
  PublishPlan,
} from "@tangen/types";
import { adminFetch } from "./api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AdminFetchFn = (
  path: string,
  init?: RequestInit,
  extraParams?: Record<string, string>,
) => Promise<unknown>;

export interface BulkUpdateResult {
  updated: number;
  failed: number;
  errors: { id: string; message: string }[];
}

export interface AdminObjectBuilder<T = Record<string, unknown>> {
  where(filters: QueryFilter): AdminObjectBuilder<T>;
  sort(field: string, direction?: "asc" | "desc"): AdminObjectBuilder<T>;
  limit(n: number): AdminObjectBuilder<T>;
  offset(n: number): AdminObjectBuilder<T>;
  depth(n: number): AdminObjectBuilder<T>;
  props(fields: string[]): AdminObjectBuilder<T>;
  serialize(hints: Record<string, SerializeHint>): AdminObjectBuilder<T>;
  find(): Promise<QueryResult<T>>;
  findOne(id: string): Promise<{ data: T }>;
  findBySlug(slug: string): Promise<{ data: T }>;
  create(payload: {
    title: string;
    values?: Record<string, unknown>;
  }): Promise<{ data: T }>;
  update(id: string, fields: Record<string, unknown>): Promise<{ data: T }>;
  delete(id: string): Promise<{ data: { id: string } }>;
  publish(id: string, opts?: { cascade?: boolean }): Promise<{ data: T }>;
  publishPreflight(id: string): Promise<{ data: PublishPlan }>;
  unpublish(id: string): Promise<{ data: T }>;
  bulkUpdate(
    ids: string[],
    fields: Record<string, unknown>,
  ): Promise<BulkUpdateResult>;
}

export interface AdminTableBuilder {
  where(filters: QueryFilter): AdminTableBuilder;
  sort(field: string, direction?: "asc" | "desc"): AdminTableBuilder;
  limit(n: number): AdminTableBuilder;
  offset(n: number): AdminTableBuilder;
  props(fields: string[]): AdminTableBuilder;
  find(): Promise<QueryResult>;
}

export interface AdminClient {
  objects<T = Record<string, unknown>>(typeName: string): AdminObjectBuilder<T>;
  table(name: string): AdminTableBuilder;
}

// ─── Builder state ────────────────────────────────────────────────────────────

interface AdminBuilderState {
  typeName: string;
  filtersVal: QueryFilter | null;
  sortFieldVal: string | null;
  sortDirVal: "asc" | "desc";
  limitVal: number;
  offsetVal: number;
  depthVal: number;
  propsVal: string[] | null;
  serializeVal: Record<string, SerializeHint> | null;
}

// ─── Builder implementation ───────────────────────────────────────────────────

class AdminObjectBuilderImpl<
  T = Record<string, unknown>,
> implements AdminObjectBuilder<T> {
  constructor(
    private readonly fetchFn: AdminFetchFn,
    private readonly state: AdminBuilderState,
  ) {}

  private fork(patch: Partial<AdminBuilderState>): AdminObjectBuilderImpl<T> {
    return new AdminObjectBuilderImpl<T>(this.fetchFn, {
      ...this.state,
      ...patch,
    });
  }

  where(filters: QueryFilter): AdminObjectBuilder<T> {
    return this.fork({ filtersVal: filters });
  }
  sort(
    field: string,
    direction: "asc" | "desc" = "asc",
  ): AdminObjectBuilder<T> {
    return this.fork({ sortFieldVal: field, sortDirVal: direction });
  }
  limit(n: number): AdminObjectBuilder<T> {
    return this.fork({ limitVal: n });
  }
  offset(n: number): AdminObjectBuilder<T> {
    return this.fork({ offsetVal: n });
  }
  depth(n: number): AdminObjectBuilder<T> {
    return this.fork({ depthVal: n });
  }
  props(fields: string[]): AdminObjectBuilder<T> {
    return this.fork({ propsVal: fields });
  }
  serialize(hints: Record<string, SerializeHint>): AdminObjectBuilder<T> {
    return this.fork({ serializeVal: hints });
  }

  async find(): Promise<QueryResult<T>> {
    const {
      typeName,
      filtersVal,
      sortFieldVal,
      sortDirVal,
      limitVal,
      offsetVal,
      depthVal,
      propsVal,
      serializeVal,
    } = this.state;
    const body: Omit<QueryObject, 'type'> = {
      limit: limitVal,
      offset: offsetVal,
      depth: depthVal,
      ...(filtersVal ? { query: filtersVal } : {}),
      ...(sortFieldVal
        ? { sort: { field: sortFieldVal, direction: sortDirVal } }
        : {}),
      ...(propsVal ? { props: propsVal } : {}),
      ...(serializeVal ? { serialize: serializeVal } : {}),
    };
    return this.fetchFn(`/objects/${typeName}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    }) as Promise<QueryResult<T>>;
  }

  async findOne(id: string): Promise<{ data: T }> {
    return this.fetchFn(
      `/objects/${this.state.typeName}/${id}`,
      { method: "GET" },
    ) as Promise<{ data: T }>;
  }

  async findBySlug(slug: string): Promise<{ data: T }> {
    return this.fetchFn(
      `/objects/${this.state.typeName}/by-slug/${slug}`,
      { method: "GET" },
    ) as Promise<{ data: T }>;
  }

  async create(payload: {
    title: string;
    values?: Record<string, unknown>;
  }): Promise<{ data: T }> {
    const { title, values = {} } = payload;
    return this.fetchFn(`/objects/${this.state.typeName}`, {
      method: "POST",
      body: JSON.stringify({ title, ...values }),
    }) as Promise<{ data: T }>;
  }

  async update(
    id: string,
    fields: Record<string, unknown>,
  ): Promise<{ data: T }> {
    return this.fetchFn(
      `/objects/${this.state.typeName}/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify(fields),
      },
    ) as Promise<{ data: T }>;
  }

  async delete(id: string): Promise<{ data: { id: string } }> {
    return this.fetchFn(
      `/objects/${this.state.typeName}/${id}`,
      { method: "DELETE" },
    ) as Promise<{ data: { id: string } }>;
  }

  async publish(id: string, opts?: { cascade?: boolean }): Promise<{ data: T }> {
    return this.fetchFn(
      `/objects/${this.state.typeName}/${id}/publish`,
      { method: "POST" },
      opts?.cascade ? { cascade: "true" } : undefined,
    ) as Promise<{ data: T }>;
  }

  /** Preview the publish cascade (dependencies + blockers) without writing. */
  async publishPreflight(id: string): Promise<{ data: PublishPlan }> {
    return this.fetchFn(
      `/objects/${id}/publish/preflight`,
      { method: "POST" },
      { type: this.state.typeName },
    ) as Promise<{ data: PublishPlan }>;
  }

  async unpublish(id: string): Promise<{ data: T }> {
    return this.fetchFn(
      `/objects/${this.state.typeName}/${id}/unpublish`,
      { method: "POST" },
    ) as Promise<{ data: T }>;
  }

  async bulkUpdate(
    ids: string[],
    fields: Record<string, unknown>,
  ): Promise<BulkUpdateResult> {
    return this.fetchFn("/objects/bulk-update", {
      method: "POST",
      body: JSON.stringify({ type: this.state.typeName, ids, fields }),
    }) as Promise<BulkUpdateResult>;
  }
}

// ─── Table builder ────────────────────────────────────────────────────────────

interface AdminTableBuilderState {
  tableName: string;
  filtersVal: QueryFilter | null;
  sortFieldVal: string | null;
  sortDirVal: "asc" | "desc";
  limitVal: number;
  offsetVal: number;
  propsVal: string[] | null;
}

class AdminTableBuilderImpl implements AdminTableBuilder {
  constructor(
    private readonly fetchFn: AdminFetchFn,
    private readonly state: AdminTableBuilderState,
  ) {}

  private fork(patch: Partial<AdminTableBuilderState>): AdminTableBuilderImpl {
    return new AdminTableBuilderImpl(this.fetchFn, {
      ...this.state,
      ...patch,
    });
  }

  where(filters: QueryFilter): AdminTableBuilder {
    return this.fork({ filtersVal: filters });
  }
  sort(field: string, direction: "asc" | "desc" = "asc"): AdminTableBuilder {
    return this.fork({ sortFieldVal: field, sortDirVal: direction });
  }
  limit(n: number): AdminTableBuilder {
    return this.fork({ limitVal: n });
  }
  offset(n: number): AdminTableBuilder {
    return this.fork({ offsetVal: n });
  }
  props(fields: string[]): AdminTableBuilder {
    return this.fork({ propsVal: fields });
  }

  async find(): Promise<QueryResult> {
    const {
      tableName,
      filtersVal,
      sortFieldVal,
      sortDirVal,
      limitVal,
      offsetVal,
      propsVal,
    } = this.state;
    const body: Record<string, unknown> = {
      limit: limitVal,
      offset: offsetVal,
      ...(filtersVal ? { query: filtersVal } : {}),
      ...(sortFieldVal
        ? { sort: { field: sortFieldVal, direction: sortDirVal } }
        : {}),
      ...(propsVal ? { props: propsVal } : {}),
    };
    return this.fetchFn(`/tables/${tableName}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    }) as Promise<QueryResult>;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * React hook that returns a memoized AdminClient bound to the given environment.
 * @returns a stable AdminClient instance
 */
export function useAdminClient(): AdminClient {
  return useMemo(() => createAdminClient(), []);
}

/**
 * Creates an AdminClient with a fluent builder API for querying and mutating objects and tables.
 * @param fetchFn - optional custom fetch function (defaults to adminFetch)
 * @returns an AdminClient instance
 */
export function createAdminClient(
  fetchFn: AdminFetchFn = adminFetch as AdminFetchFn,
): AdminClient {
  return {
    objects<T = Record<string, unknown>>(
      typeName: string,
    ): AdminObjectBuilder<T> {
      return new AdminObjectBuilderImpl<T>(fetchFn, {
        typeName,
        filtersVal: null,
        sortFieldVal: null,
        sortDirVal: "desc",
        limitVal: 20,
        offsetVal: 0,
        depthVal: 0,
        propsVal: null,
        serializeVal: null,
      });
    },

    table(name: string): AdminTableBuilder {
      return new AdminTableBuilderImpl(fetchFn, {
        tableName: name,
        filtersVal: null,
        sortFieldVal: null,
        sortDirVal: "desc",
        limitVal: 20,
        offsetVal: 0,
        propsVal: null,
      });
    },
  };
}
