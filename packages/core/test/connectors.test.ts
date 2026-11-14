import { describe, expect, it } from 'vitest';
import { isConnectorSnapshot, readKiotVietInvoices, readSepayTransactions, SNAPSHOT_FORMAT } from '../src';

/** Response sample from developer.sepay.vn (API v2 · danh sách giao dịch), plus a debit. */
const sepayPage = {
  status: 'success',
  data: [
    {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      transaction_date: '2026-02-18 09:35:12',
      account_number: '0123456789',
      va: 'VA001',
      transfer_type: 'in',
      amount_in: 500000,
      amount_out: 0,
      accumulated: 1500000,
      transaction_content: 'Thanh toan don hang #123',
      reference_number: 'FT26069ABC',
      code: null,
      bank_brand_name: 'ACB',
      bank_account_id: 'f9e8d7c6-b5a4-3210-fedc-ba0987654321',
      va_id: 'a2b3c4d5-e6f7-8901-bcde-f12345678901',
      webhook_success: 1,
    },
    {
      id: 'b2c3d4e5-f6a7-8901-bcde-f12345678902',
      transaction_date: '2026-02-18T15:00:00+07:00',
      account_number: '0123456789',
      transfer_type: 'out',
      amount_in: 0,
      amount_out: 120000,
      transaction_content: 'Phi dich vu thang 2',
      reference_number: '',
      bank_brand_name: 'ACB',
    },
  ],
  meta: { pagination: { total: 2, per_page: 20, current_page: 1, last_page: 1, has_more: false } },
};

/** Fields of KiotViet Public API 2.12.1 (lấy danh sách hóa đơn). */
const kiotPage = {
  total: 3,
  pageSize: 100,
  data: [
    {
      id: 1001,
      code: 'HD000101',
      purchaseDate: '2026-11-10T09:12:33.1230000',
      branchId: 1,
      branchName: 'Chi nhánh trung tâm',
      customerName: 'Khách lẻ',
      total: 350000,
      totalPayment: 350000,
      status: 1,
      statusValue: 'Hoàn thành',
      payments: [
        { id: 1, code: 'TT1', amount: 200000, method: 'Cash' },
        { id: 2, code: 'TT2', amount: 150000, method: 'Transfer' },
      ],
    },
    { id: 1002, code: 'HD000102', purchaseDate: '2026-11-10T10:00:00', total: 90000, status: 2 },
    { id: 1003, code: 'HD000103', purchaseDate: '2026-11-10T11:00:00', total: 50000, status: 3 },
  ],
};

describe('partner snapshots', () => {
  it('reads SePay v2 transactions: credit minus debit, date, reference', () => {
    expect(readSepayTransactions([sepayPage, sepayPage])).toEqual([
      {
        externalId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        date: '2026-02-18',
        amount: '500000',
        reference: 'FT26069ABC',
        description: 'Thanh toan don hang #123',
        account: '0123456789',
        bank: 'ACB',
      },
      {
        externalId: 'b2c3d4e5-f6a7-8901-bcde-f12345678902',
        date: '2026-02-18',
        amount: '-120000',
        reference: 'b2c3d4e5-f6a7-8901-bcde-f12345678902',
        description: 'Phi dich vu thang 2',
        account: '0123456789',
        bank: 'ACB',
      },
    ]);
  });

  it('refuses an error response or a malformed amount instead of guessing', () => {
    expect(() =>
      readSepayTransactions([{ status: 'error', message: 'Too many requests', error_code: 'rate_limited' }]),
    ).toThrow(/không đúng định dạng/);
    expect(() =>
      readSepayTransactions([
        { status: 'success', data: [{ id: 'x', transaction_date: '2026-02-18', amount_in: '1.000' }] },
      ]),
    ).toThrow(/số tiền không hợp lệ/);
  });

  it('reads KiotViet invoices: completed sales only, payments by method', () => {
    const r = readKiotVietInvoices([kiotPage]);
    expect(r.skipped).toEqual({ cancelled: 1, pending: 1 });
    expect(r.sales).toEqual([
      {
        externalId: '1001',
        code: 'HD000101',
        date: '2026-11-10',
        total: '350000',
        paid: '350000',
        customer: 'Khách lẻ',
        branch: 'Chi nhánh trung tâm',
        channel: '',
        payments: 'Tiền mặt 200.000 · Chuyển khoản 150.000',
      },
    ]);
  });

  it('recognises the snapshot envelope', () => {
    expect(
      isConnectorSnapshot({
        format: SNAPSHOT_FORMAT,
        provider: 'SEPAY',
        resource: 'transactions',
        fetchedAt: '2026-11-14T00:00:00.000Z',
        query: {},
        pages: [],
      }),
    ).toBe(true);
    expect(isConnectorSnapshot({ provider: 'SEPAY', pages: [] })).toBe(false);
  });
});
