import { describe, expect, it } from 'vitest';
import {
  anchorBatch,
  buildEvidenceBatch,
  buildMerkleTree,
  buildSnapshotManifest,
  leafHash,
  merkleProof,
  rootFromProof,
  SimulatedFabricLedger,
  verifyEvidence,
  verifyMerkleProof,
  canonicalize,
  sha256Hex,
} from '../src';

describe('merkle tree with domain separation', () => {
  it('proofs verify for every leaf, including odd counts', () => {
    for (const n of [1, 2, 3, 5, 8, 13]) {
      const leaves = Array.from({ length: n }, (_, i) => leafHash(`leaf-${i}`));
      const tree = buildMerkleTree(leaves);
      leaves.forEach((l, i) => expect(verifyMerkleProof(l, merkleProof(tree, i), tree.root)).toBe(true));
    }
  });

  it('distinguishes leaves from internal nodes', () => {
    const a = leafHash('a');
    const b = leafHash('b');
    const tree = buildMerkleTree([a, b]);
    expect(tree.root).not.toBe(leafHash(a + b));
    expect(rootFromProof(leafHash('x'), merkleProof(tree, 0))).not.toBe(tree.root);
    expect(() => buildMerkleTree([])).toThrow();
    expect(() => merkleProof(tree, 5)).toThrow();
  });

  it('matches the SHA-256 test vector for the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('evidence anchoring and verification (board 06 A1–A9, B1–B7)', () => {
  const manifest = buildSnapshotManifest({
    tenantId: 'ten_1',
    closeId: 'close_2026_10',
    entityId: 'ent_q3',
    periodId: '2026-10',
    closeVersion: 1,
    previousCloseId: null,
    rulesVersion: 'recon-rules-2026.10',
    members: [
      {
        recordId: 'r1',
        recordVersion: 1,
        kind: 'REVENUE',
        amount: '428600000',
        artifactId: 'art1',
        rawSha256: 'aa',
      },
      { recordId: 'r2', recordVersion: 2, kind: 'EXPENSE', amount: '344000000' },
    ],
    approvals: [{ approvalId: 'apv1', digest: 'd', actorId: 'u1' }],
  });

  it('totals are carried in the manifest', () => {
    expect(manifest.totals).toEqual({ revenue: '428600000', expense: '344000000', net: '84600000' });
  });

  it('anchors a batch and verifies integrity end to end', async () => {
    const ledger = new SimulatedFabricLedger();
    const batch = buildEvidenceBatch('EV-20261031-003', [manifest]);
    const receipt = await anchorBatch(batch, ledger);
    expect(receipt.validationCode).toBe('VALID');
    expect(receipt.endorsements).toHaveLength(3);
    expect(ledger.verifyChain()).toBe(true);
    const leaf = batch.leaves[0]!;
    const res = await verifyEvidence(
      { manifest, salt: leaf.salt, proof: leaf.proof, batchRef: batch.batchRef, txId: receipt.txId },
      ledger,
    );
    expect(res.ok).toBe(true);
    expect(res.computedRoot).toBe(batch.merkleRoot);
    expect(res.steps.map((s) => s.code)).toEqual(['B3', 'B4', 'B5', 'B6', 'B7']);
  });

  it('detects tampering with the snapshot, salt or a missing anchor', async () => {
    const ledger = new SimulatedFabricLedger();
    const batch = buildEvidenceBatch('EV-2', [manifest, { ...manifest, closeId: 'other' }]);
    await anchorBatch(batch, ledger);
    const leaf = batch.leaves[0]!;
    const tampered = { ...manifest, totals: { ...manifest.totals, revenue: '1' } };
    expect(
      (
        await verifyEvidence(
          { manifest: tampered, salt: leaf.salt, proof: leaf.proof, batchRef: batch.batchRef },
          ledger,
        )
      ).ok,
    ).toBe(false);
    expect(
      (await verifyEvidence({ manifest, salt: '00', proof: leaf.proof, batchRef: batch.batchRef }, ledger))
        .ok,
    ).toBe(false);
    expect(
      (await verifyEvidence({ manifest, salt: leaf.salt, proof: leaf.proof, batchRef: 'missing' }, ledger))
        .ok,
    ).toBe(false);
  });

  it('fails endorsement policy when a majority of organisations is missing', async () => {
    const ledger = new SimulatedFabricLedger(undefined, 4);
    const batch = buildEvidenceBatch('EV-3', [manifest]);
    const r = await anchorBatch(batch, ledger);
    expect(r.validationCode).toBe('ENDORSEMENT_POLICY_FAILURE');
    expect(await ledger.readRoot(batch.batchRef)).toBeUndefined();
  });

  it('rejects re-anchoring a different root under the same batch (MVCC)', async () => {
    const ledger = new SimulatedFabricLedger();
    const b1 = buildEvidenceBatch('EV-4', [manifest], { salts: ['01'] });
    const b2 = buildEvidenceBatch('EV-4', [manifest], { salts: ['02'] });
    expect((await anchorBatch(b1, ledger)).validationCode).toBe('VALID');
    expect((await anchorBatch(b2, ledger)).validationCode).toBe('MVCC_READ_CONFLICT');
  });

  it('detects a tampered block chain', () => {
    const ledger = new SimulatedFabricLedger();
    return anchorBatch(buildEvidenceBatch('EV-5', [manifest]), ledger).then(() => {
      const snap = ledger.snapshot();
      snap.blocks[0]!.dataHash = 'f'.repeat(64);
      expect(new SimulatedFabricLedger(undefined, undefined, snap).verifyChain()).toBe(false);
    });
  });
});

describe('canonical JSON', () => {
  it('is independent of key order and drops undefined', () => {
    expect(canonicalize({ b: 1, a: [true, null, 'x'], c: undefined })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(canonicalize({ a: 1, b: { d: 2, c: 3 } })).toBe(canonicalize({ b: { c: 3, d: 2 }, a: 1 }));
    expect(() => canonicalize({ x: NaN })).toThrow();
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => canonicalize(loop)).toThrow();
  });
});
