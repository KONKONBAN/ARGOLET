/**
 * Finance report from confirmed documents: one definition of revenue, costs and result shared by
 * every screen, figures equal to the source records, and a real Excel file with its sources.
 */
import { describe, expect, it } from 'vitest';
import { D, formatVnd, sum } from '@argolet/core';
import { DEMO_TENANT, periodsEndingAt } from '../src';
import { expectAppError, loginAs, seededApp } from './helpers';

const xmlOf = (b64: string) => {
  const bin = atob(b64);
  expect(bin.slice(0, 4)).toBe('PK\u0003\u0004');
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

describe('finance report', () => {
  it('every screen shows the same figures, computed from confirmed records only', async () => {
    const { app, store } = await seededApp();
    const admin = await loginAs(app);
    const report = await app.finance.report(admin, {});
    const m = report.months.at(-1)!;
    expect(m.periodId).toBe('2026-10');

    // Independent recomputation from the stored records.
    const expected = await store.read(async (tx) => {
      const docs = new Map((await tx.list('documents', DEMO_TENANT)).map((d) => [d.id, d]));
      const all = (await tx.list('records', DEMO_TENANT)).filter((r) => r.periodId === '2026-10');
      const ok = all.filter((r) => !r.documentId || docs.get(r.documentId)!.status === 'VALIDATED');
      const orders = ok.filter((r) => r.kind === 'ORDER');
      const gross = sum(ok.filter((r) => r.kind === 'ORDER' || r.kind === 'REVENUE').map((r) => r.amount));
      const returns = sum(orders.map((r) => D(r.refund).plus(r.discount)));
      const fees = sum(orders.map((r) => r.fee));
      const expenses = sum(ok.filter((r) => r.kind === 'EXPENSE').map((r) => r.amount));
      const pending = all.filter((r) => r.documentId && docs.get(r.documentId)!.status !== 'VALIDATED');
      return { gross, returns, fees, expenses, pending };
    });
    // The platform report CT-1025 awaits reconciliation: its orders are not counted yet.
    expect(expected.pending.map((r) => r.code)).toEqual(['DH-1031-01', 'DH-1031-02', 'DH-1031-03']);
    expect(m.grossSales).toBe(expected.gross.toFixed());
    expect(m.returns).toBe(expected.returns.toFixed());
    expect(m.netRevenue).toBe(expected.gross.minus(expected.returns).toFixed());
    expect(m.platformFees).toBe(expected.fees.toFixed());
    expect(m.totalCosts).toBe(expected.expenses.plus(expected.fees).toFixed());
    expect(sum(Object.values(m.costs)).toFixed()).toBe(expected.expenses.toFixed());
    expect(m.result).toBe(D(m.netRevenue).minus(m.totalCosts).toFixed());

    // Figma screen 09 figures, now on the confirmed basis.
    expect([m.netRevenue, m.totalCosts, m.result]).toEqual(['428600000', '344000000', '84600000']);
    const o = await app.dashboard.overview(admin);
    expect([o.revenue, o.expense, o.net]).toEqual([m.netRevenue, m.totalCosts, m.result]);
    expect(o.revenueNote).toBe('Tại quầy 248,6 triệu · Nền tảng 180 triệu · chờ xác nhận 1,3 triệu');
    const dp = await app.close.decisionPack(admin);
    expect([dp.kpis.revenue, dp.kpis.expense, dp.kpis.net]).toEqual([m.netRevenue, m.totalCosts, m.result]);
    const books = await app.modules.booksTax(admin);
    expect(books.kpis.slice(0, 2).map((k) => k.value)).toEqual([
      formatVnd(m.netRevenue),
      formatVnd(m.totalCosts),
    ]);
    const a = await app.assistant.ask(admin, { question: 'Doanh thu tháng này bao nhiêu?' });
    expect(a.answer.facts.slice(0, 3).map((f) => f.value)).toEqual([
      formatVnd(m.netRevenue),
      formatVnd(m.totalCosts),
      formatVnd(m.result),
    ]);
    expect(report.current).toMatchObject({ netRevenueLabel: '428.600.000 đ', marginLabel: '19,7%' });
    // Months without confirmed documents are zero, never estimated.
    expect(report.months.slice(0, -1).every((x) => x.netRevenue === '0' && x.totalCosts === '0')).toBe(true);
    expect(report.appraisalHint).toEqual({
      annualCashflow: '1015200000',
      annualCashflowMillions: '1015',
      note: 'Kết quả bình quân 84.600.000 đ/tháng của 1 tháng có doanh thu × 12 tháng.',
    });
  });

  it('a newly confirmed e-invoice moves the figures: pre-VAT cost and its input VAT', async () => {
    const { app } = await seededApp();
    const acct = await loginAs(app, 'thanhha@minhan.example');
    const before = (await app.finance.report(acct, {})).months.at(-1)!;
    const xml = `<HDon><DLHDon><TTChung><KHMSHDon>1</KHMSHDon><KHHDon>C26TNV</KHHDon><SHDon>00997</SHDon><NLap>2026-10-30</NLap></TTChung>
      <NDHDon><NBan><Ten>Nguyên liệu Việt</Ten><MST>0312345673</MST></NBan><NMua><Ten>Công ty khác</Ten><MST>0100109106</MST></NMua>
      <DSHHDVu><HHDVu><THHDVu>Cà phê hạt</THHDVu><ThTien>2000000</ThTien><TSuat>10%</TSuat></HHDVu></DSHHDVu>
      <TToan><THTTLTSuat><LTSuat><TSuat>10%</TSuat><ThTien>2000000</ThTien><TThue>200000</TThue></LTSuat></THTTLTSuat>
      <TgTCThue>2000000</TgTCThue><TgTThue>200000</TgTThue><TgTTTBSo>2200000</TgTTTBSo></TToan></NDHDon></DLHDon>
      <MCCQT>00ABCDEF0123456789</MCCQT></HDon>`;
    const r = await app.documents.intake(acct, { files: [{ name: 'hd-00997.xml', text: xml }] });
    const id = r.files[0]!.documentId;
    // Not in the report until a person confirms it.
    expect((await app.finance.report(acct, {})).months.at(-1)!.totalCosts).toBe(before.totalCosts);
    await app.documents.confirmDocument(acct, { documentId: id, acknowledgeWarnings: true });
    const after = (await app.finance.report(acct, {})).months.at(-1)!;
    expect(D(after.costs.a).minus(before.costs.a).toFixed()).toBe('2000000');
    expect(D(after.vatIn).minus(before.vatIn).toFixed()).toBe('200000');
    expect(D(before.result).minus(after.result).toFixed()).toBe('2000000');
  });

  it('exports a real .xlsx with formulas and every source line; exporting needs the permission', async () => {
    const { app } = await seededApp();
    const admin = await loginAs(app);
    const f = await app.finance.exportReport(admin, { months: '3' });
    expect(f.filename).toBe('bao-cao-ket-qua-kinh-doanh-2026-08-den-2026-10.xlsx');
    expect(f.mime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const text = xmlOf(f.contentBase64);
    for (const s of [
      'BÁO CÁO KẾT QUẢ KINH DOANH THEO CHỨNG TỪ',
      'Tháng 8/2026 – Tháng 10/2026',
      'Kết quả kinh doanh',
      'Chứng từ nguồn',
      '3. Doanh thu thuần (3 = 1 − 2)',
      '5. Kết quả thu − chi (5 = 3 − 4)',
      'CT-1027',
    ])
      expect(text).toContain(s);
    // Net revenue of October (column D) is a formula over rows 1 and 2, with ARGOLET's value.
    expect(text).toMatch(/<c r="D10" s="14"><f>D8-D9<\/f><v>428600000<\/v><\/c>/);
    expect(text).toMatch(/<c r="E10" s="14"><f>SUM\(B10:D10\)<\/f><v>428600000<\/v><\/c>/);
    const staff = await loginAs(app, 'minhanh.nguyen@minhan.example');
    await expectAppError(app.finance.exportReport(staff, {}), 'FORBIDDEN');
  });

  it('counts months across a year boundary', () => {
    expect(periodsEndingAt('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(periodsEndingAt('2026-10', 1)).toEqual(['2026-10']);
  });
});
