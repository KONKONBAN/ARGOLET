import {
  chooseParser,
  D,
  dec,
  detectFormat,
  documentKey,
  formatDate,
  formatVnd,
  newId,
  nextCode,
  parseBankStatementCsv,
  parseEInvoiceXml,
  assessAuthenticity,
  readImageMeta,
  readQrContent,
  type ExtractionField,
  type ImageMeta,
  parsePosCsv,
  randomHex,
  saltedFingerprint,
  sha256Hex,
  sum,
  validateFields,
  assertTransition,
  EVIDENCE_SCHEMA_VERSION,
  type DocumentFields,
  type DocumentVersionPayload,
  type FieldIssue,
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

const DOC_STATUS_LABEL: Record<DocumentRow['status'], string> = {
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
  /** Text of a QR code the client read on this photo / PDF (the e-invoice QR, QĐ 1450). */
  qr?: string | undefined;
}

interface DecodedFile {
  bytes: Uint8Array;
  text: string | null;
  bom: boolean;
  exact: boolean;
}

/** Strict UTF-8 decoding without relying on TextDecoder (not available on every mobile JS engine). */
function utf8Decode(bytes: Uint8Array): string | null {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b0 = bytes[i]!;
    let cp: number;
    let n: number;
    if (b0 < 0x80) [cp, n] = [b0, 1];
    else if (b0 >= 0xc2 && b0 < 0xe0) [cp, n] = [b0 & 0x1f, 2];
    else if (b0 >= 0xe0 && b0 < 0xf0) [cp, n] = [b0 & 0x0f, 3];
    else if (b0 >= 0xf0 && b0 < 0xf5) [cp, n] = [b0 & 0x07, 4];
    else return null;
    if (i + n > bytes.length) return null;
    for (let k = 1; k < n; k++) {
      const b = bytes[i + k]!;
      if ((b & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (b & 0x3f);
    }
    if (
      (n === 3 && (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff))) ||
      (n === 4 && (cp < 0x10000 || cp > 0x10ffff))
    )
      return null;
    out += String.fromCodePoint(cp);
    i += n;
  }
  return out;
}

function utf16Decode(bytes: Uint8Array, littleEndian: boolean): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2)
    out += String.fromCharCode(
      littleEndian ? bytes[i]! | (bytes[i + 1]! << 8) : (bytes[i]! << 8) | bytes[i + 1]!,
    );
  return out;
}

const TEXT_SOURCE = /\.(xml|csv|tsv|txt|json)$/i;

/** Text of a source file: UTF-8 (with or without BOM) is kept byte-exact; UTF-16 / Windows-1258 exports are converted. */
function decodeText(bytes: Uint8Array): { text: string; bom: boolean; exact: boolean } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return { text: utf16Decode(bytes.subarray(2), true), bom: false, exact: false };
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return { text: utf16Decode(bytes.subarray(2), false), bom: false, exact: false };
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const text = utf8Decode(bom ? bytes.subarray(3) : bytes);
  if (text !== null) return { text, bom, exact: true };
  if (typeof TextDecoder !== 'undefined') {
    try {
      return { text: new TextDecoder('windows-1258').decode(bytes), bom: false, exact: false };
    } catch {
      return null;
    }
  }
  return null;
}

function decodeFile(f: IntakeFile): DecodedFile {
  if (typeof f.text === 'string')
    return { bytes: new TextEncoder().encode(f.text), text: f.text, bom: false, exact: true };
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
    // The fingerprint is always taken over these exact bytes; text is derived only for parsing.
    if (TEXT_SOURCE.test(f.name) || /xml|csv|json|^text\//i.test(f.mime ?? '')) {
      const t = decodeText(bytes);
      if (t) return { bytes, text: t.text, bom: t.bom, exact: t.exact };
    }
    return { bytes, text: null, bom: false, exact: false };
  }
  throw new AppError('VALIDATION', `Tệp ${f.name} không có nội dung`);
}

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 50;

function statusFromIssues(issues: FieldIssue[]): DocumentRow['status'] {
  return issues.length > 0 ? 'NEEDS_REVIEW' : 'EXTRACTED';
}

export class DocumentService {
  constructor(private readonly core: AppCore) {}

  private async allCodes(tx: Tx, tenantId: string, col: 'documents' | 'importBatches'): Promise<string[]> {
    return (await tx.list(col, tenantId)).map((d) => d.code);
  }

  private async knownKeys(tx: Tx, tenantId: string, excludeId?: string): Promise<string[]> {
    return (await tx.list('documents', tenantId))
      .filter(
        (d) => d.id !== excludeId && d.status !== 'REJECTED' && d.kind === 'EXPENSE' && d.fields.documentNo,
      )
      .map((d) => documentKey(d.fields));
  }

  /** 05 · Tiếp nhận lô: batch_id, bản gốc + SHA-256 + metadata, chọn bộ phân tích, kiểm chứng. */
  async intake(call: CallContext, p: { entityId?: string; location?: string; files: IntakeFile[] }) {
    if (!Array.isArray(p.files) || p.files.length === 0)
      throw new AppError('VALIDATION', 'Chọn ít nhất một tệp để tiếp nhận');
    if (p.files.length > MAX_FILES) throw new AppError('VALIDATION', `Tối đa ${MAX_FILES} tệp mỗi lô`);
    const decoded = p.files.map((f) => {
      const name = requireText(f.name, 'Tên tệp', 200);
      const d = decodeFile(f);
      if (d.bytes.length > MAX_FILE_BYTES) throw new AppError('VALIDATION', `Tệp ${name} vượt quá 15 MB`);
      const qr = typeof f.qr === 'string' && f.qr.trim() ? f.qr.trim() : undefined;
      if (qr && qr.length > 512) throw new AppError('VALIDATION', `Dữ liệu mã QR của ${name} quá dài`);
      return { name, mime: f.mime ?? '', ...d, sha: sha256Hex(d.bytes), qr };
    });
    // OCR / VLM extraction runs outside the DB transaction.
    const extractions = new Map<number, Awaited<ReturnType<AppCore['deps']['extraction']['extract']>>>();
    const imageMetas = new Map<number, ImageMeta>();
    for (const [i, f] of decoded.entries()) {
      const fmt = detectFormat(f.name, f.mime);
      if (fmt === 'IMAGE') imageMetas.set(i, readImageMeta(f.bytes));
      if (chooseParser(fmt) === 'ocr_vlm') {
        extractions.set(
          i,
          await this.core.deps.extraction.extract({
            bytes: f.bytes,
            mime: f.mime || (fmt === 'PDF' ? 'application/pdf' : 'image/jpeg'),
            filename: f.name,
          }),
        );
      }
    }
    return this.core.command(call, async (tx, em, now) => {
      const ws0 = await this.core.requireWorkspace(tx, call, 'document.create');
      const entityId =
        p.entityId && p.entityId !== '*'
          ? p.entityId
          : ws0.entityId !== '*'
            ? ws0.entityId
            : await defaultSite(tx, ws0.tenantId);
      const ws = await this.core.requireWorkspace(tx, call, 'document.create', { entityId });
      requireFound(await tx.get('entities', ws.tenantId, entityId), 'cơ sở');
      const today = now.slice(0, 10).replace(/-/g, '');
      const batchCodes = await this.allCodes(tx, ws.tenantId, 'importBatches');
      const base = `LO-${today}`;
      const code = batchCodes.includes(base) ? nextCode(base, batchCodes, 2, 2) : base;
      const batchId = newId('bat');
      const existingArtifacts = await tx.list('artifacts', ws.tenantId);
      const knownKeys = await this.knownKeys(tx, ws.tenantId);
      const tenant = await tx.get('tenants', ws.tenantId, ws.tenantId);
      let docCodes = await this.allCodes(tx, ws.tenantId, 'documents');
      const created: {
        documentId: string;
        code: string;
        status: DocumentRow['status'];
        duplicate: boolean;
        filename: string;
      }[] = [];
      let duplicates = 0;
      const seenInBatch = new Map<string, string>();
      let needsReview = 0;
      let normalized = 0;
      for (const [i, f] of decoded.entries()) {
        const artifactId = newId('art');
        const dup =
          existingArtifacts.find((a) => a.rawSha256 === f.sha) ??
          (seenInBatch.has(f.sha) ? { id: seenInBatch.get(f.sha)! } : undefined);
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
          contentBom: f.bom,
          contentExact: f.exact,
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
            // Our own sales invoice (seller = this organisation) is revenue, the buyer the counterparty.
            const isSale = !!tenant?.taxCode && inv.sellerTaxCode === tenant.taxCode.trim();
            const counterparty = isSale ? inv.buyerName : inv.sellerName;
            const fields = {
              supplier: counterparty,
              documentNo: inv.documentNo,
              documentDate: inv.issueDate,
              total: inv.totalVnd,
              taxCode: (isSale ? inv.buyerTaxCode : inv.sellerTaxCode) || undefined,
              series: inv.symbol || undefined,
            };
            const lines = vndLines(inv);
            const issues = validateFields(
              { ...fields, lines: withVat(lines, inv.vatVnd) },
              { today: now.slice(0, 10), knownDocumentKeys: knownKeys },
            );
            for (const m of inv.inconsistencies)
              issues.push({ field: 'total', severity: 'error', message: m });
            if (!inv.sellerSigned)
              issues.push({
                field: 'documentNo',
                severity: 'warning',
                message: 'Hóa đơn XML không có chữ ký số của người bán',
              });
            if (inv.currency !== 'VND' && inv.exchangeRate)
              issues.push({
                field: 'total',
                severity: 'warning',
                message: `Hóa đơn bằng ${inv.currency}: đã quy đổi ${inv.total} × tỷ giá ${inv.exchangeRate} = ${formatVnd(inv.totalVnd)} — kiểm tra tỷ giá ghi sổ`,
              });
            doc = {
              ...common,
              title: isSale
                ? `Hóa đơn bán ra · ${counterparty || 'khách hàng'}`
                : inv.sellerName || 'Hóa đơn điện tử',
              counterparty,
              sourceKind: 'XML_EINVOICE',
              date: inv.issueDate,
              amount: inv.totalVnd,
              status: statusFromIssues(issues),
              fields,
              lines,
              vat: inv.vatVnd,
              rows: [],
              rowKind: null,
              extraction: null,
              issues,
              kind: isSale ? 'REVENUE' : 'EXPENSE',
            };
          } else if (fmt === 'CSV') {
            const header = (text ?? '').split(/\r?\n/, 1)[0] ?? '';
            const isPos = /m[aã]\s*đ[oơ]n|order/i.test(header);
            let rows: StructuredRow[];
            if (isPos) {
              rows = parsePosCsv(text ?? '').map((r) => ({
                lineNo: r.lineNo,
                code: r.orderCode,
                date: r.date,
                amount: r.gross,
                fee: r.fee,
                refund: r.refund,
                discount: r.discount,
                reference: '',
                payoutBatch: r.payoutBatch,
                counterparty: r.channel,
                channel: r.channel || 'Nền tảng',
                description: '',
              }));
            } else {
              rows = parseBankStatementCsv(text ?? '').map((r) => ({
                lineNo: r.lineNo,
                code: r.reference || `L${r.lineNo}`,
                date: r.date,
                amount: r.amount,
                fee: '0',
                refund: '0',
                discount: '0',
                reference: r.reference,
                payoutBatch: extractBatchRef(r.description),
                counterparty: r.counterparty,
                channel: 'Ngân hàng',
                description: r.description,
              }));
            }
            if (rows.length === 0) throw new Error('Tệp không có dòng dữ liệu');
            const dates = rows.map((r) => r.date).sort();
            const total = dec(sum(rows.map((r) => r.amount)));
            const fields = {
              supplier: isPos ? 'Báo cáo nền tảng' : 'Sao kê ngân hàng',
              documentNo: f.name.replace(/\.[^.]+$/, ''),
              documentDate: dates[dates.length - 1]!,
              total,
            };
            doc = {
              ...common,
              title: isPos ? 'Báo cáo nền tảng' : 'Sao kê ngân hàng',
              counterparty: fields.supplier,
              sourceKind: isPos ? 'CSV' : 'BANK',
              date: fields.documentDate,
              amount: total,
              status: 'EXTRACTED',
              fields,
              lines: [],
              rows,
              rowKind: isPos ? 'POS' : 'BANK',
              extraction: null,
              issues: [],
              kind: 'STATEMENT',
            };
          } else if (fmt === 'EXCEL' || fmt === 'JSON') {
            const fields = {
              supplier: '',
              documentNo: f.name.replace(/\.[^.]+$/, ''),
              documentDate: now.slice(0, 10),
              total: '0',
            };
            const issues: FieldIssue[] = [
              { field: 'total', severity: 'warning', message: 'Cần ánh xạ cột dữ liệu trước khi xác nhận' },
            ];
            doc = {
              ...common,
              title: 'Tệp dữ liệu',
              counterparty: '',
              sourceKind: 'EXCEL',
              date: fields.documentDate,
              amount: '0',
              status: 'NEEDS_REVIEW',
              fields,
              lines: [],
              rows: [],
              rowKind: null,
              extraction: null,
              issues,
              kind: 'OTHER',
            };
          } else {
            const ex = extractions.get(i)!;
            // The e-invoice QR printed on the paper (read by the client) carries the invoice identity
            // exactly as issued: used for any field the extraction did not read, if its CRC is valid.
            const qrRead = f.qr ? readQrContent(f.qr) : null;
            const qr =
              qrRead?.kind === 'INVOICE' && qrRead.qr.crcOk && !qrRead.qr.problems.length ? qrRead.qr : null;
            const fromQr: ExtractionField[] = qr
              ? [
                  { name: 'taxCode', value: qr.sellerTaxCode, confidence: 0.99 },
                  { name: 'series', value: qr.symbol, confidence: 0.99 },
                  { name: 'documentNo', value: qr.documentNo, confidence: 0.99 },
                  { name: 'documentDate', value: qr.issueDate, confidence: 0.99 },
                  ...(qr.currencyCode === '' || qr.currencyCode === '704'
                    ? [{ name: 'total' as const, value: qr.total, confidence: 0.99 }]
                    : []),
                ]
              : [];
            const exFields = [
              ...ex.fields.filter((x) => x.value),
              ...fromQr.filter((q) => !ex.fields.some((x) => x.name === q.name && x.value)),
            ];
            const get = (n: keyof DocumentFields) => exFields.find((x) => x.name === n)?.value ?? '';
            // Nothing is invented: a date or total that was not read stays empty for a person to fill in.
            const fields = {
              supplier: get('supplier'),
              documentNo: get('documentNo'),
              documentDate: get('documentDate'),
              total: get('total') || '0',
              ...(get('taxCode') ? { taxCode: get('taxCode') } : {}),
              ...(get('series') ? { series: get('series') } : {}),
            };
            const lowConfidence = exFields.filter((x) => x.confidence < 0.85).map((x) => x.name);
            const issues = validateFields(
              { ...fields, lines: ex.lines.length ? ex.lines : undefined },
              { today: now.slice(0, 10), knownDocumentKeys: knownKeys, lowConfidence },
            );
            doc = {
              ...common,
              title: 'Hóa đơn mua hàng',
              counterparty: fields.supplier,
              sourceKind: fmt === 'PDF' ? 'PDF' : 'PHOTO',
              date: fields.documentDate || now.slice(0, 10),
              amount: fields.total,
              status: issues.length ? 'NEEDS_REVIEW' : 'EXTRACTED',
              fields,
              lines: ex.lines,
              rows: [],
              rowKind: null,
              extraction: {
                modelVersion: qr && !ex.fields.some((x) => x.value) ? 'qr-tt78-1450' : ex.modelVersion,
                fields: exFields,
                ...(imageMetas.has(i) ? { imageMeta: imageMetas.get(i) } : {}),
                ...(f.qr ? { qr: f.qr } : {}),
              },
              issues,
              kind: 'EXPENSE',
            };
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Không đọc được tệp';
          doc = {
            ...common,
            title: 'Tệp cần kiểm tra',
            counterparty: '',
            sourceKind: fmt === 'XML' ? 'XML_EINVOICE' : fmt === 'CSV' ? 'CSV' : 'PDF',
            date: now.slice(0, 10),
            amount: '0',
            status: 'NEEDS_REVIEW',
            fields: { supplier: '', documentNo: '', documentDate: now.slice(0, 10), total: '0' },
            lines: [],
            rows: [],
            rowKind: null,
            extraction: null,
            issues: [{ field: 'documentNo', severity: 'error', message }],
            kind: 'OTHER',
          };
        }
        if (doc.status === 'NEEDS_REVIEW') needsReview++;
        else normalized++;
        await tx.put('documents', doc);
        created.push({
          documentId: doc.id,
          code: doc.code,
          status: doc.status,
          duplicate: false,
          filename: f.name,
        });
        await em.emit({
          type: 'DocumentExtracted',
          tenantId: ws.tenantId,
          entityId,
          aggregateType: 'Document',
          aggregateId: doc.id,
          actorId: ws.user.id,
          dataRef: `document/${doc.id}`,
          dataVersion: 0,
          data: { documentId: doc.id, code: doc.code, status: doc.status },
        });
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
      await em.emit({
        type: 'BatchReceived',
        tenantId: ws.tenantId,
        entityId,
        aggregateType: 'ImportBatch',
        aggregateId: batchId,
        actorId: ws.user.id,
        dataRef: `batch/${batchId}`,
        dataVersion: 1,
        data: { batchId, code, files: decoded.length, needsReview, duplicates },
      });
      await em.audit(ws.tenantId, actor(ws), 'batch.receive', code, `${decoded.length} tệp`);
      return { batchId, code, files: created, normalized, needsReview, duplicates };
    });
  }

  async listDocuments(call: CallContext, p: { q?: string; status?: string } & PageParams = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'document.read');
      let docs = await scoped(tx, ws, 'documents');
      const all = docs;
      if (p.status === 'review')
        docs = docs.filter(
          (d) => d.status === 'NEEDS_REVIEW' || d.status === 'EXTRACTED' || d.status === 'NEEDS_RECON',
        );
      else if (p.status === 'done') docs = docs.filter((d) => d.status === 'VALIDATED');
      if (p.q) {
        const q = p.q.toLowerCase();
        docs = docs.filter((d) =>
          `${d.code} ${d.title} ${d.counterparty} ${d.fields.documentNo}`.toLowerCase().includes(q),
        );
      }
      docs.sort((a, b) => b.code.localeCompare(a.code, undefined, { numeric: true }));
      const pg = paginate(docs, p, 20);
      return {
        kpis: {
          total: all.length,
          needsReview: all.filter(
            (d) => d.status === 'NEEDS_REVIEW' || d.status === 'NEEDS_RECON' || d.status === 'EXTRACTED',
          ).length,
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
    return this.core.query(async (tx, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'document.read');
      const doc = await findDoc(tx, ws.tenantId, p.documentId);
      inScope(ws, doc.entityId);
      const artifact = doc.artifactId ? await tx.get('artifacts', ws.tenantId, doc.artifactId) : undefined;
      const versions = (await tx.list('documentVersions', ws.tenantId, { documentId: doc.id })).sort(
        (a, b) => a.version - b.version,
      );
      return {
        document: {
          ...doc,
          sourceLabel: SOURCE_LABEL[doc.sourceKind],
          statusLabel: DOC_STATUS_LABEL[doc.status],
          entityLabel: await scopeLabel(tx, ws.tenantId, doc.entityId),
        },
        artifact: artifact
          ? {
              filename: artifact.filename,
              mime: artifact.mime,
              size: artifact.size,
              rawSha256: artifact.rawSha256,
              receivedAt: artifact.receivedAt,
              content: artifact.content,
            }
          : null,
        versions: versions.map((v) => ({
          version: v.version,
          confirmedByName: v.confirmedByName,
          confirmedAt: v.confirmedAt,
          note: v.note,
          fingerprint: v.fingerprint,
        })),
        canValidate: this.core.can(ws, 'document.validate', doc.entityId),
        authenticity: await this.authenticity(tx, ws.tenantId, doc, doc.fields, now),
      };
    });
  }

  /**
   * Fake / altered / non-deductible document signals (see core/authenticity): the invoice itself
   * (XML re-read from the stored original), its addressee, duplicates and the counterparty history.
   */
  private async authenticity(
    tx: Tx,
    tenantId: string,
    doc: DocumentRow,
    fields: DocumentRow['fields'],
    now: string,
  ) {
    if (doc.kind === 'STATEMENT') return null;
    const artifact = doc.artifactId ? await tx.get('artifacts', tenantId, doc.artifactId) : undefined;
    let invoice: ReturnType<typeof parseEInvoiceXml> | null = null;
    if (doc.sourceKind === 'XML_EINVOICE' && artifact?.content) {
      try {
        invoice = parseEInvoiceXml(artifact.content);
      } catch {
        invoice = null;
      }
    }
    const tenant = await tx.get('tenants', tenantId, tenantId);
    const others = (await tx.list('documents', tenantId)).filter(
      (d) => d.id !== doc.id && d.status !== 'REJECTED',
    );
    const key = documentKey(fields);
    const same = others.find(
      (d) => d.kind === doc.kind && d.fields.documentNo && documentKey(d.fields) === key,
    );
    const dupFile = artifact?.duplicateOf
      ? others.find((d) => d.artifactId === artifact.duplicateOf)
      : undefined;
    const name = normName(fields.supplier);
    const history = others
      .filter(
        (d) =>
          d.status === 'VALIDATED' &&
          d.kind === doc.kind &&
          ((fields.taxCode && d.fields.taxCode === fields.taxCode) ||
            (name && normName(d.fields.supplier) === name)),
      )
      .map((d) => ({
        code: d.code,
        supplier: d.fields.supplier,
        taxCode: d.fields.taxCode,
        total: d.fields.total,
        date: d.fields.documentDate,
      }));
    return assessAuthenticity({
      today: now.slice(0, 10),
      kind: doc.kind,
      sourceKind: doc.sourceKind,
      fields,
      invoice,
      organisationTaxCode: tenant?.taxCode ?? null,
      duplicateFileOf: dupFile?.code ?? (artifact?.duplicateOf ? 'tệp đã tiếp nhận' : null),
      sameDocumentAs: same?.code ?? null,
      history,
      imageMeta: doc.extraction?.imageMeta ?? null,
      qr: doc.extraction?.qr ?? null,
    });
  }

  private computeIssues(
    tx: Tx,
    ws: WorkspaceState,
    doc: DocumentRow,
    fields: DocumentRow['fields'],
    now: string,
  ) {
    return this.knownKeys(tx, ws.tenantId, doc.id).then((keys) =>
      validateFields(
        {
          ...fields,
          lines: doc.kind === 'EXPENSE' && doc.lines.length ? withVat(doc.lines, doc.vat) : undefined,
        },
        { today: now.slice(0, 10), knownDocumentKeys: doc.kind === 'EXPENSE' ? keys : [] },
      ),
    );
  }

  async saveDraft(call: CallContext, p: { documentId: string; fields: DocumentRow['fields'] }) {
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'document.create');
      const doc = await findDoc(tx, ws.tenantId, p.documentId);
      inScope(ws, doc.entityId);
      if (doc.status === 'VALIDATED' || doc.status === 'REJECTED')
        throw new AppError('CONFLICT', 'Chứng từ đã được xác nhận, không thể sửa bản nháp');
      const fields = normalizeFields(p.fields);
      const issues = await this.computeIssues(tx, ws, doc, fields, now);
      const saved = await tx.put('documents', {
        ...doc,
        fields,
        counterparty: fields.supplier || doc.counterparty,
        date: fields.documentDate,
        amount: fields.total,
        issues,
        status: statusFromIssues(issues),
      });
      await em.audit(ws.tenantId, actor(ws), 'document.draft', doc.code);
      return { status: saved.status, issues };
    });
  }

  /** "Người có quyền xác nhận trường dữ liệu" → DocumentVersion + BusinessRecord + RecordEvidence + DocumentValidated. */
  async confirmDocument(
    call: CallContext,
    p: { documentId: string; fields?: DocumentRow['fields']; acknowledgeWarnings?: boolean },
  ) {
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
      // A document with warnings or signs of forgery is only booked after someone confirms having
      // checked it — one acknowledgement covering everything that was shown.
      const auth = await this.authenticity(tx, ws.tenantId, doc, fields, now);
      const failed = auth?.checks.filter((c) => c.status === 'FAIL') ?? [];
      if ((warnings.length || failed.length) && !p.acknowledgeWarnings)
        throw new AppError(
          'VALIDATION',
          failed.length
            ? `Chứng từ có dấu hiệu bất thường: ${failed.map((c) => c.label.toLowerCase()).join(', ')}. Hãy đối chiếu bản gốc rồi xác nhận đã kiểm tra.`
            : warnings[0]!.message,
          { issues, needsAcknowledge: true, authenticity: auth },
        );
      if (failed.length)
        await em.audit(
          ws.tenantId,
          actor(ws),
          'document.authenticity_override',
          doc.code,
          failed
            .map((c) => `${c.code}: ${c.detail}`)
            .join(' | ')
            .slice(0, 900),
        );
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
        fieldLocator: doc.extraction
          ? `${doc.extraction.modelVersion}#bbox`
          : doc.sourceKind === 'XML_EINVOICE'
            ? 'xml:/HDon/DLHDon'
            : 'csv:rows',
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
      const putRecord = async (r: {
        kind: 'EXPENSE' | 'REVENUE' | 'ORDER' | 'BANK_TXN';
        code: string;
        amount: string;
        date: string;
        channel: string;
        counterparty: string;
        reference: string;
        payoutBatch: string;
        description?: string;
        fee: string;
        refund: string;
        discount: string;
        locator: string;
      }) => {
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
        await tx.put('recordEvidence', {
          id: newId('rev'),
          tenantId: ws.tenantId,
          recordId,
          recordVersion: 1,
          documentId: doc.id,
          documentVersion: version,
          fieldLocator: r.locator,
        });
        records.push({ recordId, amount: r.amount });
      };
      if (doc.kind === 'EXPENSE' || doc.kind === 'REVENUE') {
        // Enterprises deduct VAT: the expense / revenue is the amount before VAT and the VAT is
        // input (1331) or output (33311) tax. Household businesses (HKD) do not: the full amount counts.
        const tenant = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
        const vat = tenant.settings.accountingRegime !== 'HKD' && doc.vat ? D(doc.vat) : D(0);
        await putRecord({
          kind: doc.kind,
          code: doc.code,
          amount: D(fields.total).minus(vat).toFixed(),
          date: fields.documentDate,
          channel: doc.kind === 'EXPENSE' ? 'Chi phí' : 'Hóa đơn bán ra',
          counterparty: fields.supplier,
          reference: fields.documentNo,
          payoutBatch: '',
          fee: '0',
          refund: '0',
          discount: '0',
          locator: 'fields.total',
        });
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
      await tx.put('documents', {
        ...doc,
        fields,
        counterparty: fields.supplier || doc.counterparty,
        date: fields.documentDate,
        amount: fields.total,
        issues: [],
        status: 'VALIDATED',
        currentVersion: version,
        validatedBy: ws.user.id,
        validatedAt: now,
      });
      await em.emit({
        type: 'DocumentValidated',
        tenantId: ws.tenantId,
        entityId: doc.entityId,
        aggregateType: 'Document',
        aggregateId: doc.id,
        actorId: ws.user.id,
        dataRef: `document/${doc.id}`,
        dataVersion: version,
        data: { documentId: doc.id, version, periodId, records: records.length },
      });
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
      if (doc.status === 'VALIDATED')
        throw new AppError('CONFLICT', 'Chứng từ đã xác nhận không thể từ chối');
      await tx.put('documents', {
        ...doc,
        status: 'REJECTED',
        issues: [{ field: 'documentNo', severity: 'error', message: reason }],
      });
      await em.audit(ws.tenantId, actor(ws), 'document.reject', doc.code, reason);
      return { ok: true };
    });
  }

  async listBatches(call: CallContext) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'document.read');
      const batches = (await scoped(tx, ws, 'importBatches')).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
      const integrations = await tx.list('integrations', ws.tenantId);
      const latest = batches[0];
      return {
        sources: integrations
          .sort((a, b) => order(a.kind) - order(b.kind))
          .map((i) => ({
            id: i.id,
            kind: i.kind,
            name: i.name,
            description: i.description,
            status: i.status,
          })),
        latest: latest
          ? {
              ...latest,
              entityLabel: await scopeLabel(tx, ws.tenantId, latest.entityId),
              stage: latest.needsReview ? 2 : 4,
            }
          : null,
        batches: batches.slice(0, 50).map((b) => ({
          id: b.id,
          code: b.code,
          fileCount: b.fileCount,
          needsReview: b.needsReview,
          duplicates: b.duplicates,
          status: b.status,
          createdAt: b.createdAt,
        })),
      };
    });
  }
}

const KIND_ORDER = ['POS', 'PLATFORM', 'BANK', 'EINVOICE', 'PAPER', 'EXCEL'];
const order = (k: string) => KIND_ORDER.indexOf(k);

/** Line items of an invoice plus its VAT, so they can be checked against the gross total. */
/**
 * Invoice lines in VND for the books: notes are dropped, discounts stay negative, and for a
 * foreign-currency invoice the rounding remainder goes to the largest line so the lines add up
 * exactly to the converted total before VAT.
 */
function vndLines(inv: ReturnType<typeof parseEInvoiceXml>): { description: string; amount: string }[] {
  const rate = inv.exchangeRate || '1';
  const lines = inv.lines
    .filter((l) => l.kind !== 'NOTE' && (l.kind !== 'PROMOTION' || !D(l.amount).isZero()))
    .map((l) => ({
      description: l.kind === 'DISCOUNT' ? `Chiết khấu thương mại · ${l.description}` : l.description,
      amount: D(l.amount).times(rate).toDecimalPlaces(0).toFixed(),
    }));
  if (!lines.length || !inv.subtotalVnd) return lines;
  const diff = D(inv.subtotalVnd).minus(sum(lines.map((l) => l.amount)));
  if (!diff.isZero() && diff.abs().lte(lines.length)) {
    const i = lines.reduce(
      (best, l, k) => (D(l.amount).abs().gt(D(lines[best]!.amount).abs()) ? k : best),
      0,
    );
    lines[i] = { ...lines[i]!, amount: D(lines[i]!.amount).plus(diff).toFixed() };
  }
  return lines;
}

function withVat(lines: { description: string; amount: string }[], vat: string | undefined) {
  return vat && !D(vat).isZero() ? [...lines, { description: 'Thuế GTGT', amount: vat }] : lines;
}

function extractBatchRef(description: string): string {
  const m = /\b(TT-\d+|S\d{2,}|LOT[-\w]+)\b/i.exec(description);
  return m ? m[1]!.toUpperCase() : '';
}

/** Supplier name without legal-form words, accents or punctuation ("Cty TNHH ABC" = "Công ty ABC"). */
function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\b(cong ty|cty|tnhh|co phan|cp|mtv|dntn|ho kinh doanh|hkd)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function normalizeFields(f: DocumentRow['fields']): DocumentRow['fields'] {
  if (!f || typeof f !== 'object') throw new AppError('VALIDATION', 'Thiếu nội dung chứng từ');
  const total = String(f.total ?? '').replace(/[^\d,.-]/g, '');
  let normalizedTotal = total;
  if (/^\d{1,3}(\.\d{3})+$/.test(total)) normalizedTotal = total.replace(/\./g, '');
  else if (/^\d+,\d+$/.test(total)) normalizedTotal = total.replace(',', '.');
  let date = String(f.documentDate ?? '').trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);
  if (m) date = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return {
    supplier: String(f.supplier ?? '')
      .trim()
      .slice(0, 200),
    documentNo: String(f.documentNo ?? '')
      .trim()
      .slice(0, 60),
    documentDate: date,
    total: normalizedTotal || '0',
    taxCode: f.taxCode ? String(f.taxCode).trim() : undefined,
    series: f.series ? String(f.series).trim().toUpperCase().slice(0, 12) : undefined,
  };
}

export async function findDoc(tx: Tx, tenantId: string, idOrCode: string): Promise<DocumentRow> {
  const byId = await tx.get('documents', tenantId, idOrCode ?? '');
  if (byId) return byId;
  const [byCode] = await tx.list('documents', tenantId, { code: (idOrCode ?? '').toUpperCase() });
  return requireFound(byCode, 'chứng từ');
}

export function inScope(ws: WorkspaceState, entityId: string): void {
  if (ws.entityId !== '*' && ws.entityId !== entityId)
    throw new AppError('NOT_FOUND', 'Không tìm thấy dữ liệu trong phạm vi đang chọn');
  const allowed = ws.membership.bindings.some((b) => b.entityIds === '*' || b.entityIds.includes(entityId));
  if (!allowed) throw new AppError('NOT_FOUND', 'Không tìm thấy dữ liệu trong phạm vi được cấp');
}

/** Rows visible in the current scope (selected site + membership entity scope). */
export async function scoped<
  K extends
    | 'documents'
    | 'records'
    | 'matchGroups'
    | 'approvals'
    | 'importBatches'
    | 'purchaseOrders'
    | 'dailyCloses'
    | 'inventoryItems',
>(tx: Tx, ws: WorkspaceState, col: K) {
  const rows = (await tx.list(col, ws.tenantId)) as unknown as { entityId: string }[];
  const allowAll = ws.membership.bindings.some((b) => b.entityIds === '*');
  const allowed = new Set(ws.membership.bindings.flatMap((b) => (b.entityIds === '*' ? [] : b.entityIds)));
  return rows.filter(
    (r) => (ws.entityId === '*' || r.entityId === ws.entityId) && (allowAll || allowed.has(r.entityId)),
  ) as never as Collections[K][];
}

export async function defaultSite(tx: Tx, tenantId: string): Promise<string> {
  const sites = (await tx.list('entities', tenantId, { kind: 'SITE' })).sort((a, b) =>
    a.code.localeCompare(b.code),
  );
  if (sites[0]) return sites[0].id;
  const [le] = await tx.list('entities', tenantId, { kind: 'LEGAL_ENTITY' });
  return requireFound(le, 'pháp nhân').id;
}
