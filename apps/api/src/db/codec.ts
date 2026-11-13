import { GLOBAL, type CollectionName } from '@argolet/app';
import type { SqlClient } from './drivers';
import { columnsOf, TABLES, type Column, type ColumnKind, type TableScope } from './tables';

/**
 * Translation between application rows (plain objects) and the typed columns of the
 * relational schema. Reads format every value exactly as the application writes it
 * (ISO-8601 UTC timestamps with milliseconds, YYYY-MM-DD dates, decimal strings), so a row
 * reads back equal to what was written.
 */

const quote = (id: string) => `"${id}"`;

const CAST: Record<ColumnKind, (p: string) => string> = {
  text: (p) => `${p}::text`,
  int: (p) => `${p}::integer`,
  bigint: (p) => `${p}::bigint`,
  real: (p) => `${p}::double precision`,
  numeric: (p) => `${p}::numeric`,
  bool: (p) => `${p}::boolean`,
  timestamp: (p) => `argolet.iso_timestamp(${p}::text)`,
  date: (p) => `argolet.iso_date(${p}::text)`,
  json: (p) => `${p}::jsonb`,
  textArray: (p) => `argolet.jsonb_text_array(${p}::jsonb)`,
};

const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const READ: Record<ColumnKind, (c: string) => string> = {
  text: (c) => c,
  int: (c) => c,
  bigint: (c) => `${c}::text`,
  real: (c) => c,
  numeric: (c) => `${c}::text`,
  bool: (c) => c,
  timestamp: (c) => `to_char(${c} AT TIME ZONE 'UTC', ${ISO_UTC})`,
  date: (c) => `to_char(${c}, 'YYYY-MM-DD')`,
  json: (c) => c,
  textArray: (c) => `to_jsonb(${c})`,
};

interface MappedColumn {
  field: string;
  column: string;
  def: Column;
}

export interface TablePlan {
  collection: CollectionName;
  table: string;
  scope: TableScope;
  columns: MappedColumn[];
  byField: Map<string, MappedColumn>;
  /** Primary key columns. */
  key: string[];
  select: string;
}

const BASE_FIELDS = new Set(['id', 'tenantId', 'rev', 'createdAt', 'updatedAt']);
const hasTenantColumn = (scope: TableScope) => scope === 'tenant' || scope === 'mixed';

const plans = new Map<CollectionName, TablePlan>();

export function planFor(collection: CollectionName): TablePlan {
  let plan = plans.get(collection);
  if (plan) return plan;
  const def = TABLES[collection];
  const columns = columnsOf(collection);
  const select = [
    ...(hasTenantColumn(def.scope) ? ['tenant_id AS "tenantId"'] : []),
    'id',
    ...columns.map((c) => `${READ[c.def.kind](quote(c.column))} AS ${quote(c.field)}`),
    'rev',
    `${READ.timestamp('created_at')} AS "createdAt"`,
    `${READ.timestamp('updated_at')} AS "updatedAt"`,
  ].join(', ');
  plan = {
    collection,
    table: `argolet.${def.table}`,
    scope: def.scope,
    columns,
    byField: new Map(columns.map((c) => [c.field, c])),
    key: hasTenantColumn(def.scope) ? ['tenant_id', 'id'] : ['id'],
    select,
  };
  plans.set(collection, plan);
  return plan;
}

/** SQL row (aliased by field name) → application row. */
export function decodeRow(plan: TablePlan, r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: r.id,
    tenantId: hasTenantColumn(plan.scope) ? r.tenantId : plan.scope === 'self' ? r.id : GLOBAL,
  };
  for (const c of plan.columns) {
    const v = r[c.field];
    if (v === null || v === undefined) {
      if (c.def.optional) continue;
      out[c.field] = c.def.blankAsNull ? '' : null;
    } else if (c.def.kind === 'int' || c.def.kind === 'bigint' || c.def.kind === 'real') {
      out[c.field] = Number(v);
    } else {
      out[c.field] = v;
    }
  }
  out.rev = Number(r.rev);
  out.createdAt = r.createdAt;
  out.updatedAt = r.updatedAt;
  return out;
}

/** Application value → SQL parameter for a column. */
export function encodeValue(c: MappedColumn, v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (c.def.blankAsNull && v === '') return null;
  if (c.def.kind === 'json' || c.def.kind === 'textArray') return JSON.stringify(v);
  return v;
}

export const castParam = (c: MappedColumn, placeholder: string) => CAST[c.def.kind](placeholder);

/** Rejects fields that have no column: nothing is ever dropped silently. */
export function assertKnownFields(plan: TablePlan, row: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || BASE_FIELDS.has(k) || plan.byField.has(k)) continue;
    throw new Error(`Trường "${k}" của ${plan.collection} chưa có cột trong lược đồ CSDL (${plan.table})`);
  }
}

/** Scope rules of the key: platform tables only hold '_global', the tenants table is keyed by itself. */
export function keyMatchesScope(plan: TablePlan, tenantId: string, id: string): boolean {
  if (plan.scope === 'global') return tenantId === GLOBAL;
  if (plan.scope === 'self') return tenantId === id;
  return true;
}

export function keyWhere(plan: TablePlan, tenantId: string, id: string): { sql: string; params: unknown[] } {
  return hasTenantColumn(plan.scope)
    ? { sql: 'tenant_id = $1 AND id = $2', params: [tenantId, id] }
    : { sql: 'id = $1', params: [id] };
}

/** Equality filter (Partial<Row>) → WHERE conditions; `null` matches SQL NULL. */
export function filterWhere(
  plan: TablePlan,
  filter: Record<string, unknown> | undefined,
  params: unknown[],
): string[] {
  const conds: string[] = [];
  const add = (expr: (p: string) => string, value: unknown) => {
    params.push(value);
    conds.push(expr(`$${params.length}`));
  };
  for (const [k, v] of Object.entries(filter ?? {})) {
    if (v === undefined) continue;
    if (k === 'id') add((p) => `id = ${p}::text`, v);
    else if (k === 'tenantId') {
      if (hasTenantColumn(plan.scope)) add((p) => `tenant_id = ${p}::text`, v);
      else if (plan.scope === 'self') add((p) => `id = ${p}::text`, v);
      else if (v !== GLOBAL) conds.push('FALSE');
    } else if (k === 'rev') add((p) => `rev = ${p}::integer`, v);
    else if (k === 'createdAt' || k === 'updatedAt')
      add((p) => `${k === 'createdAt' ? 'created_at' : 'updated_at'} = ${CAST.timestamp(p)}`, v);
    else {
      const c = plan.byField.get(k);
      if (!c) throw new Error(`Không thể lọc ${plan.collection} theo "${k}": trường không có trong lược đồ`);
      const value = encodeValue(c, v);
      if (value === null) conds.push(`${quote(c.column)} IS NULL`);
      else add((p) => `${quote(c.column)} = ${castParam(c, p)}`, value);
    }
  }
  return conds;
}

const upserts = new Map<CollectionName, string>();

function upsertSql(plan: TablePlan): string {
  let sql = upserts.get(plan.collection);
  if (sql) return sql;
  const names = [...plan.key, ...plan.columns.map((c) => quote(c.column)), 'rev', 'created_at', 'updated_at'];
  let n = 0;
  const next = () => `$${++n}`;
  const values = [
    ...plan.key.map(() => `${next()}::text`),
    ...plan.columns.map((c) => castParam(c, next())),
    `${next()}::integer`,
    CAST.timestamp(next()),
    CAST.timestamp(next()),
  ];
  const updates = names
    .filter((x) => !plan.key.includes(x) && x !== 'created_at')
    .map((x) => `${x} = EXCLUDED.${x}`);
  sql =
    `INSERT INTO ${plan.table} (${names.join(', ')}) VALUES (${values.join(', ')}) ` +
    `ON CONFLICT (${plan.key.join(', ')}) DO UPDATE SET ${updates.join(', ')} RETURNING ${plan.select}`;
  upserts.set(plan.collection, sql);
  return sql;
}

/**
 * Inserts or replaces one row with the given revision metadata and returns it exactly as the
 * database stored it. created_at never changes once a row exists.
 */
export async function upsertRow(
  client: SqlClient,
  plan: TablePlan,
  row: Record<string, unknown>,
  meta: { rev: number; createdAt: string; updatedAt: string },
): Promise<Record<string, unknown>> {
  assertKnownFields(plan, row);
  const id = row.id as string;
  const tenantId = row.tenantId as string;
  if (!id || !tenantId) throw new Error(`Thiếu id/tenantId khi ghi ${plan.collection}`);
  if (!keyMatchesScope(plan, tenantId, id))
    throw new Error(`${plan.collection}: tenantId "${tenantId}" không hợp lệ cho bảng ${plan.table}`);
  const params = [
    ...(plan.key.length === 2 ? [tenantId, id] : [id]),
    ...plan.columns.map((c) => encodeValue(c, row[c.field])),
    meta.rev,
    meta.createdAt,
    meta.updatedAt,
  ];
  const r = await client.query<Record<string, unknown>>(upsertSql(plan), params);
  return decodeRow(plan, r.rows[0]!);
}
