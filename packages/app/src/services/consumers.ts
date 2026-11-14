import { EVIDENCE_SCHEMA_VERSION, randomHex, saltedFingerprint, type DomainEvent } from '@argolet/core';
import type { Emitter } from '../runtime';
import type { Tx } from '../store';
import { GLOBAL } from '../types';
import { PARSER_VERSION } from './documents';

/**
 * MatchResolved → platform reports waiting for reconciliation ("Cần đối soát") become
 * VALIDATED once every one of their records belongs to a confirmed match group.
 */
export async function onMatchResolvedValidateDocuments(
  event: DomainEvent,
  tx: Tx,
  em: Emitter,
): Promise<void> {
  if (event.tenantId === GLOBAL) return;
  const group = await tx.get('matchGroups', event.tenantId, event.aggregateId);
  if (!group) return;
  const docIds = new Set<string>();
  for (const rid of [...group.orderIds, ...group.txnIds]) {
    const r = await tx.get('records', event.tenantId, rid);
    if (r?.documentId) docIds.add(r.documentId);
  }
  for (const docId of docIds) {
    const doc = await tx.get('documents', event.tenantId, docId);
    if (!doc || doc.status !== 'NEEDS_RECON') continue;
    const recs = await tx.list('records', event.tenantId, { documentId: docId });
    let allConfirmed = true;
    for (const r of recs) {
      const g = r.matchGroupId ? await tx.get('matchGroups', event.tenantId, r.matchGroupId) : undefined;
      if (!g || g.status !== 'CONFIRMED') allConfirmed = false;
    }
    if (!allConfirmed) continue;
    const version = doc.currentVersion + 1;
    const salt = randomHex(16);
    const actorId = event.actorId ?? 'system';
    const member = event.actorId
      ? (await tx.list('memberships', event.tenantId, { userId: event.actorId }))[0]
      : undefined;
    const payload = {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      tenantId: event.tenantId,
      documentId: doc.id,
      documentCode: doc.code,
      version,
      rawSha256: null,
      fields: doc.fields as unknown as Record<string, unknown>,
      confirmedBy: actorId,
      confirmedAt: event.occurredAt,
    };
    await tx.put('documentVersions', {
      id: `${doc.id}@${version}`,
      tenantId: event.tenantId,
      documentId: doc.id,
      version,
      artifactId: doc.artifactId,
      parserVersion: PARSER_VERSION,
      fields: doc.fields,
      fieldLocator: 'csv:rows',
      confirmedBy: actorId,
      confirmedByName: member?.displayName ?? 'Hệ thống',
      confirmedAt: event.occurredAt,
      note: `Đối soát hoàn tất, ${group.code}`,
      fingerprint: saltedFingerprint(payload, salt),
      salt,
    });
    await tx.put('documents', {
      ...doc,
      status: 'VALIDATED',
      currentVersion: version,
      validatedBy: actorId,
      validatedAt: event.occurredAt,
      issues: [],
    });
    await em.emit({
      type: 'DocumentValidated',
      tenantId: event.tenantId,
      entityId: doc.entityId,
      aggregateType: 'Document',
      aggregateId: doc.id,
      actorId: event.actorId,
      causationId: event.eventId,
      dataRef: `document/${doc.id}`,
      dataVersion: version,
      data: { documentId: doc.id, version, periodId: doc.date.slice(0, 7), records: recs.length },
    });
  }
}
