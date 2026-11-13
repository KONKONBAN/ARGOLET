import type { SqlClient } from './drivers';

/**
 * Data dictionary of the live schema (tables, columns, keys, constraints, indexes, triggers,
 * views, domains), rendered as Markdown from the PostgreSQL catalog — generated, never written
 * by hand, and checked by a test so it cannot drift from the migrations.
 */
export async function renderDataDictionary(sql: SqlClient, schemaVersion: number): Promise<string> {
  const q = async <R>(text: string, params: unknown[] = []) => (await sql.query<R>(text, params)).rows;
  const cell = (s: string | null | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  const out: string[] = [
    '# Từ điển dữ liệu ARGOLET',
    '',
    `> Sinh tự động từ lược đồ \`argolet\` (phiên bản ${schemaVersion}) bằng \`pnpm --filter @argolet/api db:docs\`. Không sửa tay.`,
    '',
  ];

  const domains = await q<{ name: string; type: string; check: string | null; comment: string | null }>(
    `SELECT t.typname AS name, format_type(t.typbasetype, t.typtypmod) AS type,
            (SELECT string_agg(pg_get_constraintdef(c.oid), ' ') FROM pg_constraint c WHERE c.contypid = t.oid) AS "check",
            obj_description(t.oid, 'pg_type') AS comment
       FROM pg_type t WHERE t.typnamespace = 'argolet'::regnamespace AND t.typtype = 'd' ORDER BY t.typname`,
  );
  out.push('## Kiểu miền (domain)', '', '| Kiểu | Nền | Ràng buộc | Ý nghĩa |', '| --- | --- | --- | --- |');
  for (const d of domains)
    out.push(`| \`${d.name}\` | ${d.type} | \`${cell(d.check)}\` | ${cell(d.comment)} |`);
  out.push('');

  const tables = await q<{ oid: number; name: string; comment: string | null }>(
    `SELECT c.oid::int AS oid, c.relname AS name, obj_description(c.oid, 'pg_class') AS comment
       FROM pg_class c WHERE c.relnamespace = 'argolet'::regnamespace AND c.relkind = 'r' ORDER BY c.relname`,
  );
  out.push('## Bảng', '', '| Bảng | Mô tả |', '| --- | --- |');
  for (const t of tables) out.push(`| [\`${t.name}\`](#${t.name}) | ${cell(t.comment)} |`);
  out.push('');

  for (const t of tables) {
    out.push(`### ${t.name}`, '', cell(t.comment) || '—', '');
    const cols = await q<{ name: string; type: string; notnull: boolean }>(
      `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS notnull
         FROM pg_attribute a WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
      [t.oid],
    );
    out.push('| Cột | Kiểu | Bắt buộc |', '| --- | --- | --- |');
    for (const c of cols) out.push(`| \`${c.name}\` | ${c.type} | ${c.notnull ? 'có' : ''} |`);
    out.push('');
    const cons = await q<{ name: string; type: string; def: string }>(
      `SELECT conname AS name, contype::text AS type, pg_get_constraintdef(oid) AS def
         FROM pg_constraint WHERE conrelid = $1 ORDER BY CASE contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'f' THEN 2 ELSE 3 END, conname`,
      [t.oid],
    );
    const label: Record<string, string> = { p: 'Khoá chính', u: 'Duy nhất', f: 'Khoá ngoại', c: 'Kiểm tra' };
    if (cons.length) {
      out.push('| Ràng buộc | Loại | Định nghĩa |', '| --- | --- | --- |');
      for (const c of cons) out.push(`| \`${c.name}\` | ${label[c.type] ?? c.type} | \`${cell(c.def)}\` |`);
      out.push('');
    }
    const idx = await q<{ name: string; def: string }>(
      `SELECT i.relname AS name, pg_get_indexdef(i.oid) AS def
         FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
        WHERE x.indrelid = $1 AND NOT x.indisprimary
          AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.oid AND c.contype = 'u')
        ORDER BY i.relname`,
      [t.oid],
    );
    if (idx.length) {
      out.push('Chỉ mục:', '');
      for (const i of idx)
        out.push(`- \`${i.name}\`: \`${cell(i.def.replace(/^CREATE (UNIQUE )?INDEX \S+ ON /, '$1'))}\``);
      out.push('');
    }
    const trg = await q<{ name: string }>(
      `SELECT tgname AS name FROM pg_trigger WHERE tgrelid = $1 AND NOT tgisinternal ORDER BY tgname`,
      [t.oid],
    );
    if (trg.length) out.push(`Trigger: ${trg.map((x) => `\`${x.name}\``).join(', ')} (chỉ ghi thêm).`, '');
  }

  const views = await q<{ name: string; comment: string | null }>(
    `SELECT c.relname AS name, obj_description(c.oid, 'pg_class') AS comment
       FROM pg_class c WHERE c.relnamespace = 'argolet'::regnamespace AND c.relkind = 'v' ORDER BY c.relname`,
  );
  out.push('## View báo cáo', '', '| View | Mô tả |', '| --- | --- |');
  for (const v of views) out.push(`| \`${v.name}\` | ${cell(v.comment)} |`);
  out.push('');
  return out.join('\n');
}
