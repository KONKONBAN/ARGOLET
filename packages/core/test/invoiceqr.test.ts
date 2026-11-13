import { describe, expect, it } from 'vitest';
import {
  assessAuthenticity,
  buildInvoiceQr,
  compareQrWithDocument,
  crc16Ccitt,
  parseEInvoiceXml,
  parseInvoiceQr,
  parseTlv,
  readQrContent,
} from '../src';

/** Phụ lục XIII — the example printed in the regulation, character for character. */
const OFFICIAL =
  '00020101021202142657895426548904141568265489515426280010A000000775' +
  '0110010700172952045499530370454061200005802VN5905DNXYZ6005HANO' +
  'I62400115S757CK5HTIE918E0307SHOPXYZ0706XYZ00199740010A0000007' +
  '7501130107001729001020110306C21TYY0402680508202111210606120000630' +
  '4383C';

describe('e-invoice QR code (QĐ 1450, Khoản 7 Mục IV Phần I)', () => {
  it('reads the official example and verifies its CRC', () => {
    const qr = parseInvoiceQr(OFFICIAL)!;
    expect(qr).toMatchObject({
      version: '01',
      crcOk: true,
      sellerTaxCode: '0107001729-001',
      formNo: '1',
      series: 'C21TYY',
      symbol: '1C21TYY',
      documentNo: '68',
      issueDate: '2021-11-21',
      total: '120000',
      currencyCode: '704',
      paymentAmount: '120000',
      merchantName: 'DNXYZ',
      problems: [],
    });
  });

  it('computes CRC-16/CCITT over the payload including "6304"', () => {
    expect(crc16Ccitt(OFFICIAL.slice(0, -4))).toBe('383C');
    expect(crc16Ccitt('123456789')).toBe('29B1'); // the standard CRC-16/CCITT-FALSE check value
  });

  it('detects a QR whose data was changed after it was generated', () => {
    // Same length, different total (120000 → 129000): the CRC no longer matches.
    const tampered = OFFICIAL.replace('0606120000', '0606129000');
    const qr = parseInvoiceQr(tampered)!;
    expect(qr.crcOk).toBe(false);
    expect(qr.problems.join(' ')).toMatch(/CRC không khớp/);
  });

  it('builds a payload that reads back identically', () => {
    const raw = buildInvoiceQr({
      sellerTaxCode: '0312987656',
      formNo: '1',
      series: 'C26TBM',
      documentNo: '0000215',
      issueDate: '2026-11-09',
      total: '2750000',
    });
    expect(parseInvoiceQr(raw)).toMatchObject({
      crcOk: true,
      sellerTaxCode: '0312987656',
      symbol: '1C26TBM',
      documentNo: '215',
      issueDate: '2026-11-09',
      total: '2750000',
      problems: [],
    });
    expect(parseTlv(raw).map((o) => o.id)).toEqual(['00', '99', '63']);
  });

  it('tells invoice QR codes from links and other codes', () => {
    expect(readQrContent('https://tracuu.example.vn/?ma=ABC123')).toMatchObject({
      kind: 'URL',
      host: 'tracuu.example.vn',
    });
    // A bank transfer QR (TLV without invoice data) is not an invoice QR.
    expect(readQrContent('00020101021138540010A00000072701240006970436011012345678905303704').kind).toBe(
      'OTHER',
    );
    expect(readQrContent('hello').kind).toBe('OTHER');
    expect(parseInvoiceQr('0002019')).toBeNull();
  });

  it('compares the QR with what the document says', () => {
    const qr = parseInvoiceQr(OFFICIAL)!;
    expect(
      compareQrWithDocument(qr, {
        taxCode: '0107001729-001',
        series: '1C21TYY',
        documentNo: '00000068',
        documentDate: '2021-11-21',
        total: '120000',
      }),
    ).toEqual([]);
    expect(compareQrWithDocument(qr, { documentNo: '69', total: '1200000' }).map((d) => d.field)).toEqual([
      'documentNo',
      'total',
    ]);
  });
});

describe('QR in the authenticity checks', () => {
  const xml = (qr: string) =>
    parseEInvoiceXml(`<HDon><DLHDon><TTChung><KHMSHDon>1</KHMSHDon><KHHDon>C26TBM</KHHDon><SHDon>0000215</SHDon><NLap>2026-11-09</NLap><HTTToan>CK</HTTToan></TTChung>
      <NDHDon><NBan><Ten>Công ty TNHH Bột mì Sao Vàng</Ten><MST>0312987656</MST></NBan><NMua><Ten>Tiệm bánh Thu Hà</Ten><MST>8765432103</MST></NMua>
      <DSHHDVu><HHDVu><THHDVu>Bột mì</THHDVu><ThTien>2500000</ThTien><TSuat>10%</TSuat></HHDVu></DSHHDVu>
      <TToan><THTTLTSuat><LTSuat><TSuat>10%</TSuat><ThTien>2500000</ThTien><TThue>250000</TThue></LTSuat></THTTLTSuat>
      <TgTCThue>2500000</TgTCThue><TgTThue>250000</TgTThue><TgTTTBSo>2750000</TgTTTBSo></TToan></NDHDon></DLHDon>
      <DLQRCode>${qr}</DLQRCode><MCCQT>00ABCDEF0123456789</MCCQT><DSCKS><NBan><Signature/></NBan></DSCKS></HDon>`);
  const good = buildInvoiceQr({
    sellerTaxCode: '0312987656',
    formNo: '1',
    series: 'C26TBM',
    documentNo: '215',
    issueDate: '2026-11-09',
    total: '2750000',
  });
  const base = {
    today: '2026-11-13',
    kind: 'EXPENSE' as const,
    organisationTaxCode: '8765432103',
    history: [],
  };
  const fields = {
    supplier: 'Công ty TNHH Bột mì Sao Vàng',
    documentNo: '0000215',
    documentDate: '2026-11-09',
    total: '2750000',
    taxCode: '0312987656',
    series: '1C26TBM',
  };
  const qrCheck = (r: ReturnType<typeof assessAuthenticity>) => r.checks.find((c) => c.code === 'QR');

  it('passes when the XML QR matches the invoice, fails when it does not', () => {
    const ok = assessAuthenticity({ ...base, sourceKind: 'XML_EINVOICE', fields, invoice: xml(good) });
    expect(qrCheck(ok)?.status).toBe('PASS');
    expect(ok.level).toBe('LOW');
    const other = buildInvoiceQr({
      sellerTaxCode: '0312987656',
      formNo: '1',
      series: 'C26TBM',
      documentNo: '216',
      issueDate: '2026-11-09',
      total: '2750000',
    });
    const bad = assessAuthenticity({ ...base, sourceKind: 'XML_EINVOICE', fields, invoice: xml(other) });
    expect(qrCheck(bad)).toMatchObject({ status: 'FAIL' });
    expect(qrCheck(bad)?.detail).toMatch(/Số hóa đơn 216/);
  });

  it('catches a retouched photo: the printed total differs from the QR on it', () => {
    const r = assessAuthenticity({
      ...base,
      sourceKind: 'PHOTO',
      invoice: null,
      fields: { ...fields, total: '7750000' },
      qr: good,
    });
    expect(qrCheck(r)).toMatchObject({ status: 'FAIL' });
    expect(qrCheck(r)?.detail).toMatch(/Tổng tiền thanh toán 2750000.*7750000/);
    const clean = assessAuthenticity({ ...base, sourceKind: 'PHOTO', invoice: null, fields, qr: good });
    expect(qrCheck(clean)?.status).toBe('PASS');
  });

  it('a damaged QR is reported, a provider link is only informative', () => {
    const broken = good.slice(0, -4) + '0000';
    expect(
      qrCheck(assessAuthenticity({ ...base, sourceKind: 'PHOTO', invoice: null, fields, qr: broken }))
        ?.status,
    ).toBe('FAIL');
    expect(
      qrCheck(
        assessAuthenticity({
          ...base,
          sourceKind: 'PHOTO',
          invoice: null,
          fields,
          qr: 'https://tracuu.example.vn/?ma=X',
        }),
      )?.status,
    ).toBe('NA');
  });
});
