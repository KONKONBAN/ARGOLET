import {
  anchorBatch, buildEvidenceBatch, formatTimeDate, newId, sha256Hex, verifyEvidence, nextCode, EVIDENCE_SCHEMA_VERSION, shortHash,
  type DocumentVersionPayload, type DomainEvent,
} from '@argolet/core';
import { type AppCore, actor, requireFound } from '../core';
import { AppError, StoredLedger, type CallContext, type Emitter } from '../runtime';
import type { Tx } from '../store';
import type { DocumentRow, DocumentVersionRow, EvidenceBatchRow } from '../types';
import { findDoc, inScope, SOURCE_LABEL } from './documents';

export function documentPayload(tenantId: string, doc: DocumentRow, v: DocumentVersionRow, rawSha256: string | null): DocumentVersionPayload {
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    tenantId,
    documentId: doc.id,
    documentCode: doc.code,
    version: v.version,
    rawSha256,
    fields: v.fields as unknown as Record<string, unknown>,
    confirmedBy: v.confirmedBy,
    confirmedAt: v.confirmedAt,
  };
}

export class EvidenceService {
  constructor(private readonly core: AppCore) {}

  private async newBatchCode(tx: Tx, tenantId: string, now: string): Promise<string> {
    const day = new Date(Date.parse(now) + 7 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, '');
    const codes = (await tx.list('evidenceBatches', tenantId)).map((b) => b.code);
    return nextCode(`EV-${day}`, codes, 3, 1);
  }

  async anchor(tx: Tx, tenantId: string, now: string, items: { targetType: 'CLOSE' | 'DOCUMENT_VERSION'; targetId: string; targetVersion: number; payload: Parameters<typeof buildEvidenceBatch>[1][number]; salt?: string }[]): Promise<EvidenceBatchRow> {
    const code = await this.newBatchCode(tx, tenantId, now);
    const batch = buildEvidenceBatch(code, items.map((i) => i.payload), { salts: items.map((i) => i.salt), batchRefSecret: `${tenantId}:${this.core.deps.config.pepper}` });
    const ledger = new StoredLedger(tx, () => new Date(now));
    const receipt = await anchorBatch(batch, ledger);
    const row = (await tx.put('evidenceBatches', {
      id: newId('evb'),
      tenantId,
      code,
      batchRef: batch.batchRef,
      merkleRoot: batch.merkleRoot,
      schemaVersion: batch.schemaVersion,
      leaves: batch.leaves.map((l, i) => ({ targetType: items[i]!.targetType, targetId: items[i]!.targetId, targetVersion: items[i]!.targetVersion, leafIndex: l.leafIndex, salt: l.salt, manifestDigest: l.manifestDigest, leaf: l.leaf, proof: l.proof })),
      receipt,
    })) as EvidenceBatchRow;
    for (const [i, l] of batch.leaves.entries()) {
      await tx.put('evidenceReceipts', {
        id: `${items[i]!.targetType}:${items[i]!.targetId}@${items[i]!.targetVersion}`,
        tenantId,
        targetType: items[i]!.targetType,
        targetId: items[i]!.targetId,
        targetVersion: items[i]!.targetVersion,
        batchId: row.id,
        batchCode: code,
        merkleRoot: batch.merkleRoot,
        leafIndex: l.leafIndex,
        transactionId: receipt.txId,
        blockNumber: receipt.blockNumber,
        channel: receipt.channel,
        validationCode: receipt.validationCode,
        committedAt: receipt.committedAt,
      });
    }
    return row;
  }

  /** Neo nhiều phiên bản chứng từ trong một lô (batch theo ngày). */
  async anchorDocumentVersions(tx: Tx, tenantId: string, at: string, docs: { doc: DocumentRow; version: DocumentVersionRow }[]): Promise<EvidenceBatchRow> {
    const items = [];
    for (const { doc, version } of docs) {
      const art = doc.artifactId ? await tx.get('artifacts', tenantId, doc.artifactId) : undefined;
      items.push({ targetType: 'DOCUMENT_VERSION' as const, targetId: doc.id, targetVersion: version.version, payload: documentPayload(tenantId, doc, version, art?.rawSha256 ?? null), salt: version.salt });
    }
    return this.anchor(tx, tenantId, at, items);
  }

  /** Consumer: DocumentValidated → neo phiên bản chứng từ (salt của phiên bản được dùng lại). */
  async onDocumentValidated(event: DomainEvent, tx: Tx, em: Emitter): Promise<void> {
    const documentId = String(event.data.documentId);
    const version = Number(event.data.version);
    const doc = await tx.get('documents', event.tenantId, documentId);
    const v = await tx.get('documentVersions', event.tenantId, `${documentId}@${version}`);
    if (!doc || !v) return;
    const art = doc.artifactId ? await tx.get('artifacts', event.tenantId, doc.artifactId) : undefined;
    const payload = documentPayload(event.tenantId, doc, v, art?.rawSha256 ?? null);
    const batch = await this.anchor(tx, event.tenantId, event.occurredAt, [{ targetType: 'DOCUMENT_VERSION', targetId: documentId, targetVersion: version, payload, salt: v.salt }]);
    await em.emit({ type: 'EvidenceAnchored', tenantId: event.tenantId, entityId: doc.entityId, aggregateType: 'Document', aggregateId: documentId, actorId: null, causationId: event.eventId, dataRef: `evidence/${batch.code}`, dataVersion: version, data: { batchCode: batch.code, validationCode: batch.receipt?.validationCode ?? 'UNKNOWN' } });
  }

  /** Consumer: PeriodClosed → manifest + salt → Merkle root → Fabric → EvidenceReceipt. */
  async onPeriodClosed(event: DomainEvent, tx: Tx, em: Emitter): Promise<void> {
    const closeId = String(event.data.closeId);
    const snap = await tx.get('closeSnapshots', event.tenantId, closeId);
    if (!snap || snap.evidenceStatus === 'ANCHORED') return;
    const batch = await this.anchor(tx, event.tenantId, event.occurredAt, [{ targetType: 'CLOSE', targetId: closeId, targetVersion: snap.version, payload: snap.manifest }]);
    const ok = batch.receipt?.validationCode === 'VALID';
    await tx.put('closeSnapshots', { ...snap, evidenceStatus: ok ? 'ANCHORED' : 'FAILED' });
    await em.emit({ type: 'EvidenceAnchored', tenantId: event.tenantId, entityId: snap.entityId, aggregateType: 'CloseSnapshot', aggregateId: closeId, actorId: null, causationId: event.eventId, dataRef: `evidence/${batch.code}`, dataVersion: snap.version, data: { batchCode: batch.code, validationCode: batch.receipt?.validationCode ?? 'UNKNOWN' } });
  }

  /** Màn 18 · Bằng chứng & lịch sử của một hồ sơ. */
  async documentEvidence(call: CallContext, p: { documentId: string }) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'evidence.read');
      const doc = await findDoc(tx, ws.tenantId, p.documentId);
      inScope(ws, doc.entityId);
      const versions = (await tx.list('documentVersions', ws.tenantId, { documentId: doc.id })).sort((a, b) => a.version - b.version);
      const current = versions[versions.length - 1];
      const receipt = current ? await tx.get('evidenceReceipts', ws.tenantId, `DOCUMENT_VERSION:${doc.id}@${current.version}`) : undefined;
      const lastCheck = (await tx.list('verifications', ws.tenantId, { targetId: doc.id })).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const prev = versions[versions.length - 2];
      const memberships = new Map((await tx.list('memberships', ws.tenantId)).map((m) => [m.userId, m]));
      const confirmer = current ? memberships.get(current.confirmedBy) : undefined;
      const history = [
        { title: 'Tiếp nhận bản gốc', by: memberships.get(doc.receivedBy)?.displayName ?? 'Hệ thống', at: doc.receivedAt },
        ...versions.map((v) => ({ title: v.version === 1 ? 'Xác nhận phiên bản 01' : v.note.startsWith('Bổ sung') ? v.note : `Xác nhận phiên bản ${String(v.version).padStart(2, '0')}`, by: v.confirmedByName, at: v.confirmedAt })),
      ];
      return {
        document: { id: doc.id, code: doc.code, title: doc.title, status: doc.status },
        integrity: receipt ? (lastCheck ? (lastCheck.ok ? 'VERIFIED' : 'FAILED') : 'ANCHORED') : current ? 'PENDING' : 'NONE',
        integrityLabel: receipt ? (lastCheck ? (lastCheck.ok ? 'Toàn vẹn đã xác minh' : 'Phát hiện sai khác') : 'Đã neo bằng chứng') : current ? 'Chờ neo bằng chứng' : 'Chưa có phiên bản xác nhận',
        version: current ? { number: current.version, label: `Phiên bản ${String(current.version).padStart(2, '0')}`, confirmedAt: current.confirmedAt, confirmedAtLabel: `Xác nhận lúc ${formatTimeDate(current.confirmedAt)}`, fingerprint: current.fingerprint, fingerprintShort: shortHash(current.fingerprint) } : null,
        rows: current
          ? [
              { label: 'Nguồn dữ liệu', value: doc.sourceKind === 'XML_EINVOICE' ? 'Hóa đơn điện tử XML' : SOURCE_LABEL[doc.sourceKind] },
              { label: 'Mã lô bằng chứng', value: receipt?.batchCode ?? 'Đang tạo' },
              { label: 'Người xác nhận', value: `${current.confirmedByName}${confirmer ? ' · ' + confirmer.title : ''}` },
              { label: 'Dấu vân tay dữ liệu', value: shortHash(current.fingerprint) },
              { label: 'Phiên bản trước', value: prev ? `${String(prev.version).padStart(2, '0')} · ${formatTimeDate(prev.confirmedAt).split(' · ').reverse().join(', ')}` : 'Không có' },
            ]
          : [],
        receipt: receipt ? { batchCode: receipt.batchCode, merkleRoot: receipt.merkleRoot, transactionId: receipt.transactionId, blockNumber: receipt.blockNumber, channel: receipt.channel, validationCode: receipt.validationCode, committedAt: receipt.committedAt } : null,
        history,
        roleNote: `Quyền hiện tại: ${ws.membership.title.toLowerCase()}. Mỗi quyết định được ghi lại cùng người thực hiện, thời gian và phạm vi.`,
      };
    });
  }

  /**
   * Màn 40 · Kiểm tra toàn vẹn: đối chiếu bản gốc ngoài chuỗi với dấu vân tay của phiên bản,
   * tính lại commitment + Merkle proof và so sánh với root đã commit trên sổ cái.
   */
  async verifyDocument(call: CallContext, p: { documentId: string; fileBase64?: string; fileText?: string }) {
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'evidence.verify');
      const doc = await findDoc(tx, ws.tenantId, p.documentId);
      inScope(ws, doc.entityId);
      const v = (await tx.list('documentVersions', ws.tenantId, { documentId: doc.id })).sort((a, b) => b.version - a.version)[0];
      if (!v) throw new AppError('VALIDATION', 'Hồ sơ chưa có phiên bản được xác nhận');
      const receipt = requireFound(await tx.get('evidenceReceipts', ws.tenantId, `DOCUMENT_VERSION:${doc.id}@${v.version}`), 'biên nhận bằng chứng');
      const batch = requireFound(await tx.get('evidenceBatches', ws.tenantId, receipt.batchId), 'lô bằng chứng');
      const leaf = batch.leaves.find((l) => l.targetId === doc.id && l.targetVersion === v.version)!;
      const art = doc.artifactId ? await tx.get('artifacts', ws.tenantId, doc.artifactId) : undefined;
      const steps: { code: string; label: string; ok: boolean; detail: string }[] = [];
      let fileOk = true;
      if (p.fileBase64 !== undefined || p.fileText !== undefined) {
        let bytes: Uint8Array;
        if (p.fileText !== undefined) bytes = new TextEncoder().encode(p.fileText);
        else {
          const bin = atob(p.fileBase64!.replace(/^data:[^,]*,/, ''));
          bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        }
        const sha = sha256Hex(bytes);
        fileOk = !!art && sha === art.rawSha256;
        steps.push({ code: 'B1', label: 'Bản gốc ngoài chuỗi', ok: fileOk, detail: fileOk ? 'SHA-256 tệp trùng với bản gốc đã lưu' : 'Tệp tải lên khác bản gốc đã tiếp nhận' });
      } else {
        steps.push({ code: 'B1', label: 'Bản gốc ngoài chuỗi', ok: !!art, detail: art ? `Dùng bản gốc lưu trữ · ${art.filename}` : 'Không có tệp gốc' });
      }
      const payload = documentPayload(ws.tenantId, doc, v, art?.rawSha256 ?? null);
      const ledger = new StoredLedger(tx, this.core.deps.clock);
      const result = await verifyEvidence({ manifest: payload, salt: leaf.salt, proof: leaf.proof, batchRef: batch.batchRef, txId: receipt.transactionId }, ledger);
      const ok = fileOk && result.ok;
      const allSteps = [...steps, ...result.steps];
      await tx.put('verifications', { id: newId('ver'), tenantId: ws.tenantId, targetType: 'DOCUMENT_VERSION', targetId: doc.id, ok, steps: result.steps, requestedBy: ws.user.id });
      await em.audit(ws.tenantId, actor(ws), 'evidence.verify', doc.code, ok ? 'OK' : 'FAILED');
      return {
        ok,
        steps: allSteps,
        computedRoot: result.computedRoot,
        committedRoot: result.committedRoot,
        statement: result.statement,
        chainValid: await ledger.verifyChain(),
      };
    });
  }

  /** GET /v1/snapshots/{id} — bộ chốt đã duyệt (theo quyền đọc). */
  async snapshot(call: CallContext, p: { closeId: string }) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'period.read');
      const s = requireFound(await tx.get('closeSnapshots', ws.tenantId, p.closeId), 'bộ chốt');
      inScope(ws, s.entityId);
      const receipt = await tx.get('evidenceReceipts', ws.tenantId, `CLOSE:${s.id}@${s.version}`);
      return {
        closeId: s.id,
        entityId: s.entityId,
        periodId: s.periodId,
        version: s.version,
        previousCloseId: s.previousCloseId,
        rulesVersion: s.rulesVersion,
        manifestDigest: s.manifestDigest,
        totals: s.manifest.totals,
        members: s.manifest.members.length,
        approvals: s.manifest.approvals,
        closedAt: s.closedAt,
        evidenceStatus: s.evidenceStatus,
        receipt: receipt ? { batchCode: receipt.batchCode, merkleRoot: receipt.merkleRoot, transactionId: receipt.transactionId, blockNumber: receipt.blockNumber, validationCode: receipt.validationCode } : null,
      };
    });
  }

  async listSnapshots(call: CallContext) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'period.read');
      return (await tx.list('closeSnapshots', ws.tenantId))
        .filter((s) => ws.entityId === '*' || s.entityId === ws.entityId)
        .sort((a, b) => b.closedAt.localeCompare(a.closedAt))
        .map((s) => ({ closeId: s.id, entityId: s.entityId, periodId: s.periodId, version: s.version, closedAt: s.closedAt, evidenceStatus: s.evidenceStatus }));
    });
  }

  /** GET /v1/evidence/{close_id}/verify — B1–B7 trên bộ chốt. */
  async verifyClose(call: CallContext, p: { closeId: string }) {
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'evidence.verify');
      const s = requireFound(await tx.get('closeSnapshots', ws.tenantId, p.closeId), 'bộ chốt');
      inScope(ws, s.entityId);
      const receipt = requireFound(await tx.get('evidenceReceipts', ws.tenantId, `CLOSE:${s.id}@${s.version}`), 'biên nhận bằng chứng');
      const batch = requireFound(await tx.get('evidenceBatches', ws.tenantId, receipt.batchId), 'lô bằng chứng');
      const leaf = batch.leaves.find((l) => l.targetId === s.id && l.targetVersion === s.version)!;
      const ledger = new StoredLedger(tx, this.core.deps.clock);
      const result = await verifyEvidence({ manifest: s.manifest, salt: leaf.salt, proof: leaf.proof, batchRef: batch.batchRef, txId: receipt.transactionId }, ledger);
      await tx.put('verifications', { id: newId('ver'), tenantId: ws.tenantId, targetType: 'CLOSE', targetId: s.id, ok: result.ok, steps: result.steps, requestedBy: ws.user.id });
      await em.audit(ws.tenantId, actor(ws), 'evidence.verify_close', s.id, result.ok ? 'OK' : 'FAILED');
      return { ...result, chainValid: await ledger.verifyChain() };
    });
  }

  async integrityInfo(call: CallContext, p: { documentId: string }) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'evidence.read');
      const doc = await findDoc(tx, ws.tenantId, p.documentId);
      inScope(ws, doc.entityId);
      const v = (await tx.list('documentVersions', ws.tenantId, { documentId: doc.id })).sort((a, b) => b.version - a.version)[0];
      const receipt = v ? await tx.get('evidenceReceipts', ws.tenantId, `DOCUMENT_VERSION:${doc.id}@${v.version}`) : undefined;
      const art = doc.artifactId ? await tx.get('artifacts', ws.tenantId, doc.artifactId) : undefined;
      const last = (await tx.list('verifications', ws.tenantId, { targetId: doc.id })).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return {
        title: `Hồ sơ ${doc.code} · Phiên bản ${String(v?.version ?? 0).padStart(2, '0')}`,
        subtitle: `Bản gốc lưu ngoài chuỗi · ${receipt?.batchCode ?? 'chưa neo'}`,
        status: last ? (last.ok ? 'VERIFIED' : 'FAILED') : 'PENDING',
        statusLabel: last ? (last.ok ? 'Toàn vẹn đã xác minh' : 'Phát hiện sai khác') : 'Chờ đối chiếu tệp gốc',
        rows: [
          { label: 'Định dạng bản gốc', value: doc.sourceKind === 'XML_EINVOICE' ? 'XML · Hóa đơn điện tử' : SOURCE_LABEL[doc.sourceKind] },
          { label: 'Cách tạo dấu vân tay', value: 'SHA-256 có muối theo phiên bản' },
          { label: 'Dấu vân tay bản ghi', value: v ? shortHash(v.fingerprint) : '—' },
          { label: 'Gốc Merkle của lô', value: receipt ? shortHash(receipt.merkleRoot) : '—' },
          { label: 'Mạng có cấp quyền', value: receipt ? `Hyperledger Fabric · khối #${receipt.blockNumber} · ${receipt.validationCode}` : 'Chưa kết nối' },
        ],
        hasOriginal: !!art?.content,
        originalFilename: art?.filename ?? null,
        originalContent: art?.content ?? null,
      };
    });
  }
}
