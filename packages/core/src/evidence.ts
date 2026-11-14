import { canonicalize } from './canonical';
import { bytesToHex, concatBytes, hexToBytes, randomBytes, sha256Hex, utf8ToBytes } from './hash';
import { buildMerkleTree, leafHash, merkleProof, rootFromProof, type ProofStep } from './merkle';
import type { LedgerGateway, LedgerReceipt } from './ledger';

export const EVIDENCE_SCHEMA_VERSION = 'argolet.evidence.v1';

/** Manifest of an approved close snapshot (board 06 · A1). */
export interface SnapshotManifest {
  schemaVersion: string;
  tenantId: string;
  closeId: string;
  entityId: string;
  periodId: string;
  closeVersion: number;
  previousCloseId: string | null;
  rulesVersion: string;
  members: { recordId: string; recordVersion: number; digest: string }[];
  sources: { artifactId: string; rawSha256: string }[];
  approvals: { approvalId: string; digest: string; actorId: string }[];
  totals: Record<string, string>;
}

export interface EvidenceLeaf {
  closeId: string;
  leafIndex: number;
  /** Random per-record salt (hex). Stored off-chain only. */
  salt: string;
  manifestDigest: string;
  leaf: string;
  proof: ProofStep[];
}

export interface EvidenceBatch {
  batchId: string;
  /** Opaque reference sent to the ledger (does not reveal tenant/close ids). */
  batchRef: string;
  merkleRoot: string;
  schemaVersion: string;
  leaves: EvidenceLeaf[];
}

/** Any payload committed to the ledger must declare the evidence schema version. */
export interface EvidencePayload {
  schemaVersion: string;
  [key: string]: unknown;
}

/** Document version commitment (board 05 "Lưu phiên bản" → bằng chứng hồ sơ). */
export interface DocumentVersionPayload extends EvidencePayload {
  tenantId: string;
  documentId: string;
  documentCode: string;
  version: number;
  rawSha256: string | null;
  fields: Record<string, unknown>;
  confirmedBy: string;
  confirmedAt: string;
}

/** A2: canonicalize + salt → commitment bytes. */
export function commitmentBytes(payload: EvidencePayload | SnapshotManifest, saltHex: string): Uint8Array {
  return concatBytes(hexToBytes(saltHex), utf8ToBytes(canonicalize(payload)));
}

export function manifestDigest(payload: EvidencePayload | SnapshotManifest): string {
  return sha256Hex(canonicalize(payload));
}

/** Salted fingerprint of a payload ("SHA-256 có muối theo phiên bản"). */
export function saltedFingerprint(payload: EvidencePayload | SnapshotManifest, saltHex: string): string {
  return sha256Hex(commitmentBytes(payload, saltHex));
}

/** A2–A3: build a Merkle batch over one or more manifests / payloads. */
export function buildEvidenceBatch(
  batchId: string,
  manifests: (SnapshotManifest | EvidencePayload)[],
  opts: { salts?: (string | undefined)[]; batchRefSecret?: string } = {},
): EvidenceBatch {
  if (manifests.length === 0) throw new Error('Lô bằng chứng cần ít nhất một bộ chốt');
  const salts = manifests.map((_, i) => opts.salts?.[i] || bytesToHex(randomBytes(16)));
  const leaves = manifests.map((m, i) => leafHash(commitmentBytes(m, salts[i]!)));
  const tree = buildMerkleTree(leaves);
  const batchRef = sha256Hex(`${opts.batchRefSecret ?? 'argolet-batch'}:${batchId}`).slice(0, 32);
  return {
    batchId,
    batchRef,
    merkleRoot: tree.root,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    leaves: manifests.map((m, i) => ({
      closeId: String(
        (m as { closeId?: unknown; documentId?: unknown }).closeId ??
          (m as { documentId?: unknown }).documentId ??
          i,
      ),
      leafIndex: i,
      salt: salts[i]!,
      manifestDigest: manifestDigest(m),
      leaf: leaves[i]!,
      proof: merkleProof(tree, i),
    })),
  };
}

/** A4–A8: anchor the batch root on the permissioned ledger. */
export async function anchorBatch(
  batch: EvidenceBatch,
  ledger: LedgerGateway,
  submitterMsp = 'ArgoletMSP',
): Promise<LedgerReceipt> {
  const receipt = await ledger.submit({
    batchRef: batch.batchRef,
    merkleRoot: batch.merkleRoot,
    schemaVersion: batch.schemaVersion,
    submitterMsp,
  });
  return receipt;
}

export interface VerificationStep {
  code: 'B3' | 'B4' | 'B5' | 'B6' | 'B7';
  label: string;
  ok: boolean;
  detail: string;
}

export interface VerificationResult {
  ok: boolean;
  computedLeaf: string;
  computedRoot: string;
  committedRoot: string | null;
  txId: string | null;
  steps: VerificationStep[];
  statement: string;
}

/**
 * B3–B7: recompute the commitment from the snapshot + salt + proof and compare with
 * the root committed on the ledger. Proves integrity — not correctness of the input data.
 */
export async function verifyEvidence(
  input: {
    manifest: SnapshotManifest | EvidencePayload;
    salt: string;
    proof: ProofStep[];
    batchRef: string;
    txId?: string | undefined;
  },
  ledger: LedgerGateway,
): Promise<VerificationResult> {
  const steps: VerificationStep[] = [];
  steps.push({
    code: 'B3',
    label: 'Gói dữ liệu xác minh',
    ok: input.manifest.schemaVersion === EVIDENCE_SCHEMA_VERSION && input.salt.length > 0,
    detail: describePayload(input.manifest),
  });
  const committed = await ledger.readRoot(input.batchRef);
  const tx = input.txId ? await ledger.getTransaction(input.txId) : undefined;
  const committedRoot = committed?.merkleRoot ?? null;
  const txValid = tx
    ? tx.validationCode === 'VALID' && tx.merkleRoot === committedRoot
    : committed !== undefined;
  steps.push({
    code: 'B4',
    label: 'Đọc root đã ghi nhận',
    ok: committedRoot !== null && txValid,
    detail: committedRoot
      ? `tx ${committed!.txId.slice(0, 16)}, ${tx?.validationCode ?? 'VALID'}`
      : 'Không tìm thấy root trên sổ cái',
  });
  const computedLeaf = leafHash(commitmentBytes(input.manifest, input.salt));
  steps.push({
    code: 'B5',
    label: 'Tính lại commitment',
    ok: true,
    detail: `leaf ${computedLeaf.slice(0, 16)}`,
  });
  const computedRoot = rootFromProof(computedLeaf, input.proof);
  const match = committedRoot !== null && computedRoot === committedRoot;
  steps.push({
    code: 'B6',
    label: 'So sánh giá trị root',
    ok: match,
    detail: match ? 'Root tính lại trùng với root đã commit' : 'Root tính lại KHÔNG trùng với root đã commit',
  });
  const ok = steps.every((s) => s.ok);
  steps.push({
    code: 'B7',
    label: 'Kết quả xác minh toàn vẹn',
    ok,
    detail: ok ? 'Toàn vẹn đã xác minh' : 'Phát hiện sai khác hoặc thiếu bằng chứng',
  });
  return {
    ok,
    computedLeaf,
    computedRoot,
    committedRoot,
    txId: committed?.txId ?? null,
    steps,
    statement: 'Xác minh toàn vẹn dữ liệu không thay thế việc kiểm tra tính đúng đắn của đầu vào.',
  };
}

function describePayload(p: SnapshotManifest | EvidencePayload): string {
  const r = p as Record<string, unknown>;
  if (typeof r.closeId === 'string')
    return `Snapshot ${r.closeId} v${String(r.closeVersion)}, schema ${p.schemaVersion}`;
  if (typeof r.documentCode === 'string')
    return `Hồ sơ ${r.documentCode} v${String(r.version)}, schema ${p.schemaVersion}`;
  return `schema ${p.schemaVersion}`;
}
