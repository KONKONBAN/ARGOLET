import { describe, expect, it } from 'vitest';
import { buildXlsx, crc32, hkdForms, sheetS1a, sheetS2a, sheetS2c, sheetS2e, type XSheet } from '../src';

const h = {
  name: 'Tiệm bánh Thu Hà',
  address: '12 Nguyễn Trãi, TP. Hồ Chí Minh',
  taxCode: '8765432103',
  location: 'Cửa hàng Nguyễn Trãi',
  period: 'Tháng 11/2026',
};
const lines = [
  { docNo: 'CT-0001', date: '2026-11-01', description: 'Doanh thu ngày 01/11', amount: '3450000' },
  { docNo: 'CT-0002', date: '2026-11-02', description: 'Doanh thu ngày 02/11', amount: '5120000' },
];
const texts = (s: XSheet) =>
  s.rows
    .flat()
    .filter(Boolean)
    .map((c) => c!.v);
const rowWith = (s: XSheet, label: string) => s.rows.find((r) => r.some((c) => c?.v === label))!;
const amountOf = (s: XSheet, label: string) =>
  rowWith(s, label)
    .filter((c) => typeof c?.v === 'number' || c?.f)
    .at(-1);

describe('accounting books on the Ministry of Finance forms (Thông tư 152/2025/TT-BTC)', () => {
  it('chooses the forms by how the household pays VAT and PIT (Điều 4, 5, 6)', () => {
    expect(hkdForms('EXEMPT')).toEqual(['S1a-HKD']);
    expect(hkdForms('PERCENT')).toEqual(['S2a-HKD']);
    expect(hkdForms('INCOME')).toEqual(['S2b-HKD', 'S2c-HKD', 'S2e-HKD']);
  });

  it('S1a-HKD carries the form number, legal basis, columns A B 1, total and signature', () => {
    const s = sheetS1a(h, lines);
    const t = texts(s);
    expect(t).toEqual(
      expect.arrayContaining([
        'HỘ, CÁ NHÂN KINH DOANH: Tiệm bánh Thu Hà',
        'Mẫu số S1a-HKD',
        '(Kèm theo Thông tư số 152/2025/TT-BTC ngày 31 tháng 12 năm 2025 của Bộ trưởng Bộ Tài chính)',
        'SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ',
        'Kỳ kê khai: Tháng 11/2026',
        'Ngày tháng',
        'Diễn giải',
        'Số tiền',
        'A',
        'B',
        '1',
        '01/11/2026',
        'NGƯỜI ĐẠI DIỆN HỘ KINH DOANH/ CÁ NHÂN KINH DOANH',
        '(Ký, ghi rõ họ tên, đóng dấu (nếu có))',
      ]),
    );
    expect(amountOf(s, 'Tổng cộng')).toMatchObject({ v: 8570000, f: 'SUM(D11:D12)' });
  });

  it('S2a-HKD computes VAT and PIT per business line from the configured rates, rounded to the đồng', () => {
    const s = sheetS2a(h, [
      { name: 'Phân phối, cung cấp hàng hóa', vatRate: '1', pitRate: '0.5', lines },
      { name: 'Dịch vụ', vatRate: '5', pitRate: '2', lines: [{ ...lines[0]!, amount: '1234567' }] },
    ]);
    expect(amountOf(s, 'Tổng cộng (1)')).toMatchObject({ v: 8570000 });
    expect(amountOf(s, 'Thuế GTGT (1%)')).toMatchObject({ v: 85700 });
    expect(amountOf(s, 'Thuế TNCN (0.5%)')).toMatchObject({ v: 42850 });
    expect(amountOf(s, 'Thuế GTGT (5%)')).toMatchObject({ v: 61728 }); // 61 728.35 → 61 728
    expect(amountOf(s, 'Thuế TNCN (2%)')).toMatchObject({ v: 24691 }); // 24 691.34 → 24 691
    expect(amountOf(s, 'Tổng số thuế GTGT phải nộp')).toMatchObject({ v: 85700 + 61728 });
    expect(amountOf(s, 'Tổng số thuế TNCN phải nộp')).toMatchObject({ v: 42850 + 24691 });
  });

  it('never invents a tax rate: unconfigured lines leave the tax cells blank with a note', () => {
    const s = sheetS2a(h, [{ name: 'Bán lẻ', lines }]);
    expect(rowWith(s, 'Thuế GTGT').some((c) => typeof c?.v === 'number')).toBe(false);
    expect(texts(s).some((v) => String(v).startsWith('Ghi chú: chưa khai báo tỷ lệ'))).toBe(true);
  });

  it('S2c-HKD: revenue, the six cost captions a)–e), difference and PIT on the difference', () => {
    const s = sheetS2c(
      h,
      lines,
      { a: [{ docNo: 'CT-3', date: '2026-11-03', description: 'Bột mì', amount: '2750000' }] },
      '15',
    );
    const t = texts(s).map(String);
    for (const prefix of [
      'a) Chi phí nguyên liệu',
      'b) Chi phí tiền lương',
      'c) Chi phí khấu hao',
      'd) Chi phí dịch vụ mua ngoài',
      'đ) Chi phí trả lãi',
      'e) Các khoản chi khác',
    ])
      expect(t.some((v) => v.startsWith(prefix))).toBe(true);
    expect(amountOf(s, '2. Chi phí hợp lý')).toMatchObject({ v: 2750000 });
    expect(amountOf(s, '3. Chênh lệch {(3) = (1) - (2)}')).toMatchObject({ v: 5820000 });
    const pitRow = s.rows.find((r) => r.some((c) => String(c?.v ?? '').startsWith('4. Tổng số thuế TNCN')))!;
    expect(pitRow.find((c) => typeof c?.v === 'number')).toMatchObject({ v: 873000 });
  });

  it('S2e-HKD: no closing balance without an opening one; computed when the opening is known', () => {
    const blank = sheetS2e(h, [
      {
        name: 'VCB · 0123',
        kind: 'BANK',
        lines: [{ docNo: 'FT1', date: '2026-11-02', description: 'Thu', amount: '3200000' }],
      },
    ]);
    expect(rowWith(blank, 'Tiền gửi cuối kỳ').find((c) => c?.f)).toMatchObject({ v: '' });
    const known = sheetS2e(h, [
      {
        name: 'VCB · 0123',
        kind: 'BANK',
        opening: '1000000',
        lines: [
          { docNo: 'FT1', date: '2026-11-02', description: 'Thu', amount: '3200000' },
          { docNo: 'FT2', date: '2026-11-03', description: 'Chi', amount: '-2750000' },
        ],
      },
    ]);
    expect(rowWith(known, 'Tiền gửi cuối kỳ').find((c) => c?.f)).toMatchObject({ v: 1450000 });
  });
});

describe('xlsx writer', () => {
  it('writes a valid ZIP package with the workbook parts', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
    const bytes = buildXlsx([sheetS1a(h, lines)], {
      title: 'Sổ',
      author: 'ARGOLET',
      created: new Date('2026-11-14T00:00:00Z'),
    });
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = new TextDecoder().decode(bytes);
    for (const part of [
      '[Content_Types].xml',
      'xl/workbook.xml',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ])
      expect(text).toContain(part);
    expect(text).toContain('<sheet name="S1a-HKD"');
    expect(text).toContain('<f>SUM(D11:D12)</f>');
    expect(text).toContain('paperSize="9"');
  });
});
