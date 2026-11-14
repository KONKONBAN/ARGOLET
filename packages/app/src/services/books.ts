/**
 * Accounting books of a period from confirmed records, as a real Excel workbook:
 *  - households (HKD): the forms of Thông tư 152/2025/TT-BTC chosen by their tax method;
 *  - companies (TT133 / TT99): the journal (Nhật ký chung) needs a debit/credit posting per
 *    transaction, which ARGOLET does not record yet — they get the confirmed source records,
 *    titled as such, rather than a journal with guessed accounts.
 * Every line comes from a confirmed document (or a record entered by a person), cited by code.
 */
import {
  buildXlsx,
  D,
  dec,
  hkdForms,
  sheetS1a,
  sheetS2a,
  sheetS2b,
  sheetS2c,
  sheetS2e,
  XLSX_MIME,
  type BookLine,
  type BusinessLineBook,
  type CostCategory,
  type HkdHeader,
  type MoneyAccount,
  type XSheet,
} from '@argolet/core';
import type { WorkspaceState } from '../runtime';
import type { Tx } from '../store';
import type { BusinessRecordRow, DocumentRow, TenantRow } from '../types';
import { scoped } from './documents';
import { scopeLabel } from './org';
import { isConfirmed } from './report';

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const monthLabel = (periodId: string) => `Tháng ${periodId.slice(5)}/${periodId.slice(0, 4)}`;

/** S2c-HKD cost caption for an expense, from the supplier / description (reviewed by a person). */
export function costCategory(text: string): CostCategory {
  const t = text.toLowerCase();
  if (/lãi vay|lãi tiền vay|tiền lãi/.test(t)) return 'dd';
  if (/lương|tiền công|bảo hiểm xã hội|bhxh/.test(t)) return 'b';
  if (/khấu hao/.test(t)) return 'c';
  if (
    /điện lực|tiền điện|cấp nước|tiền nước|viễn thông|internet|điện thoại|vận tải|vận chuyển|giao hàng|thuê|mặt bằng|nhà đất|sửa chữa|bảo dưỡng|bảo trì/.test(
      t,
    )
  )
    return 'd';
  if (
    /nguyên liệu|vật liệu|nhiên liệu|xăng|dầu|hàng hóa|bột|sữa|cà phê|đường|thực phẩm|bao bì|nông sản/.test(t)
  )
    return 'a';
  return 'e';
}

interface Source {
  tenant: TenantRow;
  periodId: string;
  records: BusinessRecordRow[];
  docs: Map<string, DocumentRow>;
  location: string;
}

async function load(tx: Tx, ws: WorkspaceState, tenant: TenantRow, periodId: string): Promise<Source> {
  const docs = new Map((await scoped(tx, ws, 'documents')).map((d) => [d.id, d]));
  // Only what a person confirmed: records of validated documents, or entered directly.
  const records = (await scoped(tx, ws, 'records'))
    .filter((r) => r.periodId === periodId && isConfirmed(r, docs))
    .sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
  const scope = await scopeLabel(tx, ws.tenantId, ws.entityId);
  return { tenant, periodId, records, docs, location: scope === 'Tất cả cơ sở' ? tenant.name : scope };
}

const docCode = (s: Source, r: BusinessRecordRow) =>
  r.documentId ? (s.docs.get(r.documentId)?.code ?? r.code) : r.code;

/** Sales of the period: POS / platform orders by document, day and channel; invoices one by one. */
function revenueLines(s: Source): BookLine[] {
  const out: BookLine[] = [];
  const groups = new Map<
    string,
    { docNo: string; date: string; channel: string; n: number; amount: string; refund: string }
  >();
  for (const r of s.records) {
    if (r.kind === 'REVENUE') {
      const d = r.documentId ? s.docs.get(r.documentId) : undefined;
      const invoice = d?.sourceKind === 'XML_EINVOICE';
      const no = d?.fields.documentNo
        ? invoice
          ? ` số ${d.fields.series ? `${d.fields.series}/` : ''}${d.fields.documentNo}`
          : ` (${d.fields.documentNo})`
        : '';
      // Only an e-invoice is called an invoice; POS / sales summaries are described as sales.
      out.push({
        docNo: docCode(s, r),
        date: r.date,
        description: `${invoice ? 'Hóa đơn bán ra' : `Doanh thu bán hàng ngày ${ddmm(r.date)}`}${no}${r.counterparty ? ` · ${r.counterparty}` : ''}`,
        amount: r.amount,
      });
    } else if (r.kind === 'ORDER') {
      const key = `${r.documentId ?? ''}|${r.date}|${r.channel}`;
      const g = groups.get(key) ?? {
        docNo: docCode(s, r),
        date: r.date,
        channel: r.channel || 'Bán hàng',
        n: 0,
        amount: '0',
        refund: '0',
      };
      g.n++;
      g.amount = dec(D(g.amount).plus(r.amount));
      // Refunds and merchant-funded discounts reduce the sales (as in the finance report).
      g.refund = dec(
        D(g.refund)
          .plus(r.refund || '0')
          .plus(r.discount || '0'),
      );
      groups.set(key, g);
    }
  }
  for (const g of groups.values()) {
    out.push({
      docNo: g.docNo,
      date: g.date,
      description: `Doanh thu bán hàng ngày ${ddmm(g.date)} · ${g.channel} (${g.n} đơn)`,
      amount: g.amount,
    });
    if (D(g.refund).gt(0))
      out.push({
        docNo: g.docNo,
        date: g.date,
        description: `Hoàn tiền, chiết khấu cho khách ngày ${ddmm(g.date)} · ${g.channel}`,
        amount: dec(D(g.refund).neg()),
      });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.docNo.localeCompare(b.docNo));
}

function costLines(s: Source): Partial<Record<CostCategory, BookLine[]>> {
  const out: Partial<Record<CostCategory, BookLine[]>> = {};
  const add = (k: CostCategory, l: BookLine) => (out[k] ??= []).push(l);
  const fees = new Map<string, BookLine>();
  for (const r of s.records) {
    if (r.kind === 'EXPENSE') {
      const d = r.documentId ? s.docs.get(r.documentId) : undefined;
      const what = [r.counterparty, d?.title, r.description].filter(Boolean).join(' · ');
      add(costCategory(what), {
        docNo: docCode(s, r),
        date: r.date,
        description: `${r.counterparty || d?.title || 'Chi phí'}${d?.fields.documentNo ? ` · số ${d.fields.documentNo}` : ''}`,
        amount: r.amount,
      });
    } else if (r.kind === 'ORDER' && D(r.fee || '0').gt(0)) {
      // Commission and fees withheld by delivery platforms.
      const key = `${r.documentId ?? ''}|${r.date}|${r.channel}`;
      const f = fees.get(key) ?? {
        docNo: docCode(s, r),
        date: r.date,
        description: `Phí nền tảng ${r.channel} ngày ${ddmm(r.date)}`,
        amount: '0',
      };
      f.amount = dec(D(f.amount).plus(r.fee));
      fees.set(key, f);
    }
  }
  for (const f of fees.values()) add('e', f);
  return out;
}

function moneyAccounts(s: Source): MoneyAccount[] {
  const cash: MoneyAccount = { name: 'Tiền mặt', kind: 'CASH', lines: [] };
  const banks = new Map<string, MoneyAccount>();
  for (const r of s.records) {
    const line = {
      docNo: r.reference || docCode(s, r),
      date: r.date,
      description: r.description || r.counterparty || 'Giao dịch',
      amount: r.amount,
    };
    if (r.kind === 'CASH') cash.lines.push(line);
    else if (r.kind === 'BANK_TXN') {
      const d = r.documentId ? s.docs.get(r.documentId) : undefined;
      const name =
        r.counterparty && r.counterparty.includes('·')
          ? r.counterparty
          : d?.fields.documentNo || d?.title || 'Tài khoản thanh toán';
      const acc = banks.get(name) ?? { name, kind: 'BANK' as const, lines: [] };
      acc.lines.push(line);
      banks.set(name, acc);
    }
  }
  return [cash, ...banks.values()];
}

function header(s: Source): HkdHeader {
  return {
    name: s.tenant.name,
    address: s.tenant.settings.address ?? '',
    taxCode: s.tenant.taxCode ?? '',
    location: s.location,
    period: monthLabel(s.periodId),
  };
}

function businessLines(s: Source, revenue: BookLine[]): BusinessLineBook[] {
  const declared = s.tenant.settings.hkd?.lines ?? [];
  const first = declared[0] ?? { name: 'Hoạt động kinh doanh' };
  // Until sales are tagged by business line, every sale goes to the first declared line.
  return [{ ...first, lines: revenue }, ...declared.slice(1).map((l) => ({ ...l, lines: [] }))];
}

export interface BooksFile {
  filename: string;
  mime: string;
  contentBase64: string;
  forms: string[];
  note: string;
}

export async function buildBooks(
  tx: Tx,
  ws: WorkspaceState,
  tenant: TenantRow,
  periodId: string,
  now: Date,
): Promise<BooksFile> {
  const s = await load(tx, ws, tenant, periodId);
  const method = tenant.settings.hkd?.method;
  const forms = hkdForms(method ?? 'EXEMPT');
  const h = header(s);
  const revenue = revenueLines(s);
  const sheets: XSheet[] = forms.map((f) => {
    if (f === 'S1a-HKD') return sheetS1a(h, revenue);
    if (f === 'S2a-HKD') return sheetS2a(h, businessLines(s, revenue));
    if (f === 'S2b-HKD') return sheetS2b(h, businessLines(s, revenue));
    if (f === 'S2c-HKD') return sheetS2c(h, revenue, costLines(s), tenant.settings.hkd?.incomePitRate);
    return sheetS2e(h, moneyAccounts(s));
  });
  const note = method
    ? `Mẫu ${forms.join(', ')} theo Thông tư 152/2025/TT-BTC.`
    : 'Chưa chọn phương pháp nộp thuế: xuất mẫu S1a-HKD. Chọn phương pháp trong Cài đặt để có đúng bộ sổ.';
  const bytes = buildXlsx(sheets, {
    title: `Sổ kế toán ${monthLabel(periodId)}`,
    author: 'ARGOLET',
    created: now,
  });
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return {
    filename: `so-ke-toan-hkd-${periodId}.xlsx`,
    mime: XLSX_MIME,
    contentBase64: btoa(bin),
    forms,
    note,
  };
}
