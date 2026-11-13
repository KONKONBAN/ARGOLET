import { describe, expect, it } from 'vitest';
import {
  documentKey,
  invoiceSymbolProblems,
  parseEInvoiceXml,
  splitInvoiceSymbol,
  taxCodeChecksumOk,
  withTaxCodeCheckDigit,
} from '../src';

/** A complete invoice in the General Department of Taxation format (QĐ 1450/QĐ-TCT). */
const invoice = ({
  currency = 'VND',
  rate = '',
  lines = '',
  totals = '',
  extra = '',
}: {
  currency?: string;
  rate?: string;
  lines?: string;
  totals?: string;
  extra?: string;
}) => `<?xml version="1.0" encoding="UTF-8"?>
<HDon>
  <DLHDon Id="data">
    <TTChung>
      <PBan>2.1.0</PBan><THDon>HÓA ĐƠN GIÁ TRỊ GIA TĂNG</THDon>
      <KHMSHDon>1</KHMSHDon><KHHDon>C26TAA</KHHDon><SHDon>0000123</SHDon>
      <NLap>2026-11-10</NLap><DVTTe>${currency}</DVTTe>${rate ? `<TGia>${rate}</TGia>` : ''}<HTTToan>TM/CK</HTTToan>
      ${extra}
    </TTChung>
    <NDHDon>
      <NBan><Ten>Công ty TNHH Bột mì Sao Vàng</Ten><MST>0100109106</MST><DChi>Hà Nội</DChi></NBan>
      <NMua><Ten>Tiệm bánh Thu Hà</Ten><MST>0300588569</MST></NMua>
      <DSHHDVu>${lines}</DSHHDVu>
      <TToan>${totals}</TToan>
    </NDHDon>
  </DLHDon>
  <MCCQT Id="cqt">00A1B2C3D4E5F60718293A4B5C6D7E8F90</MCCQT>
  <DSCKS><NBan><Signature><KeyInfo><X509Data><X509Certificate>MIIBdemo==</X509Certificate></X509Data></KeyInfo></Signature></NBan></DSCKS>
</HDon>`;

describe('e-invoice XML (TT78 / QĐ 1450)', () => {
  it('reads goods, promotion, commercial discount and note lines with their signs', () => {
    const inv = parseEInvoiceXml(
      invoice({
        lines: `
          <HHDVu><TChat>1</TChat><STT>1</STT><THHDVu>Bột mì số 11</THHDVu><DVTinh>bao</DVTinh><SLuong>10</SLuong><DGia>500000</DGia><ThTien>5000000</ThTien><TSuat>8%</TSuat></HHDVu>
          <HHDVu><TChat>2</TChat><STT>2</STT><THHDVu>Bao bì khuyến mại</THHDVu><SLuong>2</SLuong><ThTien>0</ThTien><TSuat>8%</TSuat></HHDVu>
          <HHDVu><TChat>3</TChat><STT>3</STT><THHDVu>Chiết khấu thương mại 2%</THHDVu><ThTien>100000</ThTien><TSuat>8%</TSuat></HHDVu>
          <HHDVu><TChat>4</TChat><STT>4</STT><THHDVu>Giao hàng tại kho</THHDVu></HHDVu>`,
        totals: `<THTTLTSuat><LTSuat><TSuat>8%</TSuat><ThTien>4900000</ThTien><TThue>392000</TThue></LTSuat></THTTLTSuat>
          <TgTCThue>4900000</TgTCThue><TgTThue>392000</TgTThue><TgTTTBSo>5292000</TgTTTBSo><TgTTTBChu>Năm triệu hai trăm chín mươi hai nghìn đồng</TgTTTBChu>`,
      }),
    );
    expect(inv.symbol).toBe('1C26TAA');
    expect(inv.documentNo).toBe('0000123');
    expect(inv.lines.map((l) => [l.kind, l.amount])).toEqual([
      ['GOODS', '5000000'],
      ['PROMOTION', '0'],
      ['DISCOUNT', '-100000'],
      ['NOTE', '0'],
    ]);
    expect(inv.rates).toEqual([{ rate: '8%', taxable: '4900000', vat: '392000' }]);
    expect([inv.subtotalVnd, inv.vatVnd, inv.totalVnd]).toEqual(['4900000', '392000', '5292000']);
    expect(inv.inconsistencies).toEqual([]);
    expect(inv.taxAuthorityCode).toMatch(/^00A1/);
    expect(inv.sellerSigned).toBe(true);
    expect(inv.certificates).toEqual(['MIIBdemo==']);
  });

  it('keeps several VAT rates apart and checks each against its taxable amount', () => {
    const inv = parseEInvoiceXml(
      invoice({
        lines: `<HHDVu><THHDVu>Sữa</THHDVu><ThTien>1000000</ThTien><TSuat>5%</TSuat></HHDVu>
                <HHDVu><THHDVu>Dịch vụ giao hàng</THHDVu><ThTien>200000</ThTien><TSuat>10%</TSuat></HHDVu>
                <HHDVu><THHDVu>Sách</THHDVu><ThTien>50000</ThTien><TSuat>KCT</TSuat></HHDVu>`,
        totals: `<THTTLTSuat>
            <LTSuat><TSuat>5%</TSuat><ThTien>1000000</ThTien><TThue>50000</TThue></LTSuat>
            <LTSuat><TSuat>10%</TSuat><ThTien>200000</ThTien><TThue>20000</TThue></LTSuat>
            <LTSuat><TSuat>KCT</TSuat><ThTien>50000</ThTien><TThue>0</TThue></LTSuat>
          </THTTLTSuat><TgTCThue>1250000</TgTCThue><TgTThue>70000</TgTThue><TgTTTBSo>1320000</TgTTTBSo>`,
      }),
    );
    expect(inv.rates.map((r) => r.rate)).toEqual(['5%', '10%', 'KCT']);
    expect(inv.inconsistencies).toEqual([]);
  });

  it('flags totals that do not add up instead of trusting them', () => {
    const inv = parseEInvoiceXml(
      invoice({
        lines: `<HHDVu><THHDVu>Bột mì</THHDVu><ThTien>2500000</ThTien><TSuat>10%</TSuat></HHDVu>`,
        totals: `<THTTLTSuat><LTSuat><TSuat>10%</TSuat><ThTien>2500000</ThTien><TThue>200000</TThue></LTSuat></THTTLTSuat>
                 <TgTCThue>2500000</TgTCThue><TgTThue>200000</TgTThue><TgTTTBSo>2750000</TgTTTBSo>`,
      }),
    );
    expect(inv.inconsistencies).toHaveLength(2);
    expect(inv.inconsistencies.join(' ')).toMatch(
      /Thuế suất 10%: 2500000 × 10% = 250000, hóa đơn ghi 200000/,
    );
    expect(inv.inconsistencies.join(' ')).toMatch(/khác tổng thanh toán/);
  });

  it('converts a foreign-currency invoice to VND with the invoice exchange rate', () => {
    const inv = parseEInvoiceXml(
      invoice({
        currency: 'USD',
        rate: '25400',
        lines: `<HHDVu><THHDVu>Phần mềm</THHDVu><ThTien>1000.50</ThTien><TSuat>10%</TSuat></HHDVu>`,
        totals: `<TgTCThue>1000.50</TgTCThue><TgTThue>100.05</TgTThue><TgTTTBSo>1100.55</TgTTTBSo>`,
      }),
    );
    expect(inv.currency).toBe('USD');
    expect([inv.subtotalVnd, inv.vatVnd, inv.totalVnd]).toEqual(['25412700', '2541270', '27953970']);
    expect(() =>
      parseEInvoiceXml(
        invoice({
          currency: 'USD',
          lines: '<HHDVu><ThTien>10</ThTien></HHDVu>',
          totals: '<TgTTTBSo>10</TgTTTBSo>',
        }),
      ),
    ).not.toThrow();
    const noRate = parseEInvoiceXml(
      invoice({
        currency: 'USD',
        lines: '<HHDVu><ThTien>10</ThTien></HHDVu>',
        totals: '<TgTTTBSo>10</TgTTTBSo>',
      }),
    );
    expect(noRate.inconsistencies.join(' ')).toMatch(/thiếu tỷ giá/);
  });

  it('reads replacement / adjustment links to the original invoice', () => {
    const inv = parseEInvoiceXml(
      invoice({
        lines: `<HHDVu><ThTien>100000</ThTien></HHDVu>`,
        totals: `<TgTTTBSo>100000</TgTTTBSo>`,
        extra: `<TTHDLQuan><TCHDon>2</TCHDon><KHMSHDCLQuan>1</KHMSHDCLQuan><KHHDCLQuan>C26TAA</KHHDCLQuan><SHDCLQuan>0000099</SHDCLQuan><NLHDCLQuan>2026-10-01</NLHDCLQuan></TTHDLQuan>`,
      }),
    );
    expect(inv.related).toEqual({
      kind: 'ADJUSTMENT',
      symbol: '1C26TAA',
      documentNo: '0000099',
      issueDate: '2026-10-01',
    });
  });

  it('rejects malformed amounts rather than guessing', () => {
    expect(() =>
      parseEInvoiceXml(invoice({ lines: '<HHDVu><ThTien>1.250.000</ThTien></HHDVu>', totals: '' })),
    ).toThrow(/Số tiền không hợp lệ/);
  });
});

describe('identifiers', () => {
  it('validates tax codes with the check digit', () => {
    expect(taxCodeChecksumOk('0100109106')).toBe(true);
    expect(taxCodeChecksumOk('0300588569')).toBe(true);
    expect(taxCodeChecksumOk('0300588569-001')).toBe(true);
    expect(taxCodeChecksumOk('0312345678')).toBe(false);
    expect(taxCodeChecksumOk('031234567')).toBe(false);
    expect(taxCodeChecksumOk(withTaxCodeCheckDigit('031234567'))).toBe(true);
  });

  it('checks invoice symbols (Nghị định 123) including the year', () => {
    expect(splitInvoiceSymbol('', '1C26TAA')).toEqual({ formNo: '1', series: 'C26TAA', symbol: '1C26TAA' });
    expect(invoiceSymbolProblems({ formNo: '1', series: 'C26TAA' }, '2026-11-10')).toEqual([]);
    expect(invoiceSymbolProblems({ formNo: '1', series: 'C25TAA' }, '2026-11-10')[0]).toMatch(
      /Năm trong ký hiệu/,
    );
    expect(invoiceSymbolProblems({ formNo: '9', series: 'X26TA' }, '2026-11-10')).toHaveLength(2);
  });

  it('identifies an invoice by tax code, symbol and number — not by how the name is spelt', () => {
    const a = documentKey({
      supplier: 'Công ty TNHH ABC',
      documentNo: '0000123',
      taxCode: '0100109106',
      series: '1C26TAA',
    });
    const b = documentKey({
      supplier: 'Cty TNHH ABC',
      documentNo: '123',
      taxCode: '0100109106',
      series: '1C26TAA',
    });
    const nextYear = documentKey({
      supplier: 'Công ty TNHH ABC',
      documentNo: '123',
      taxCode: '0100109106',
      series: '1C27TAA',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(nextYear);
  });
});
