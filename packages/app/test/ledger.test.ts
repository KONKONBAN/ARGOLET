/**
 * Automatic books from confirmed documents: the ledger agrees with the finance report, balances,
 * closes every month and feeds the calculators and the appraisal.
 */
import { describe, expect, it } from 'vitest';
import { D } from '@argolet/core';
import { expectAppError, loginAs, seededApp } from './helpers';

const xmlOf = (b64: string) => {
  const bin = atob(b64);
  expect(bin.slice(0, 4)).toBe('PK\u0003\u0004');
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

describe('automatic books', () => {
  it('posts every confirmed document and agrees with the finance report month by month', async () => {
    const { app } = await seededApp();
    const admin = await loginAs(app);
    const books = await app.ledger.overview(admin, { months: 6 });
    if (!books.applicable) throw new Error('company books expected');
    expect(books.regime).toBe('TT133');
    expect(books.pipeline.documents).toBeGreaterThan(10);
    expect(books.pipeline.entries).toBeGreaterThan(books.pipeline.events);
    const report = await app.finance.report(admin, { months: 6 });
    for (const m of books.monthly) {
      const r = report.months.find((x) => x.periodId === m.periodId)!;
      expect(m.netRevenue).toBe(r.netRevenue);
    }
    // Without stock counts, materials bought are used in the month: profit before tax = report result.
    const income = books.income.figures;
    expect(D(income.profitBeforeTax).toFixed()).toBe(D(report.totals.result).toFixed());
    expect(books.balance.end.figures.balanced).toBe(true);
    expect(books.trial.reduce((t, r) => t.plus(r.closingDebit).minus(r.closingCredit), D(0)).isZero()).toBe(
      true,
    );
    for (const code of ['511', '632', '6421', '6422', '821', '911']) {
      const row = books.trial.find((r) => r.account === code);
      if (row) expect([row.closingDebit, row.closingCredit]).toEqual(['0', '0']);
    }
    expect(books.ratios.map((g) => g.key)).toEqual(['liquidity', 'leverage', 'efficiency', 'profitability']);
    expect(books.calculators.revenue).toBe(income.netRevenue);
    expect(books.citAuto).toBe(true);
  });

  it('opening balances must balance; with them the books show the financial position', async () => {
    const { app } = await seededApp();
    const accountant = await loginAs(app, 'thanhha@minhan.example');
    await expectAppError(
      app.ledger.saveSettings(accountant, { openingPeriod: '2026-05', opening: { '112': '100000000' } }),
      'VALIDATION',
    );
    await app.ledger.saveSettings(accountant, {
      openingPeriod: '2026-05',
      opening: { '111': '20000000', '112': '300000000', '4111': '-320000000' },
      citRate: '0.2',
    });
    const books = await app.ledger.overview(accountant, { months: 6 });
    if (!books.applicable) throw new Error('company books expected');
    expect(books.hasOpening).toBe(true);
    expect(books.citRate).toBe('0.2');
    expect(books.balance.end.figures.balanced).toBe(true);
    expect(D(books.balance.end.figures.capital).toFixed()).toBe('320000000');
    const journal = await app.ledger.journal(accountant, { months: 6, pageSize: 5 });
    expect(journal.items).toHaveLength(5);
    expect(journal.total).toBe(books.pipeline.entries);
    for (const e of journal.items) {
      const d = e.lines.reduce((t, l) => t.plus(l.debit), D(0));
      expect(d.eq(e.lines.reduce((t, l) => t.plus(l.credit), D(0)))).toBe(true);
    }
  });

  it('exports the journal, trial balance, B02-DNN, financial position and ratios', async () => {
    const { app } = await seededApp();
    const admin = await loginAs(app);
    const file = await app.ledger.exportBooks(admin, { months: 3 });
    const xml = xmlOf(file.contentBase64);
    for (const s of [
      'Nhật ký chung',
      'Cân đối tài khoản',
      'Kết quả kinh doanh',
      'Tình hình tài chính',
      'Chỉ số tài chính',
    ])
      expect(xml).toContain(s);
    expect(xml).toContain('S03a-DNN');
    expect(xml).toContain('B02-DNN');
    const staff = await loginAs(app, 'minhanh.nguyen@minhan.example');
    await expectAppError(app.ledger.exportBooks(staff, {}), 'FORBIDDEN');
  });

  it('records every books export as a reproducible calculation', async () => {
    const { app } = await seededApp();
    const admin = await loginAs(app);
    const before = await app.finance.calcRuns(admin);
    await app.ledger.exportBooks(admin, { months: 3 });
    const runs = await app.finance.calcRuns(admin);
    expect(runs).toHaveLength(before.length + 1);
    const run = runs[0]!;
    expect(run.task).toBe('books_statements');
    expect(run.taskLabel).toBe('Sổ kế toán và báo cáo tài chính');
    expect(run.inputSnapshotDigest).toMatch(/^[0-9a-f]{64}$/);
    // Same books, same settings → same input fingerprint; a new opening balance changes it.
    await app.ledger.exportBooks(admin, { months: 3 });
    expect((await app.finance.calcRuns(admin))[0]!.inputSnapshotDigest).toBe(run.inputSnapshotDigest);
    const accountant = await loginAs(app, 'thanhha@minhan.example');
    await app.ledger.saveSettings(accountant, { citRate: '0.2' });
    await app.ledger.exportBooks(admin, { months: 3 });
    expect((await app.finance.calcRuns(admin))[0]!.inputSnapshotDigest).not.toBe(run.inputSnapshotDigest);
    await app.finance.exportReport(admin, { months: '3' });
    const report = (await app.finance.calcRuns(admin))[0]!;
    expect(report.task).toBe('finance_report');
    expect(report.taskLabel).toBe('Báo cáo tài chính theo tháng');
  });
});
