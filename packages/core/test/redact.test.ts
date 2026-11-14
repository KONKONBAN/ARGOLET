import { describe, expect, it } from 'vitest';
import { createRedactor } from '../src';

describe('personal data redaction before AI', () => {
  it('hides e-mails, phones, tax codes, CCCD and account numbers, then restores them', () => {
    const r = createRedactor({ people: ['Nguyễn Minh Anh'] });
    const q =
      'Gửi cho chị Nguyễn Minh Anh (minhanh@minhan.vn, 0912 345 678) bảng kê của MST 0312345673, CCCD 001203004567, STK 19028745631 — doanh thu 344000000 đ, 1.250.000 đ.';
    const hidden = r.text(q);
    expect(hidden).toBe(
      'Gửi cho chị [NGƯỜI_1] ([EMAIL_1], [SĐT_1]) bảng kê của MST [MST_1], CCCD [CCCD_1], STK [STK_1] — doanh thu 344000000 đ, 1.250.000 đ.',
    );
    expect(r.counts()).toEqual({ EMAIL: 1, SĐT: 1, MST: 1, CCCD: 1, STK: 1, NGƯỜI: 1 });
    expect(r.restore(`Đã gửi [EMAIL_1] cho [NGƯỜI_1]; [MST_9] không có.`)).toBe(
      'Đã gửi minhanh@minhan.vn cho Nguyễn Minh Anh; [MST_9] không có.',
    );
  });

  it('uses the same placeholder for the same value and keeps amounts and codes intact', () => {
    const r = createRedactor();
    expect(r.text('0312345673 và 0312345673; +84 912 345 678')).toBe('[MST_1] và [MST_1]; [SĐT_1]');
    // Amounts, document codes and dates are what answers are made of.
    expect(r.text('CT-1027 ngày 2026-10-30: 3680000 đ, nhóm DS-1032, 25.412.700 đ')).toBe(
      'CT-1027 ngày 2026-10-30: 3680000 đ, nhóm DS-1032, 25.412.700 đ',
    );
    // A 10-digit number without a valid check digit and not a phone number is left alone.
    expect(r.text('mã đơn 1234567890')).toBe('mã đơn 1234567890');
  });

  it('redacts structured tool data by key, never amounts', () => {
    const r = createRedactor();
    const out = r.value({
      supplier: 'Nguyên liệu Việt',
      taxCode: '0312345673',
      contact: { email: 'kt@nlv.vn', phone: '0283 456 7890' },
      bankAccount: '0071000123456',
      total: '1234567890',
      rows: [{ amount: '0912345678', description: 'CK tu 0912345678' }],
    });
    expect(out).toEqual({
      supplier: 'Nguyên liệu Việt',
      taxCode: '[MST_1]',
      contact: { email: '[EMAIL_1]', phone: '[SĐT_1]' },
      bankAccount: '[STK_1]',
      total: '1234567890',
      rows: [{ amount: '0912345678', description: 'CK tu [SĐT_2]' }],
    });
  });
});
