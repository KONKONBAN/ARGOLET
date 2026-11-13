import { describe, expect, it } from 'vitest';
import { assessAuthenticity, parseEInvoiceXml, readImageMeta, type AuthenticityInput } from '../src';

const xml = (
  o: {
    seller?: string;
    buyer?: string;
    series?: string;
    mccqt?: boolean;
    signed?: boolean;
    vat?: string;
    pay?: string;
  } = {},
) =>
  parseEInvoiceXml(`<HDon><DLHDon><TTChung><KHMSHDon>1</KHMSHDon><KHHDon>${o.series ?? 'C26TAA'}</KHHDon><SHDon>0000123</SHDon>
  <NLap>2026-11-10</NLap><DVTTe>VND</DVTTe><HTTToan>${o.pay ?? 'CK'}</HTTToan></TTChung><NDHDon>
  <NBan><Ten>Công ty TNHH Bột mì Sao Vàng</Ten><MST>${o.seller ?? '0100109106'}</MST></NBan>
  <NMua><Ten>Tiệm bánh Thu Hà</Ten><MST>${o.buyer ?? '0300588569'}</MST></NMua>
  <DSHHDVu><HHDVu><THHDVu>Bột mì</THHDVu><ThTien>6000000</ThTien><TSuat>10%</TSuat></HHDVu></DSHHDVu>
  <TToan><THTTLTSuat><LTSuat><TSuat>10%</TSuat><ThTien>6000000</ThTien><TThue>${o.vat ?? '600000'}</TThue></LTSuat></THTTLTSuat>
  <TgTCThue>6000000</TgTCThue><TgTThue>${o.vat ?? '600000'}</TgTThue><TgTTTBSo>${6_000_000 + Number(o.vat ?? 600_000)}</TgTTTBSo></TToan>
  </NDHDon></DLHDon>${o.mccqt === false ? '' : '<MCCQT>00ABCDEF0123456789</MCCQT>'}
  ${o.signed === false ? '' : '<DSCKS><NBan><Signature/></NBan></DSCKS>'}</HDon>`);

const base = (over: Partial<AuthenticityInput> = {}): AuthenticityInput => {
  const inv = over.invoice === undefined ? xml() : over.invoice;
  return {
    today: '2026-11-13',
    kind: 'EXPENSE',
    sourceKind: 'XML_EINVOICE',
    fields: {
      supplier: inv?.sellerName ?? 'Bột mì Sao Vàng',
      documentNo: '0000123',
      documentDate: '2026-11-10',
      total: inv?.totalVnd ?? '6600000',
      taxCode: inv?.sellerTaxCode ?? '0100109106',
      series: inv?.symbol,
    },
    invoice: inv,
    organisationTaxCode: '0300588569',
    history: [],
    ...over,
  };
};
const status = (r: ReturnType<typeof assessAuthenticity>, code: string) =>
  r.checks.find((c) => c.code === code)?.status;

describe('authenticity checks', () => {
  it('a well-formed, signed invoice addressed to us is low risk', () => {
    const r = assessAuthenticity(base());
    expect(r.level).toBe('LOW');
    expect(r.checks.filter((c) => c.status === 'FAIL' || c.status === 'WARN')).toEqual([]);
    expect(r.lookupUrl).toBe('https://hoadondientu.gdt.gov.vn/');
  });

  it('flags a forged tax code, a missing signature or tax-authority code, and a wrong year', () => {
    expect(status(assessAuthenticity(base({ invoice: xml({ seller: '0100109107' }) })), 'TAX_CODE')).toBe(
      'FAIL',
    );
    expect(status(assessAuthenticity(base({ invoice: xml({ signed: false }) })), 'SIGNATURE')).toBe('FAIL');
    expect(status(assessAuthenticity(base({ invoice: xml({ mccqt: false }) })), 'TAX_AUTHORITY_CODE')).toBe(
      'FAIL',
    );
    expect(
      status(
        assessAuthenticity(base({ invoice: xml({ mccqt: false, series: 'K26TAA' }) })),
        'TAX_AUTHORITY_CODE',
      ),
    ).toBe('NA');
    expect(status(assessAuthenticity(base({ invoice: xml({ series: 'C25TAA' }) })), 'SYMBOL')).toBe('FAIL');
    expect(assessAuthenticity(base({ invoice: xml({ signed: false }) })).level).toBe('HIGH');
  });

  it('flags an invoice issued to another company and VAT that does not match the rate', () => {
    expect(status(assessAuthenticity(base({ invoice: xml({ buyer: '0100109106' }) })), 'ADDRESSEE')).toBe(
      'FAIL',
    );
    expect(status(assessAuthenticity(base({ invoice: xml({ vat: '500000' }) })), 'ARITHMETIC')).toBe('FAIL');
  });

  it('flags duplicates of the file or of the invoice identity', () => {
    expect(status(assessAuthenticity(base({ duplicateFileOf: 'CT-0001' })), 'DUPLICATE_FILE')).toBe('FAIL');
    expect(status(assessAuthenticity(base({ sameDocumentAs: 'CT-0002' })), 'DUPLICATE_DOCUMENT')).toBe(
      'FAIL',
    );
  });

  it('warns about an unusual amount, cash payment over 5 million and invoices split under it', () => {
    const history = ['1000000', '1200000', '900000'].map((total, k) => ({
      code: `CT-${k}`,
      supplier: 'Công ty TNHH Bột mì Sao Vàng',
      taxCode: '0100109106',
      total,
      date: '2026-10-0' + (k + 1),
    }));
    expect(status(assessAuthenticity(base({ history })), 'AMOUNT')).toBe('WARN');
    expect(status(assessAuthenticity(base({ invoice: xml({ pay: 'TM' }) })), 'NON_CASH')).toBe('WARN');
    const split = assessAuthenticity(
      base({
        invoice: null,
        sourceKind: 'PHOTO',
        fields: {
          supplier: 'Cửa hàng Vật tư A',
          documentNo: 'BL-2',
          documentDate: '2026-11-10',
          total: '4800000',
        },
        history: [{ code: 'CT-9', supplier: 'Cửa hàng Vật tư A', total: '4900000', date: '2026-11-10' }],
      }),
    );
    expect(split.checks.find((c) => c.code === 'NON_CASH')?.detail).toMatch(/tách hóa đơn/);
  });

  it('warns when the same supplier name comes with another tax code', () => {
    const r = assessAuthenticity(
      base({
        history: [
          {
            code: 'CT-7',
            supplier: 'Cty TNHH Bột Mì Sao Vàng',
            taxCode: '0300588569',
            total: '1',
            date: '2026-10-01',
          },
        ],
      }),
    );
    expect(status(r, 'IDENTITY')).toBe('WARN');
  });
});

describe('photo metadata', () => {
  it('reads the editing software from EXIF and ignores non-JPEG data', () => {
    // Minimal JPEG: SOI, APP1 "Exif" with a little-endian TIFF holding Software = "Adobe Photoshop 25.0".
    const software = 'Adobe Photoshop 25.0\0';
    const tiff = [
      0x49,
      0x49,
      0x2a,
      0x00,
      8,
      0,
      0,
      0,
      1,
      0,
      0x31,
      0x01,
      2,
      0,
      software.length,
      0,
      0,
      0,
      26,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ];
    const body = [...tiff, ...software.split('').map((c) => c.charCodeAt(0))];
    const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...body];
    const len = app1.length + 2;
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...app1, 0xff, 0xda, 0, 2]);
    expect(readImageMeta(jpeg).software).toBe('Adobe Photoshop 25.0');
    const r = assessAuthenticity(
      base({
        invoice: null,
        sourceKind: 'PHOTO',
        imageMeta: readImageMeta(jpeg),
        fields: { supplier: 'A', documentNo: '1', documentDate: '2026-11-10', total: '100000' },
      }),
    );
    expect(status(r, 'IMAGE_EDIT')).toBe('WARN');
    expect(readImageMeta(new Uint8Array([1, 2, 3]))).toEqual({});
  });
});
