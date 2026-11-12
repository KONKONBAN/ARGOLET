import { sha256, bytesToHex, hexToBytes, concatBytes } from './hash';

/**
 * Merkle tree with domain separation (board 06 · A3: "SHA-256 có phân miền leaf / node").
 * leaf = SHA256(0x00 || data), node = SHA256(0x01 || left || right).
 * An odd node at the end of a level is promoted unchanged (no duplication),
 * which avoids the classic duplicate-leaf ambiguity.
 */
const LEAF_PREFIX = Uint8Array.of(0x00);
const NODE_PREFIX = Uint8Array.of(0x01);

export interface ProofStep {
  /** Position of the sibling relative to the running hash. */
  position: 'L' | 'R';
  hash: string;
}

export function leafHash(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return bytesToHex(sha256(concatBytes(LEAF_PREFIX, bytes)));
}

export function nodeHash(leftHex: string, rightHex: string): string {
  return bytesToHex(sha256(concatBytes(NODE_PREFIX, hexToBytes(leftHex), hexToBytes(rightHex))));
}

export interface MerkleTree {
  root: string;
  levels: string[][];
  leafCount: number;
}

/** Build from already-hashed leaves (hex, produced by `leafHash`). */
export function buildMerkleTree(leafHashes: string[]): MerkleTree {
  if (leafHashes.length === 0) throw new Error('Cây Merkle cần ít nhất một lá');
  const levels: string[][] = [leafHashes.slice()];
  while (levels[levels.length - 1]!.length > 1) {
    const prev = levels[levels.length - 1]!;
    const next: string[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      if (i + 1 < prev.length) next.push(nodeHash(prev[i]!, prev[i + 1]!));
      else next.push(prev[i]!);
    }
    levels.push(next);
  }
  return { root: levels[levels.length - 1]![0]!, levels, leafCount: leafHashes.length };
}

export function merkleProof(tree: MerkleTree, leafIndex: number): ProofStep[] {
  if (leafIndex < 0 || leafIndex >= tree.leafCount) throw new RangeError('leaf_index ngoài phạm vi');
  const proof: ProofStep[] = [];
  let index = leafIndex;
  for (let level = 0; level < tree.levels.length - 1; level++) {
    const nodes = tree.levels[level]!;
    const isRight = index % 2 === 1;
    const siblingIndex = isRight ? index - 1 : index + 1;
    if (siblingIndex < nodes.length) {
      proof.push({ position: isRight ? 'L' : 'R', hash: nodes[siblingIndex]! });
    }
    index = Math.floor(index / 2);
  }
  return proof;
}

export function rootFromProof(leaf: string, proof: ProofStep[]): string {
  let acc = leaf;
  for (const step of proof) acc = step.position === 'L' ? nodeHash(step.hash, acc) : nodeHash(acc, step.hash);
  return acc;
}

export function verifyMerkleProof(leaf: string, proof: ProofStep[], root: string): boolean {
  return rootFromProof(leaf, proof) === root;
}
