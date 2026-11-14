/**
 * Accounting books exported as real Excel files on the Ministry of Finance's forms, built from
 * confirmed records only (Thông tư 152/2025/TT-BTC for households).
 */
import { describe, expect, it } from 'vitest';
import { D, sum } from '@argolet/core';
import { DEMO_TENANT } from '../src';
import { expectAppError, loginAs, seededApp } from './helpers';

/** The workbook is stored uncompressed, so its XML parts can be read back as text. */
const xml = (b64: string) => {
  const bin = atob(b64);
  expect(bin.slice(0, 4)).toBe('PK\u0003\u0004');
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

describe('accounting books export', () => {
  it('a company gets its double-entry books of the month in a real .xlsx', async () => {
    const { app } = await seededApp();
    const admin = await loginAs(app);
    const f = await app.modules.exportBooks(admin);
    expect(f).toMatchObject({
      filename: 'so-ke-toan-2026-10-den-2026-10.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      forms: ['S03a-DNN', 'F01-DNN', 'B02-DNN', 'Báo cáo tình hình tài chính', 'Chỉ số tài chính'],
    });
    const text = xml(f.contentBase64);
    expect(text).toContain('SỔ NHẬT KÝ CHUNG (Mẫu số S03a-DNN)');
    expect(text).toContain('BẢNG CÂN ĐỐI TÀI KHOẢN (Mẫu số F01-DNN)');
  });

  it('a household gets the forms of its tax method, totals equal to the confirmed sales', async () => {
    const { app, store } = await seededApp();
    const admin = await loginAs(app);
    await app.org.updateSettings(admin, {
      accountingRegime: 'HKD',
      address: '45 Lê Lợi, TP. Hồ Chí Minh',
      hkd: {
        method: 'PERCENT',
        lines: [{ name: 'Phân phối, cung cấp hàng hóa', vatRate: '1', pitRate: '0,5' }],
      },
    });
    const f = await app.modules.exportBooks(admin);
    expect(f.forms).toEqual(['S2a-HKD']);
    expect(f.filename).toBe('so-ke-toan-hkd-2026-10.xlsx');
    const text = xml(f.contentBase64);
    for (const s of [
      'Mẫu số S2a-HKD',
      '(Kèm theo Thông tư số 152/2025/TT-BTC ngày 31 tháng 12 năm 2025 của Bộ trưởng Bộ Tài chính)',
      'Địa chỉ: 45 Lê Lợi, TP. Hồ Chí Minh',
      '1. Ngành nghề Phân phối, cung cấp hàng hóa',
      'Thuế GTGT (1%)',
      'Thuế TNCN (0.5%)',
      'Tổng số thuế TNCN phải nộp',
    ])
      expect(text).toContain(s);
    // The book total is the sum of the confirmed sales records of the period.
    const expected = await store.read(async (tx) => {
      const docs = new Map((await tx.list('documents', DEMO_TENANT)).map((d) => [d.id, d]));
      const recs = (await tx.list('records', DEMO_TENANT)).filter(
        (r) =>
          r.periodId === '2026-10' &&
          (r.kind === 'ORDER' || r.kind === 'REVENUE') &&
          (!r.documentId || docs.get(r.documentId)?.status === 'VALIDATED'),
      );
      const refunds = recs.filter((r) => r.kind === 'ORDER').map((r) => r.refund || '0');
      return sum(recs.map((r) => r.amount)).minus(sum(refunds));
    });
    expect(expected.gt(0)).toBe(true);
    const totalCell = /<c r="E\d+" s="14"><f>SUM\(E\d+:E\d+\)<\/f><v>(\d+)<\/v><\/c>/.exec(text);
    expect(totalCell?.[1]).toBe(expected.toFixed(0));
    const vat = new RegExp(`<f>ROUND\\(E\\d+\\*1/100,0\\)</f><v>(\\d+)</v>`).exec(text);
    expect(vat?.[1]).toBe(D(expected).times(0.01).toDecimalPlaces(0).toFixed());

    await app.org.updateSettings(admin, { hkd: { method: 'INCOME', lines: [], incomePitRate: '15' } });
    expect((await app.modules.exportBooks(admin)).forms).toEqual(['S2b-HKD', 'S2c-HKD', 'S2e-HKD']);
    await app.org.updateSettings(admin, { hkd: { method: 'EXEMPT', lines: [] } });
    expect((await app.modules.exportBooks(admin)).forms).toEqual(['S1a-HKD']);
  });

  it('refuses superseded regimes and invented rates; households get household books', async () => {
    const { app, store } = await seededApp();
    const admin = await loginAs(app);
    await expectAppError(app.org.updateSettings(admin, { accountingRegime: 'TT200' }), 'VALIDATION');
    await app.org.updateSettings(admin, { accountingRegime: 'TT99' });
    await expectAppError(
      app.org.updateSettings(admin, {
        hkd: { method: 'PERCENT', lines: [{ name: 'Bán lẻ', vatRate: 'một' }] },
      }),
      'VALIDATION',
    );
    const { tenantId } = await app.org.createOrganization(admin, {
      name: 'Tiệm tạp hóa Bé Na',
      orgType: 'Hộ kinh doanh',
    });
    const tenant = await store.read((tx) => tx.get('tenants', tenantId, tenantId));
    expect(tenant!.settings.accountingRegime).toBe('HKD');
  });
});
