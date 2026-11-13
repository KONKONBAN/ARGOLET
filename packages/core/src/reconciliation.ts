import { D, dec, isZero, min, sum, type Decimal } from './decimal';
import { formatVnd } from './format';

/**
 * Multi-source many-to-many reconciliation engine (board sections 03, 06, 11).
 * Orders (gross, fee, refund, discount, adjustment) are matched with money actually
 * received (bank / cash / platform payouts). Pipeline:
 *   snapshot input → candidate blocking → similarity scoring → 1:1 assignment (Hungarian)
 *   or M:N constrained allocation → residuals → explanation → human confirmation.
 * The engine never guesses fees: fee/refund amounts must come from source records or rules.
 */
export interface ReconOrder {
  recordId: string;
  recordVersion: number;
  code: string;
  gross: string;
  fee: string;
  refund: string;
  discount: string;
  adjustment: string;
  currency: string;
  date: string; // YYYY-MM-DD
  reference?: string | undefined;
  payoutBatch?: string | undefined;
  counterparty?: string | undefined;
  channel?: string | undefined;
}

export interface ReconTxn {
  recordId: string;
  recordVersion: number;
  code: string;
  amount: string;
  currency: string;
  date: string;
  source: 'BANK' | 'CASH' | 'PLATFORM';
  reference?: string | undefined;
  payoutBatch?: string | undefined;
  counterparty?: string | undefined;
}

export interface ReconRules {
  rulesVersion: string;
  /** Absolute amount tolerance in currency units. */
  amountTolerance: string;
  dateWindowDays: number;
  minScore: number;
  weights: { reference: number; amount: number; date: number; counterparty: number };
}

export const DEFAULT_RULES: ReconRules = {
  rulesVersion: 'recon-rules-2026.10',
  amountTolerance: '0',
  dateWindowDays: 3,
  minScore: 0.5,
  weights: { reference: 0.4, amount: 0.35, date: 0.15, counterparty: 0.1 },
};

export interface AllocationLink {
  orderId: string;
  txnId: string;
  amount: string;
}

export interface RecordAllocation {
  recordId: string;
  recordVersion: number;
  role: 'ORDER' | 'RECEIPT';
  allocatedAmount: string;
  remaining: string;
}

export type MatchStatus = 'MATCHED' | 'DISCREPANCY';
export type MatchKind = 'ONE_TO_ONE' | 'MANY_TO_MANY' | 'MANY_TO_ONE' | 'ONE_TO_MANY';

export interface ProposedGroup {
  key: string;
  kind: MatchKind;
  status: MatchStatus;
  currency: string;
  orderIds: string[];
  txnIds: string[];
  gross: string;
  fee: string;
  refund: string;
  discount: string;
  adjustment: string;
  net: string;
  received: string;
  residual: string;
  score: number;
  links: AllocationLink[];
  allocations: RecordAllocation[];
  explanation: string;
  basis: string[];
}

export interface ReconResult {
  rulesVersion: string;
  inputDigestFields: { orders: string[]; txns: string[] };
  groups: ProposedGroup[];
  unmatchedOrders: string[];
  unmatchedTxns: string[];
}

/** Net receivable: Gross − refund − merchant discount − fee + signed adjustments. */
export function computeNet(
  o: Pick<ReconOrder, 'gross' | 'fee' | 'refund' | 'discount' | 'adjustment'>,
): Decimal {
  return D(o.gross).minus(o.refund).minus(o.discount).minus(o.fee).plus(o.adjustment);
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86_400_000;
}

/** Similarity score between an order and a receipt (0..1). */
export function scorePair(order: ReconOrder, txn: ReconTxn, rules: ReconRules = DEFAULT_RULES): number {
  if (order.currency !== txn.currency) return 0; // never match across currencies
  const net = computeNet(order);
  const refScore =
    order.reference && txn.reference && order.reference === txn.reference
      ? 1
      : order.payoutBatch && txn.payoutBatch && order.payoutBatch === txn.payoutBatch
        ? 1
        : 0;
  const diff = net.minus(txn.amount).abs();
  const amountScore = diff.lte(rules.amountTolerance)
    ? 1
    : Math.max(0, 1 - diff.div(Decimal_max(net.abs(), 1)).toNumber());
  const days = daysBetween(order.date, txn.date);
  const dateScore = days > rules.dateWindowDays ? 0 : 1 - days / (rules.dateWindowDays + 1);
  const cpScore = order.counterparty && txn.counterparty && order.counterparty === txn.counterparty ? 1 : 0;
  const w = rules.weights;
  return round4(
    w.reference * refScore + w.amount * amountScore + w.date * dateScore + w.counterparty * cpScore,
  );
}

function Decimal_max(a: Decimal, b: number): Decimal {
  return a.gt(b) ? a : D(b);
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Hungarian algorithm (Kuhn–Munkres) maximising total score on a rectangular matrix.
 * Returns pairs [row, col]. O(n³).
 */
export function hungarianMax(scores: number[][]): [number, number][] {
  const rows = scores.length;
  if (rows === 0) return [];
  const cols = scores[0]!.length;
  if (cols === 0) return [];
  const n = Math.max(rows, cols);
  const maxScore = Math.max(0, ...scores.flat());
  // Cost matrix (minimise), padded with maxScore (score 0) for dummy rows/cols.
  const cost: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i < rows && j < cols ? maxScore - scores[i]![j]! : maxScore)),
  );
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }
  const result: [number, number][] = [];
  for (let j = 1; j <= n; j++) {
    const i = p[j]!;
    if (i >= 1 && i <= rows && j <= cols) result.push([i - 1, j - 1]);
  }
  return result.sort((a, b) => a[0] - b[0]);
}

/**
 * M:N allocation with amount & period constraints: orders and receipts sorted by date
 * then code, allocated first-in-first-out so every order's net is fully covered before
 * moving on. Deterministic and explainable (board 11 example: O1→B1 78k, O2→B1 42k, O2→B2 70k).
 */
export function allocateManyToMany(
  orders: { id: string; net: Decimal; date: string; code: string }[],
  txns: { id: string; amount: Decimal; date: string; code: string }[],
): AllocationLink[] {
  const os = orders.slice().sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
  const ts = txns.slice().sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
  const remO = os.map((o) => o.net);
  const remT = ts.map((t) => t.amount);
  const links: AllocationLink[] = [];
  let i = 0;
  let j = 0;
  while (i < os.length && j < ts.length) {
    if (remO[i]!.lte(0)) {
      i++;
      continue;
    }
    if (remT[j]!.lte(0)) {
      j++;
      continue;
    }
    const amt = min(remO[i]!, remT[j]!);
    links.push({ orderId: os[i]!.id, txnId: ts[j]!.id, amount: dec(amt) });
    remO[i] = remO[i]!.minus(amt);
    remT[j] = remT[j]!.minus(amt);
  }
  return links;
}

function buildGroup(key: string, orders: ReconOrder[], txns: ReconTxn[], rules: ReconRules): ProposedGroup {
  const nets = new Map(orders.map((o) => [o.recordId, computeNet(o)]));
  const links = allocateManyToMany(
    orders.map((o) => ({ id: o.recordId, net: nets.get(o.recordId)!, date: o.date, code: o.code })),
    txns.map((t) => ({ id: t.recordId, amount: D(t.amount), date: t.date, code: t.code })),
  );
  const net = sum(nets.values());
  const received = sum(txns.map((t) => t.amount));
  const residual = net.minus(received);
  const status: MatchStatus = isZero(residual, rules.amountTolerance) ? 'MATCHED' : 'DISCREPANCY';
  const kind: MatchKind =
    orders.length === 1 && txns.length === 1
      ? 'ONE_TO_ONE'
      : orders.length > 1 && txns.length > 1
        ? 'MANY_TO_MANY'
        : orders.length > 1
          ? 'MANY_TO_ONE'
          : 'ONE_TO_MANY';
  const allocations: RecordAllocation[] = [
    ...orders.map((o) => {
      const allocated = sum(links.filter((l) => l.orderId === o.recordId).map((l) => l.amount));
      return {
        recordId: o.recordId,
        recordVersion: o.recordVersion,
        role: 'ORDER' as const,
        allocatedAmount: dec(allocated),
        remaining: dec(nets.get(o.recordId)!.minus(allocated)),
      };
    }),
    ...txns.map((t) => {
      const allocated = sum(links.filter((l) => l.txnId === t.recordId).map((l) => l.amount));
      return {
        recordId: t.recordId,
        recordVersion: t.recordVersion,
        role: 'RECEIPT' as const,
        allocatedAmount: dec(allocated),
        remaining: dec(D(t.amount).minus(allocated)),
      };
    }),
  ];
  const scores = orders.flatMap((o) => txns.map((t) => scorePair(o, t, rules)));
  const pairScore = scores.length ? Math.max(...scores) : 0;
  const coverage = net.isZero() ? 0 : Math.min(1, received.div(net).toNumber());
  const score = round4(status === 'MATCHED' ? Math.max(pairScore, 0.9) : Math.min(pairScore, coverage));
  const gross = sum(orders.map((o) => o.gross));
  const fee = sum(orders.map((o) => o.fee));
  const refund = sum(orders.map((o) => o.refund));
  const discount = sum(orders.map((o) => o.discount));
  const adjustment = sum(orders.map((o) => o.adjustment));
  const basis: string[] = [];
  const refs = new Set(orders.map((o) => o.payoutBatch ?? o.reference).filter(Boolean));
  if (refs.size === 1) basis.push(`Cùng mã thanh toán ${[...refs][0]}`);
  const sameDay = new Set(txns.map((t) => t.date)).size === 1;
  if (sameDay) basis.push('Cùng ngày nhận tiền');
  basis.push(
    status === 'MATCHED'
      ? `Tổng đơn trừ phí và hoàn tiền (${formatVnd(net)}) bằng số tiền nhận (${formatVnd(received)})`
      : `Chênh lệch ${formatVnd(residual.abs())} giữa tiền phải nhận và tiền thực nhận`,
  );
  basis.push(`Quy tắc ${rules.rulesVersion}; không tự suy đoán phí`);
  const explanation =
    status === 'MATCHED'
      ? `${orders.length} đơn hàng khớp với ${txns.length} khoản nhận tiền. Tổng đơn là ${formatVnd(gross)}. Sau khi trừ ${formatVnd(fee)} phí${refund.gt(0) ? `, ${formatVnd(refund)} hoàn tiền` : ''}${discount.gt(0) ? `, ${formatVnd(discount)} chiết khấu` : ''}, số phải nhận là ${formatVnd(net)}, bằng ${txns.length === 1 ? 'giao dịch ' + txns[0]!.code : 'tổng các giao dịch ' + txns.map((t) => t.code).join(', ')}.`
      : `${orders.length} đơn hàng và ${txns.length} khoản tiền lệch ${formatVnd(residual.abs())}. Cần bổ sung chứng từ phí/hoàn tiền hoặc người có quyền xác nhận điều chỉnh.`;
  return {
    key,
    kind,
    status,
    currency: orders[0]?.currency ?? txns[0]?.currency ?? 'VND',
    orderIds: orders.map((o) => o.recordId),
    txnIds: txns.map((t) => t.recordId),
    gross: dec(gross),
    fee: dec(fee),
    refund: dec(refund),
    discount: dec(discount),
    adjustment: dec(adjustment),
    net: dec(net),
    received: dec(received),
    residual: dec(residual),
    score,
    links,
    allocations,
    explanation,
    basis,
  };
}

/** Run the full reconciliation pipeline over a frozen input snapshot. */
export function runReconciliation(
  orders: ReconOrder[],
  txns: ReconTxn[],
  rules: ReconRules = DEFAULT_RULES,
): ReconResult {
  const groups: ProposedGroup[] = [];
  const usedOrders = new Set<string>();
  const usedTxns = new Set<string>();
  // 1. Candidate blocking by currency + payout batch / reference (prevents cross-currency matches).
  const keyOf = (x: {
    currency: string;
    payoutBatch?: string | undefined;
    reference?: string | undefined;
  }) =>
    x.payoutBatch
      ? `${x.currency}|batch:${x.payoutBatch}`
      : x.reference
        ? `${x.currency}|ref:${x.reference}`
        : null;
  const blocks = new Map<string, { orders: ReconOrder[]; txns: ReconTxn[] }>();
  for (const o of orders) {
    const k = keyOf(o);
    if (!k) continue;
    if (!blocks.has(k)) blocks.set(k, { orders: [], txns: [] });
    blocks.get(k)!.orders.push(o);
  }
  for (const t of txns) {
    const k = keyOf(t);
    if (!k || !blocks.has(k)) continue;
    blocks.get(k)!.txns.push(t);
  }
  for (const [key, b] of [...blocks.entries()].sort(([a], [c]) => a.localeCompare(c))) {
    if (b.orders.length === 0 || b.txns.length === 0) continue;
    groups.push(buildGroup(key, b.orders, b.txns, rules));
    b.orders.forEach((o) => usedOrders.add(o.recordId));
    b.txns.forEach((t) => usedTxns.add(t.recordId));
  }
  // 2. Remaining records: score pairs inside the date window and solve 1:1 assignment.
  const restO = orders.filter((o) => !usedOrders.has(o.recordId));
  const restT = txns.filter((t) => !usedTxns.has(t.recordId));
  if (restO.length && restT.length) {
    const matrix = restO.map((o) => restT.map((t) => scorePair(o, t, rules)));
    for (const [i, j] of hungarianMax(matrix)) {
      if (matrix[i]![j]! < rules.minScore) continue;
      const o = restO[i]!;
      const t = restT[j]!;
      groups.push(buildGroup(`${o.currency}|pair:${o.code}:${t.code}`, [o], [t], rules));
      usedOrders.add(o.recordId);
      usedTxns.add(t.recordId);
    }
  }
  return {
    rulesVersion: rules.rulesVersion,
    inputDigestFields: {
      orders: orders.map((o) => `${o.recordId}@${o.recordVersion}`).sort(),
      txns: txns.map((t) => `${t.recordId}@${t.recordVersion}`).sort(),
    },
    groups,
    unmatchedOrders: orders.filter((o) => !usedOrders.has(o.recordId)).map((o) => o.recordId),
    unmatchedTxns: txns.filter((t) => !usedTxns.has(t.recordId)).map((t) => t.recordId),
  };
}
