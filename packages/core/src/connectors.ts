/**
 * Data ARGOLET pulls from partners' APIs, kept exactly as received ("snapshot") and read here into
 * statement / sales rows. The snapshot is stored as the source artifact (SHA-256 fingerprint), so
 * every figure can be traced back to the partner's own response.
 *
 *  - SePay API v2 (developer.sepay.vn): GET https://userapi.sepay.vn/v2/transactions — bank
 *    transactions of the accounts linked in SePay; amounts are integers (VND).
 *  - KiotViet Public API (kiotviet.vn, mục 2.12.1): GET https://public.kiotapi.com/invoices —
 *    sales invoices; status 1 = hoàn thành, 2 = đã hủy, 3 = đang xử lý, 5 = không giao được.
 */
import { D, dec } from './decimal';

export const SNAPSHOT_FORMAT = 'argolet.connector-snapshot/1';

export type ConnectorProvider = 'SEPAY' | 'KIOTVIET';

export interface ConnectorSnapshot {
  format: typeof SNAPSHOT_FORMAT;
  provider: ConnectorProvider;
  resource: 'transactions' | 'invoices';
  /** When the pages were fetched (ISO). */
  fetchedAt: string;
  /** The query sent (no credentials). */
  query: Record<string, string>;
  /** Response bodies exactly as received, page after page. */
  pages: unknown[];
  /** Codes already imported by an earlier sync (overlapping pages are kept verbatim, not re-booked). */
  alreadyImported?: string[];
}

export interface SnapshotBankLine {
  externalId: string;
  date: string;
  /** Credit − debit, VND. */
  amount: string;
  reference: string;
  description: string;
  account: string;
  bank: string;
}

export interface SnapshotSaleLine {
  externalId: string;
  code: string;
  date: string;
  /** Amount due from the customer (KiotViet "total": khách cần trả). */
  total: string;
  paid: string;
  customer: string;
  branch: string;
  channel: string;
  /** e.g. "Tiền mặt 200.000 · Chuyển khoản 150.000". */
  payments: string;
}

export function isConnectorSnapshot(v: unknown): v is ConnectorSnapshot {
  const s = v as Partial<ConnectorSnapshot> | null;
  return (
    !!s &&
    typeof s === 'object' &&
    s.format === SNAPSHOT_FORMAT &&
    (s.provider === 'SEPAY' || s.provider === 'KIOTVIET') &&
    Array.isArray(s.pages)
  );
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();

function amount(v: unknown, what: string, integer = false): string {
  if (v === null || v === undefined || v === '') return '0';
  const s = String(v).trim();
  if (!(integer ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/).test(s))
    throw new Error(`${what}: số tiền không hợp lệ "${s}"`);
  return dec(D(s));
}

/** "2026-02-18 09:35:12" or ISO 8601 → "2026-02-18". */
function day(v: unknown, what: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(str(v));
  if (!m) throw new Error(`${what}: ngày không hợp lệ "${str(v)}"`);
  return m[1]!;
}

/** SePay v2 transactions → bank lines (one per transaction, duplicates across pages dropped). */
export function readSepayTransactions(pages: unknown[]): SnapshotBankLine[] {
  const seen = new Set<string>();
  const out: SnapshotBankLine[] = [];
  for (const page of pages) {
    if (!isObj(page) || page.status !== 'success' || !Array.isArray(page.data))
      throw new Error('Phản hồi SePay không đúng định dạng (thiếu status "success" hoặc data)');
    for (const t of page.data) {
      if (!isObj(t)) continue;
      const id = str(t.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const what = `Giao dịch ${str(t.reference_number) || id}`;
      out.push({
        externalId: id,
        date: day(t.transaction_date, what),
        // SePay: currency fields are always integers (VND).
        amount: dec(D(amount(t.amount_in, what, true)).minus(amount(t.amount_out, what, true))),
        reference: str(t.reference_number) || id,
        description: str(t.transaction_content),
        account: str(t.account_number),
        bank: str(t.bank_brand_name),
      });
    }
  }
  return out;
}

const METHOD: Record<string, string> = { cash: 'Tiền mặt', card: 'Thẻ', transfer: 'Chuyển khoản' };
const vnd = (s: string) =>
  D(s)
    .toFixed(0)
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** KiotViet invoices → completed sales (status 1). Cancelled or pending invoices are counted apart. */
export function readKiotVietInvoices(pages: unknown[]): {
  sales: SnapshotSaleLine[];
  skipped: { cancelled: number; pending: number };
} {
  const seen = new Set<string>();
  const sales: SnapshotSaleLine[] = [];
  const skipped = { cancelled: 0, pending: 0 };
  for (const page of pages) {
    if (!isObj(page) || !Array.isArray(page.data))
      throw new Error('Phản hồi KiotViet không đúng định dạng (thiếu data)');
    for (const inv of page.data) {
      if (!isObj(inv)) continue;
      const id = str(inv.id) || str(inv.code);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const status = Number(inv.status);
      if (status === 2) {
        skipped.cancelled++;
        continue;
      }
      if (status !== 1) {
        skipped.pending++;
        continue;
      }
      const what = `Hóa đơn ${str(inv.code) || id}`;
      const payments = (Array.isArray(inv.payments) ? inv.payments : [])
        .filter(isObj)
        .map(
          (p) =>
            `${METHOD[str(p.method).toLowerCase()] ?? (str(p.method) || 'Khác')} ${vnd(amount(p.amount, what))}`,
        )
        .join(' · ');
      const channel = isObj(inv.SaleChannel) ? str(inv.SaleChannel.Name) : '';
      sales.push({
        externalId: id,
        code: str(inv.code) || id,
        date: day(inv.purchaseDate, what),
        total: amount(inv.total, what),
        paid: amount(inv.totalPayment, what),
        customer: str(inv.customerName),
        branch: str(inv.branchName),
        channel,
        payments,
      });
    }
  }
  return { sales, skipped };
}
