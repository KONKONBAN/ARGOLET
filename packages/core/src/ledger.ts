import { canonicalize } from './canonical';
import { hmacSha256Hex, sha256Hex } from './hash';

/**
 * Permissioned ledger gateway (board 06 · A4–A8, 11).
 * `SimulatedFabricLedger` reproduces Hyperledger Fabric's execute → order → validate
 * pipeline: peers of each organisation simulate and endorse, an ordering service cuts
 * hash-chained blocks, and the validator checks the endorsement policy before marking
 * the transaction VALID. Only VALID transactions update world state.
 * A production deployment swaps this for a Fabric Gateway client with the same interface.
 */
export type ValidationCode = 'VALID' | 'ENDORSEMENT_POLICY_FAILURE' | 'MVCC_READ_CONFLICT' | 'DUPLICATE_TXID';

export interface AnchorRequest {
  /** Opaque batch id — never the business identifier. */
  batchRef: string;
  merkleRoot: string;
  schemaVersion: string;
  /** MSP identity of the submitting organisation. */
  submitterMsp: string;
}

export interface Endorsement {
  mspId: string;
  peer: string;
  signature: string;
}

export interface LedgerReceipt {
  txId: string;
  channel: string;
  chaincode: string;
  blockNumber: number;
  blockHash: string;
  validationCode: ValidationCode;
  endorsements: Endorsement[];
  merkleRoot: string;
  batchRef: string;
  committedAt: string;
}

export interface LedgerBlock {
  number: number;
  previousHash: string;
  dataHash: string;
  hash: string;
  txIds: string[];
  createdAt: string;
}

export interface LedgerState {
  blocks: LedgerBlock[];
  transactions: Record<string, LedgerReceipt>;
  worldState: Record<string, { merkleRoot: string; txId: string; schemaVersion: string; version: number }>;
}

export interface LedgerGateway {
  readonly networkName: string;
  submit(req: AnchorRequest): Promise<LedgerReceipt>;
  getTransaction(txId: string): Promise<LedgerReceipt | undefined>;
  readRoot(batchRef: string): Promise<{ merkleRoot: string; txId: string } | undefined>;
}

export interface FabricOrg {
  mspId: string;
  peers: string[];
  /** Signing secret of the organisation's peers (HSM in production). */
  secret: string;
}

export const DEFAULT_FABRIC_ORGS: FabricOrg[] = [
  { mspId: 'ArgoletMSP', peers: ['peer0.argolet'], secret: 'argolet-peer-signing-key' },
  { mspId: 'AuditorMSP', peers: ['peer0.auditor'], secret: 'auditor-peer-signing-key' },
  { mspId: 'BankMSP', peers: ['peer0.bank'], secret: 'bank-peer-signing-key' },
];

export class SimulatedFabricLedger implements LedgerGateway {
  readonly networkName = 'Hyperledger Fabric (mô phỏng có cấp quyền)';
  readonly channel = 'argolet-evidence';
  readonly chaincode = 'evidence_cc';
  private state: LedgerState;

  constructor(
    private readonly orgs: FabricOrg[] = DEFAULT_FABRIC_ORGS,
    /** Endorsement policy: number of distinct organisations required. */
    private readonly policyThreshold = Math.floor(orgs.length / 2) + 1,
    initial?: LedgerState,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.state = initial ?? { blocks: [], transactions: {}, worldState: {} };
  }

  snapshot(): LedgerState {
    return JSON.parse(JSON.stringify(this.state)) as LedgerState;
  }

  async submit(req: AnchorRequest): Promise<LedgerReceipt> {
    const now = this.clock().toISOString();
    const proposal = canonicalize({ fn: 'AnchorRoot', args: [req.batchRef, req.merkleRoot, req.schemaVersion], creator: req.submitterMsp, ts: now });
    const txId = sha256Hex(proposal + ':' + Object.keys(this.state.transactions).length);
    // 1. Execute / endorse: each peer simulates the chaincode and signs the read-write set.
    const existing = this.state.worldState[req.batchRef];
    const rwSet = canonicalize({ key: req.batchRef, readVersion: existing?.version ?? 0, write: req.merkleRoot });
    const endorsements: Endorsement[] = this.orgs.map((org) => ({
      mspId: org.mspId,
      peer: org.peers[0] ?? org.mspId,
      signature: hmacSha256Hex(org.secret, rwSet),
    }));
    // 2. Order: the ordering service cuts a block that chains to the previous one.
    const prev = this.state.blocks[this.state.blocks.length - 1];
    const number = (prev?.number ?? -1) + 1;
    const dataHash = sha256Hex(canonicalize({ txId, rwSet, endorsements }));
    const previousHash = prev?.hash ?? '0'.repeat(64);
    const hash = sha256Hex(canonicalize({ number, previousHash, dataHash }));
    const block: LedgerBlock = { number, previousHash, dataHash, hash, txIds: [txId], createdAt: now };
    this.state.blocks.push(block);
    // 3. Validate: endorsement policy + MVCC read-set check. Only VALID updates state.
    const validOrgs = new Set(
      endorsements
        .filter((e) => {
          const org = this.orgs.find((o) => o.mspId === e.mspId);
          return org !== undefined && hmacSha256Hex(org.secret, rwSet) === e.signature;
        })
        .map((e) => e.mspId),
    );
    let validationCode: ValidationCode = 'VALID';
    if (validOrgs.size < this.policyThreshold) validationCode = 'ENDORSEMENT_POLICY_FAILURE';
    else if (existing && existing.merkleRoot !== req.merkleRoot) validationCode = 'MVCC_READ_CONFLICT';
    if (validationCode === 'VALID') {
      this.state.worldState[req.batchRef] = {
        merkleRoot: req.merkleRoot,
        txId,
        schemaVersion: req.schemaVersion,
        version: (existing?.version ?? 0) + 1,
      };
    }
    const receipt: LedgerReceipt = {
      txId,
      channel: this.channel,
      chaincode: this.chaincode,
      blockNumber: number,
      blockHash: hash,
      validationCode,
      endorsements,
      merkleRoot: req.merkleRoot,
      batchRef: req.batchRef,
      committedAt: now,
    };
    this.state.transactions[txId] = receipt;
    return receipt;
  }

  async getTransaction(txId: string): Promise<LedgerReceipt | undefined> {
    return this.state.transactions[txId];
  }

  async readRoot(batchRef: string): Promise<{ merkleRoot: string; txId: string } | undefined> {
    const s = this.state.worldState[batchRef];
    return s ? { merkleRoot: s.merkleRoot, txId: s.txId } : undefined;
  }

  /** Verify the block hash chain has not been tampered with. */
  verifyChain(): boolean {
    let prevHash = '0'.repeat(64);
    for (const b of this.state.blocks) {
      if (b.previousHash !== prevHash) return false;
      if (sha256Hex(canonicalize({ number: b.number, previousHash: b.previousHash, dataHash: b.dataHash })) !== b.hash) return false;
      prevHash = b.hash;
    }
    return true;
  }
}
