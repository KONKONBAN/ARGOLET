import {
  chooseParser, D, dec, detectFormat, documentKey, formatDate, formatVnd, newId, nextCode, parseBankStatementCsv, parseEInvoiceXml, parsePosCsv,
  randomHex, saltedFingerprint, sha256Hex, sum, validateFields, assertTransition, EVIDENCE_SCHEMA_VERSION, type DocumentFields,
  type DocumentVersionPayload, type FieldIssue,
} from '@argolet/core';
import { type AppCore, actor, paginate, periodOf, requireFound, requireText, type PageParams } from '../core';
import { AppError, type CallContext, type WorkspaceState } from '../runtime';
import type { Tx } from '../store';
import type { Collections, DocumentRow, DocumentVersionRow, SourceKindCode, StructuredRow } from '../types';
import { scopeLabel } from './org';

export const SOURCE_LABEL: Record<SourceKindCode, string> = {
  PHOTO: 'Ảnh chụp',
  XML_EINVOICE: 'XML',
  BANK: 'Ngân hàng',
  CSV: 'Tệp CSV',
  PDF: 'PDF',
  POS: 'POS',
  EXCEL: 'Excel',
};

export const DOC_STATUS_LABEL: Record<DocumentRow['status'], string> = {
  RECEIVED: 'Đã tiếp nhận',
  EXTRACTED: 'Chờ xác nhận',
  NEEDS_REVIEW: 'Cần kiểm tra',
  VALIDATED: 'Đã xác nhận',
  REJECTED: 'Đã từ chối',
  NEEDS_RECON: 'Cần đối soát',
};

export const PARSER_VERSION = 'parser-2026.10.2';

export interface IntakeFile {
  name: string;
  mime?: string | undefined;
  /** Base64 for binary files; plain text is accepted for XML/CSV. */
  contentBase64?: string | undefined;
  text?: string | undefined;
}

function decodeFile(f: IntakeFile): { bytes: Uint8Array; text: string | null } {
  if (typeof f.text === 'string') return { bytes: new TextEncoder().encode(f.text), text: f.text };
  if (typeof f.contentBase64 === 'string') {
    const clean = f.contentBase64.replace(/^data:[^,]*,/, '');
    let bin: string;
    try {
      bin = atob(clean);
    } catch {
      throw new AppError('VALIDATION', `Tệp ${f.name} không đọc được`);
    }
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, text: null };
  }
  throw new AppError('VALIDATION', `Tệp ${f.name} không có nội dung`);
}

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 50;

export function statusFromIssues(issues: FieldIssue[]): DocumentRow['status'] {
  return issues.length > 0 ? 'NEEDS_REVIEW' : 'EXTRACTED';
}

export class DocumentService {
  constructor(private readonly core: AppCore) {}

  private async allCodes(tx: Tx, tenantId: string, col: 'documents' | 'importBatches'): Promise<string[]> {
    return (await tx.list(col, tenantId)).map((d) => d.code);
  }

  private async knownKeys(tx: Tx, tenantId: string, excludeId?: string): Promise<string[]> {
    return (await tx.list('documents', tenantId))
      .filter((d) => d.id !== excludeId && d.status !== 'REJECTED' && d.kind === 'EXPENSE' && d.fields.documentNo)
      .map((d) => documentKey(d.fields));
  }

  /** 05 · Tiếp nhận lô: batch_id, bản gốc + SHA-256 + metadata, chọn bộ phân tích, kiểm chứng. */
  async intake(call: CallContext, p: { entityId?: string; location?: string; files: IntakeFile[] }) {
    if (!Array.isArray(p.files) || p.files.length === 0) throw new AppError('VALIDATION', 'Chọn ít nhất một tệp để tiếp nhận');
    if (p.files.length > MAX_FILES) throw new AppError('VALIDATION', `Tối đa ${MAX_FILES} tệp mỗi lô`);
    const decoded = p.files.map((f) => {
      const name = requireText(f.name, 'Tên tệp', 200);
      const d = decodeFile(f);
      if (d.bytes.length > MAX_FILE_BYTES) throw new AppError('VALIDATION', `Tệp ${name} vượt quá 15 MB`);
      return { name, mime: f.mime ?? '', ...d, sha: sha256Hex(d.bytes) };
    });
    // OCR / VLM extraction runs outside the DB transaction.
    const extractions = new Map<number, Awaited<ReturnType<AppCore['deps']['extraction']['extract']>>>();
    for (const [i, f] of decoded.entries()) {
      const fmt = detectFormat(f.name, f.mime);
      if (chooseParser(fmt) === 'ocr_vlm') {
        extractions.set(i, await this.core.deps.extraction.extract({ bytes: f.bytes, mime: f.mime || (fmt === 'PDF' ? 'application/pdf' : 'image/jpeg'), filename: f.name }));
      }
    }
    return this.core.command(call, async (tx, em, now) => {
      const ws0 = await this.core.requireWorkspace(tx, call, 'document.create');
      const entityId = p.entityId && p.entityId !== '*' ? p.entityId : ws0.entityId !== '*' ? ws0.entityId : await defaultSite(tx, ws0.tenantId);
      const ws = await this.core.requireWorkspace(tx, call, 'document.create', { entityId });
      requireFound(await tx.get('entities', ws.tenantId, entityId), 'cơ sở');
      const today = now.slice(0, 10).replace(/-/g, '');
      const batchCodes = await this.allCodes(tx, ws.tenantId, 'importBatches');
      const base = `LO-${today}`;
      const code = batchCodes.includes(base) ? nextCode(base, batchCodes, 2, 2) : base;
      const batchId = newId('bat');
      const existingArtifacts = await tx.list('artifacts', ws.tenantId);
      const knownKeys = await this.knownKeys(tx, ws.tenantId);
      let docCodes = await this.allCodes(tx, ws.tenantId, 'documents');
      const created: { documentId: string; code: string; status: DocumentRow['status']; duplicate: boolean; filename: string }[] = [];
      let duplicates = 0;
      const seenInBatch = new Map<string, string>();
      let needsReview = 0;
      let normalized = 0;
      for (const [i, f] of decoded.entries()) {
        const artifactId = newId('art');
        const dup = existingArtifacts.find((a) => a.rawSha256 === f.sha) ?? (seenInBatch.has(f.sha) ? { id: seenInBatch.get(f.sha)! } : undefined);
        seenInBatch.set(f.sha, seenInBatch.get(f.sha) ?? artifactId);
        await tx.put('artifacts', {
          id: artifactId,
          tenantId: ws.tenantId,
          batchId,
          filename: f.name,
          mime: f.mime,
          size: f.bytes.length,
          rawSha256: f.sha,
          objectUri: `object://${ws.tenantId}/${batchId}/${artifactId}`,
          sourceKey: `${code}/${f.name}`,
          receivedAt: now,
          duplicateOf: dup?.id ?? null,
          content: f.text !== null && f.text.length < 512_000 ? f.text : null,
        });
        if (dup) {
          duplicates++;
          created.push({ documentId: '', code: '', status: 'REJECTED', duplicate: true, filename: f.name });
          continue;
        }
        const fmt = detectFormat(f.name, f.mime);
        const text = f.text ?? (fmt === 'XML' || fmt === 'CSV' ? new TextDecoder().decode(f.bytes) : null);
        const docCode = nextCode('CT', docCodes);
        docCodes = [...docCodes, docCode];
        let doc: Omit<DocumentRow, 'createdAt' | 'updatedAt' | 'rev'>;
        const common = {
          id: newId('doc'),
          tenantId: ws.tenantId,
          code: docCode,
          entityId,
          artifactId,
          batchId,
          currentVersion: 0,
          receivedAt: now,
          receivedBy: ws.user.id,
          validatedBy: null,
          validatedAt: null,
        };
        try {
          if (fmt === 'XML') {
            const inv = parseEInvoiceXml(text ?? '');
            const fields = { supplier: inv.sellerName, documentNo: inv.documentNo, documentDate: inv.issueDate, total: inv.total, taxCode: inv.sellerTaxCode || undefined };
            const lines = inv.lines.map((l) => ({ description: l.description, amount: l.amount }));
            const issues = validateFields({ ...fields, lines: D(inv.vat).isZero() ? lines : undefined }, { today: now.slice(0, 10), knownDocumentKeys: knownKeys });
            if (!inv.signed) issues.push({ field: 'documentNo', severity: 'warning', message: 'Hóa đơn XML không có chữ ký số' });
            doc = { ...common, title: inv.sellerName || 'Hóa đơn điện tử', counterparty: inv.sellerName, sourceKind: 'XML_EINVOICE', date: inv.issueDate, amount: inv.total, status: statusFromIssues(issues), fields, lines, rows: [], rowKind: null, extraction: null, issues, kind: 'EXPENSE' };
          } else if (fmt === 'CSV') {
            const header = (text ?? '').split(/\r?\n/, 1)[0] ?? '';
            const isPos = /m[aã]\s*đ[oơ]n|order/i.test(header);
            let rows: StructuredRow[];
            if (isPos) {
              rows = parsePosCsv(text ?? '').map((r) => ({ lineNo: r.lineNo, code: r.orderCode, date: r.date, amount: r.gross, fee: r.fee, refund: r.refund, discount: r.discount, reference: '', payoutBatch: r.payoutBatch, counterparty: r.channel, channel: r.channel || 'Nền tảng', description: '' }));
            } else {
              rows = parseBankStatementCsv(text ?? '').map((r) => ({ lineNo: r.lineNo, code: r.reference || `L${r.lineNo}`, date: r.date, amount: r.amount, fee: '0', refund: '0', discount: '0', reference: r.reference, payoutBatch: extractBatchRef(r.description), counterparty: r.counterparty, channel: 'Ngân hàng', description: r.description }));
            }
            if (rows.length === 0) throw new Error('Tệp không có dòng dữ liệu');
            const dates = rows.map((r) => r.date).sort();
            const total = dec(sum(rows.map((r) => r.amount)));
            const fields = { supplier: isPos ? 'Báo cáo nền tảng' : 'Sao kê ngân hàng', documentNo: f.name.replace(/\.[^.]+$/, ''), documentDate: dates[dates.length - 1]!, total };
            doc = { ...common, title: isPos ? 'Báo cáo nền tảng' : 'Sao kê ngân hàng', counterparty: fields.supplier, sourceKind: isPos ? 'CSV' : 'BANK', date: fields.documentDate, amount: total, status: 'EXTRACTED', fields, lines: [], rows, rowKind: isPos ? 'POS' : 'BANK', extraction: null, issues: [], kind: 'STATEMENT' };
          } else if (fmt === 'EXCEL' || fmt === 'JSON') {
            const fields = { supplier: '', documentNo: f.name.replace(/\.[^.]+$/, ''), documentDate: now.slice(0, 10), total: '0' };
            const issues: FieldIssue[] = [{ field: 'total', severity: 'warning', message: 'Cần ánh xạ cột dữ liệu trước khi xác nhận' }];
            doc = { ...common, title: 'Tệp dữ liệu', counterparty: '', sourceKind: 'EXCEL', date: fields.documentDate, amount: '0', status: 'NEEDS_REVIEW', fields, lines: [], rows: [], rowKind: null, extraction: null, issues, kind: 'OTHER' };
          } else {
            const ex = extractions.get(i)!;
            const get = (n: keyof DocumentFields) => ex.fields.find((x) => x.name === n)?.value ?? '';
            const fields = { supplier: get('supplier'), documentNo: get('documentNo'), documentDate: get('documentDate') || now.slice(0, 10), total: get('total') || '0' };
            const lowConfidence = ex.fields.filter((x) => x.confidence < 0.85).map((x) => x.name);
            const issues = validateFields({ ...fields, lines: ex.lines.length ? ex.lines : undefined }, { today: now.slice(0, 10), knownDocumentKeys: knownKeys, lowConfidence });
            doc = { ...common, title: 'Hóa đơn mua hàng', counterparty: fields.supplier, sourceKind: fmt === 'PDF' ? 'PDF' : 'PHOTO', date: fields.documentDate, amount: fields.total, status: issues.length ? 'NEEDS_REVIEW' : 'EXTRACTED', fields, lines: ex.lines, rows: [], rowKind: null, extraction: { modelVersion: ex.modelVersion, fields: ex.fields }, issues, kind: 'EXPENSE' };
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Không đọc được tệp';
          doc = { ...common, title: 'Tệp cần kiểm tra', counterparty: '', sourceKind: fmt === 'XML' ? 'XML_EINVOICE' : fmt === 'CSV' ? 'CSV' : 'PDF', date: now.slice(0, 10), amount: '0', status: 'NEEDS_REVIEW', fields: { supplier: '', documentNo: '', documentDate: now.slice(0, 10), total: '0' }, lines: [], rows: [], rowKind: null, extraction: null, issues: [{ field: 'documentNo', severity: 'error', message }], kind: 'OTHER' };
        }
        if (doc.status === 'NEEDS_REVIEW') needsReview++;
        else normalized++;
        await tx.put('documents', doc);
        created.push({ documentId: doc.id, code: doc.code, status: doc.status, duplicate: false, filename: f.name });
        await em.emit({ type: 'DocumentExtracted', tenantId: ws.tenantId, entityId, aggregateType: 'Document', aggregateId: doc.id, actorId: ws.user.id, dataRef: `document/${doc.id}`, dataVersion: 0, data: { documentId: doc.id, code: doc.code, status: doc.status } });
      }
      await tx.put('importBatches', {
        id: batchId,
        tenantId: ws.tenantId,
        code,
        entityId,
        sourceKind: 'MIXED',
        location: (p.location ?? '').slice(0, 120),
        status: needsReview ? 'NEEDS_REVIEW' : 'READY',
        fileCount: decoded.length,
        normalized,
        needsReview,
        duplicates,
        createdBy: ws.user.id,
        parserVersion: PARSER_VERSION,
      });
      await em.emit({ type: 'BatchReceived', tenantId: ws.tenantId, entityId, aggregateType: 'ImportBatch', aggregateId: batchId, actorId: ws.user.id, dataRef: `batch/${batchId}`, dataVersion: 1, data: { batchId, code, files: decoded.length, needsReview, duplicates } });
      await em.audit(ws.tenantId, actor(ws), 'batch.receive', code, `${decoded.length} tệp`);
      return { batchId, code, files: created, normalized, needsReview, duplicates };
    });
  }

  async listDocuments(call: CallContext, p: { q?: string; status?: string } & PageParams = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'document.read');
      let docs = await scoped(tx, ws, 'documents');
      const all = docs;
      if (p.status === 'review') docs = docs.filter((d) => d.status === 'NEEDS_REVIEW' || d.status === 'EXTRACTED' || d.status === 'NEEDS_RECON');
      else if (p.status === 'done') docs = docs.filter((d) => d.status === 'VALIDATED');
      if (p.q) {
        const q = p.q.toLowerCase();
        docs = docs.filter((d) => `${d.code} ${d.title} ${d.counterparty} ${d.fields.documentNo}`.toLowerCase().includes(q));
      }
      docs.sort((a, b) => b.code.localeCompare(a.code, undefined, { numeric: true }));
      const pg = paginate(docs, p, 20);
      return {
        kpis: {
          total: all.length,
          needsReview: all.filter((d) => d.status === 'NEEDS_REVIEW' || d.status === 'NEEDS_RECON' || d.status === 'EXTRACTED').length,
          validated: all.filter((d) => d.status === 'VALIDATED').length,
        },
        canCreate: this.core.can(ws, 'document.create'),
        page: pg.page,
        pageSize: pg.pageSize,
        total: pg.total,
        pageCount: pg.pageCount,
        items: pg.items.map((d) => ({
          id: d.id,
          code: d.code,
          title: d.title,
          counterparty: d.counterparty,
          label: `${d.code} · ${d.title}`,
          source: SOURCE_LABEL[d.sourceKind],
          date: d.date,
          dateLabel: formatDate(d.date),
          amount: d.amount,
          amountLabel: formatVnd(d.amount),
          status: d.status,
          statusLabel: DOC_STATUS_LABEL[d.status],
        })),
      };
    });
  }

  async getDocument(call: CallContext, p: { documentId: string }) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'document.read');
      const doc = await findDoc(tx, ws.tenantId, p.documentId);
      inScope(ws, doc.entityId);
      const artifact = doc.artifactId ? await tx.get('artifacts', ws.tenantId, doc.artifactId) : undefined;
      const versions = (await tx.list('documentVersions', ws.tenantId, { documentId: doc.id })).sort((a, b) => a.version - b.version);
      return {
        document: { ...doc, sourceLabel: SOURCE_LABEL[doc.sourceKind], statusLabel: DOC_STATUS_LABEL[doc.status], entityLabel: await scopeLabel(tx, ws.tenantId, doc.entityId) },
        artifact: artifact ? { filename: artifact.filename, mime: artifact.mime, size: artifact.size, rawSha256: artifact.rawSha256, receivedAt: artifact.receivedAt, content: artifact.content } : null,
        versions: versions.map((v) => ({ version: v.version, confirmedByName: v.confirmedByName, confirmedAt: v.confirmedAt, note: v.note, fingerprint: v.fingerprint })),
        canValidate: this.core.can(ws, 'document.validate', doc.entityId),
      };
    });
  }

  private computeIssues(tx: Tx, ws: WorkspaceState, doc: DocumentRow, fields: DocumentRow['fields'], now: string) {
    return this.knownKeys(tx, ws.tenantId, doc.id).then((keys) =>
      validateFields(
        { ...fields, lines: doc.kind === 'EXPENSE' && doc.lines.length ? doc.lines : undefined },
        { today: now.slice(0, 10), knownDocumentKeys: doc.kind === 'EXPENSE' ? keys : [] },
      ),
    );
  }

  async saveDraft(call: CallContext, p: { documentId: string; fields: DocumentRow['fields'] }) {
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'document.create');
      const doc = await findDoc(tx, ws.tenantId, p.documentId);
      inScope(ws, doc.entityId);
      if (doc.status === 'VALIDATED' || doc.status === 'REJECTED') throw new AppError('CONFLICT', 'Chứng từ đã được xác nhận, không thể sửa bản nháp');
      const fields = normalizeFields(p.fields);
      const issues = await this.computeIssues(tx, ws, doc, fields, now);
      const saved = await tx.put('documents', { ...doc, fields, counterparty: fields.supplier || doc.counterparty, date: fields.documentDate, amount: fields.total, issues, status: statusFromIssues(issues) });
      await em.audit(ws.tenantId, actor(ws), 'document.draft', doc.code);
      return { status: saved.status, issues };
    });
  }

  /** "Người có quyền xác nhận trường dữ liệu" → DocumentVersion + BusinessRecord + RecordEvidence + DocumentValidated. */
  async confirmDocument(call: CallContext, p: { documentId: string; fields?: DocumentRow['fields']; acknowledgeWarnings?: boolean }) {
    return this.core.command(call, async (tx, em, now) => {
      const ws0 = await this.core.requireWorkspace(tx, call, 'document.read');
      const doc = await findDoc(tx, ws0.tenantId, p.documentId);
      const ws = await this.core.requireWorkspace(tx, call, 'document.validate', { entityId: doc.entityId });
      if (doc.status === 'VALIDATED') throw new AppError('CONFLICT', 'Chứng từ đã được xác nhận');
      if (doc.status === 'REJECTED') throw new AppError('CONFLICT', 'Chứng từ đã bị từ chối');
      const fields = normalizeFields(p.fields ?? doc.fields);
      const issues = await this.computeIssues(tx, ws, doc, fields, now);
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length) throw new AppError('VALIDATION', errors[0]!.message, { issues });
      const warnings = issues.filter((i) => i.severity === 'warning' && !i.message.includes('Độ tin cậy'));
      if (warnings.length && !p.acknowledgeWarnings) throw new AppError('VALIDATION', warnings[0]!.message, { issues, needsAcknowledge: true });
      assertTransition(doc.status === 'NEEDS_RECON' ? 'EXTRACTED' : doc.status, 'VALIDATED');
      const version = doc.currentVersion + 1;
      const artifact = doc.artifactId ? await tx.get('artifacts', ws.tenantId, doc.artifactId) : undefined;
      const salt = randomHex(16);
      const payload: DocumentVersionPayload = {
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        tenantId: ws.tenantId,
        documentId: doc.id,
        documentCode: doc.code,
        version,
        rawSha256: artifact?.rawSha256 ?? null,
        fields: fields as unknown as Record<string, unknown>,
        confirmedBy: ws.user.id,
        confirmedAt: now,
      };
      const versionRow: Omit<DocumentVersionRow, 'createdAt' | 'updatedAt' | 'rev'> = {
        id: `${doc.id}@${version}`,
        tenantId: ws.tenantId,
        documentId: doc.id,
        version,
        artifactId: doc.artifactId,
        parserVersion: PARSER_VERSION,
        fields,
        fieldLocator: doc.extraction ? `${doc.extraction.modelVersion}#bbox` : doc.sourceKind === 'XML_EINVOICE' ? 'xml:/HDon/DLHDon' : 'csv:rows',
        confirmedBy: ws.user.id,
        confirmedByName: ws.membership.displayName,
        confirmedAt: now,
        note: version === 1 ? 'Xác nhận lần đầu' : `Xác nhận phiên bản ${String(version).padStart(2, '0')}`,
        fingerprint: saltedFingerprint(payload, salt),
        salt,
      };
      await tx.put('documentVersions', versionRow);
      // Business records with provenance (RecordEvidence).
      const periodId = periodOf(fields.documentDate);
      const records: { recordId: string; amount: string }[] = [];
      const putRecord = async (r: { kind: 'EXPENSE' | 'ORDER' | 'BANK_TXN'; code: string; amount: string; date: string; channel: string; counterparty: string; reference: string; payoutBatch: string; description?: string; fee: string; refund: string; discount: string; locator: string }) => {
        const recordId = newId('rec');
        await tx.put('records', {
          id: recordId,
          tenantId: ws.tenantId,
          recordId,
          version: 1,
          entityId: doc.entityId,
          kind: r.kind,
          code: r.code,
          amount: r.amount,
          currency: 'VND',
          date: r.date,
          channel: r.channel,
          counterparty: r.counterparty,
          reference: r.reference,
          payoutBatch: r.payoutBatch,
          description: r.description ?? '',
          fee: r.fee,
          refund: r.refund,
          discount: r.discount,
          adjustment: '0',
          documentId: doc.id,
          matchGroupId: null,
          periodId: periodOf(r.date),
        });
        await tx.put('recordEvidence', { id: newId('rev'), tenantId: ws.tenantId, recordId, recordVersion: 1, documentId: doc.id, documentVersion: version, fieldLocator: r.locator });
        records.push({ recordId, amount: r.amount });
      };
      if (doc.kind === 'EXPENSE') {
        await putRecord({ kind: 'EXPENSE', code: doc.code, amount: fields.total, date: fields.documentDate, channel: 'Chi phí', counterparty: fields.supplier, reference: fields.documentNo, payoutBatch: '', fee: '0', refund: '0', discount: '0', locator: 'fields.total' });
      } else if (doc.kind === 'STATEMENT') {
        for (const r of doc.rows) {
          if (doc.rowKind === 'BANK' && D(r.amount).lte(0)) continue; // outflows handled as expenses with documents
          await putRecord({
            kind: doc.rowKind === 'POS' ? 'ORDER' : 'BANK_TXN',
            code: r.code,
            amount: r.amount,
            date: r.date,
            channel: r.channel,
            counterparty: r.counterparty,
            reference: r.reference,
            payoutBatch: r.payoutBatch,
            description: r.description,
            fee: r.fee,
            refund: r.refund,
            discount: r.discount,
            locator: `row:${r.lineNo}`,
          });
        }
      }
      await tx.put('documents', { ...doc, fields, counterparty: fields.supplier || doc.counterparty, date: fields.documentDate, amount: fields.total, issues: [], status: 'VALIDATED', currentVersion: version, validatedBy: ws.user.id, validatedAt: now });
      await em.emit({ type: 'DocumentValidated', tenantId: ws.tenantId, entityId: doc.entityId, aggregateType: 'Document', aggregateId: doc.id, actorId: ws.user.id, dataRef: `document/${doc.id}`, dataVersion: version, data: { documentId: doc.id, version, periodId, records: records.length } });
      await em.audit(ws.tenantId, actor(ws), 'document.validate', doc.code, `v${version}`);
      return { documentId: doc.id, version, records: records.length, fingerprint: versionRow.fingerprint };
    });
  }

  async rejectDocument(call: CallContext, p: { documentId: string; reason: string }) {
    const reason = requireText(p.reason, 'Lý do', 300);
    return this.core.command(call, async (tx, em) => {
      const ws0 = await this.core.requireWorkspace(tx, call, 'document.read');
      const doc = await findDoc(tx, ws0.tenantId, p.documentId);
      const ws = await this.core.requireWorkspace(tx, call, 'document.validate', { entityId: doc.entityId });
      if (doc.status === 'VALIDATED') throw new AppError('CONFLICT', 'Chứng từ đã xác nhận không thể từ chối');
      await tx.put('documents', { ...doc, status: 'REJECTED', issues: [{ field: 'documentNo', severity: 'error', message: reason }] });
      await em.audit(ws.tenantId, actor(ws), 'document.reject', doc.code, reason);
      return { ok: true };
    });
  }

  async listBatches(call: CallContext) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'document.read');
      const batches = (await scoped(tx, ws, 'importBatches')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const integrations = await tx.list('integrations', ws.tenantId);
      const latest = batches[0];
      return {
        sources: integrations.sort((a, b) => order(a.kind) - order(b.kind)).map((i) => ({ id: i.id, kind: i.kind, name: i.name, description: i.description, status: i.status })),
        latest: latest
          ? { ...latest, entityLabel: await scopeLabel(tx, ws.tenantId, latest.entityId), stage: latest.needsReview ? 2 : 4 }
          : null,
        batches: batches.slice(0, 50).map((b) => ({ id: b.id, code: b.code, fileCount: b.fileCount, needsReview: b.needsReview, duplicates: b.duplicates, status: b.status, createdAt: b.createdAt })),
      };
    });
  }
}

const KIND_ORDER = ['POS', 'PLATFORM', 'BANK', 'EINVOICE', 'PAPER', 'EXCEL'];
const order = (k: string) => KIND_ORDER.indexOf(k);

function extractBatchRef(description: string): string {
  const m = /\b(TT-\d+|S\d{2,}|LOT[-\w]+)\b/i.exec(description);
  return m ? m[1]!.toUpperCase() : '';
}

export function normalizeFields(f: DocumentRow['fields']): DocumentRow['fields'] {
  if (!f || typeof f !== 'object') throw new AppError('VALIDATION', 'Thiếu nội dung chứng từ');
  const total = String(f.total ?? '').replace(/[^\d,.-]/g, '');
  let normalizedTotal = total;
  if (/^\d{1,3}(\.\d{3})+$/.test(total)) normalizedTotal = total.replace(/\./g, '');
  else if (/^\d+,\d+$/.test(total)) normalizedTotal = total.replace(',', '.');
  let date = String(f.documentDate ?? '').trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);
  if (m) date = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return {
    supplier: String(f.supplier ?? '').trim().slice(0, 200),
    documentNo: String(f.documentNo ?? '').trim().slice(0, 60),
    documentDate: date,
    total: normalizedTotal || '0',
    taxCode: f.taxCode ? String(f.taxCode).trim() : undefined,
  };
}

export async function findDoc(tx: Tx, tenantId: string, idOrCode: string): Promise<DocumentRow> {
  const byId = await tx.get('documents', tenantId, idOrCode ?? '');
  if (byId) return byId;
  const [byCode] = await tx.list('documents', tenantId, { code: (idOrCode ?? '').toUpperCase() });
  return requireFound(byCode, 'chứng từ');
}

export function inScope(ws: WorkspaceState, entityId: string): void {
  if (ws.entityId !== '*' && ws.entityId !== entityId) throw new AppError('NOT_FOUND', 'Không tìm thấy dữ liệu trong phạm vi đang chọn');
  const allowed = ws.membership.bindings.some((b) => b.entityIds === '*' || b.entityIds.includes(entityId));
  if (!allowed) throw new AppError('NOT_FOUND', 'Không tìm thấy dữ liệu trong phạm vi được cấp');
}

/** Rows visible in the current scope (selected site + membership entity scope). */
export async function scoped<K extends 'documents' | 'records' | 'matchGroups' | 'approvals' | 'importBatches' | 'purchaseOrders' | 'dailyCloses' | 'inventoryItems'>(
  tx: Tx,
  ws: WorkspaceState,
  col: K,
) {
  const rows = (await tx.list(col, ws.tenantId)) as unknown as { entityId: string }[];
  const allowAll = ws.membership.bindings.some((b) => b.entityIds === '*');
  const allowed = new Set(ws.membership.bindings.flatMap((b) => (b.entityIds === '*' ? [] : b.entityIds)));
  return rows.filter((r) => (ws.entityId === '*' || r.entityId === ws.entityId) && (allowAll || allowed.has(r.entityId))) as never as Collections[K][];
}

export async function defaultSite(tx: Tx, tenantId: string): Promise<string> {
  const sites = (await tx.list('entities', tenantId, { kind: 'SITE' })).sort((a, b) => a.code.localeCompare(b.code));
  if (sites[0]) return sites[0].id;
  const [le] = await tx.list('entities', tenantId, { kind: 'LEGAL_ENTITY' });
  return requireFound(le, 'pháp nhân').id;
}
