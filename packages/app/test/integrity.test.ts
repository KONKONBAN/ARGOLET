/**
 * The fingerprint of a source file is taken over its exact bytes. A file saved with a BOM and
 * CRLF line endings (typical of Excel / Windows tools) must verify against itself, and the
 * "original" offered for download must reproduce those bytes.
 */
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@argolet/core';
import { createArgoletApp, MemoryStore, type CallContext } from '../src';
import { fastHasher } from './helpers';

const clock = () => new Date('2026-11-12T03:00:00Z');
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

async function newOrg() {
  const store = new MemoryStore(undefined, undefined, () => clock().toISOString());
  const app = createArgoletApp({ store, hasher: fastHasher, clock, config: { exposeDevCodes: true } });
  const reg = await app.auth.register(
    { channel: 'web' },
    { fullName: 'Kế Toán', contact: 'kt@vidu.vn', password: 'Mat-khau-that-dai-2026', acceptTerms: true },
  );
  const v = await app.auth.verifyContact({ channel: 'web' }, { contact: 'kt@vidu.vn', code: reg.devCode! });
  const call: CallContext = { sessionToken: v.token, channel: 'web' };
  await app.org.createOrganization(call, { name: 'Cửa hàng Ví Dụ', orgType: 'Hộ kinh doanh' });
  return { app, call };
}

describe('byte-exact source files', () => {
  it('fingerprints the exact bytes of a UTF-8 file with BOM and CRLF, and reproduces them', async () => {
    const { app, call } = await newOrg();
    const csv =
      'Ngày giao dịch,Mã tham chiếu,Nội dung,Ghi có,Ghi nợ,Đối tác\r\n06/11/2026,FT1,GF-PAY-1106 thanh toán,693000,,GRAB VIỆT NAM\r\n';
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(csv)]);
    const r = await app.documents.intake(call, {
      files: [{ name: 'sao-ke.csv', mime: 'text/csv', contentBase64: b64(bytes) }],
    });
    const docId = r.files[0]!.documentId;
    const doc = await app.documents.getDocument(call, { documentId: docId });
    expect(doc.artifact!.rawSha256).toBe(sha256Hex(bytes));
    expect(doc.document.rowKind).toBe('BANK'); // BOM did not break header detection
    await app.documents.confirmDocument(call, { documentId: docId });

    const integ = await app.evidence.integrityInfo(call, { documentId: docId });
    expect(integ.hasOriginal).toBe(true);
    const rebuilt = new Uint8Array([
      ...(integ.originalBom ? [0xef, 0xbb, 0xbf] : []),
      ...new TextEncoder().encode(integ.originalContent!),
    ]);
    expect(sha256Hex(rebuilt)).toBe(sha256Hex(bytes));

    expect((await app.evidence.verifyDocument(call, { documentId: docId, fileBase64: b64(bytes) })).ok).toBe(
      true,
    );
    const tampered = new Uint8Array(bytes);
    tampered[tampered.length - 5] = 0x39; // one digit changed
    expect(
      (await app.evidence.verifyDocument(call, { documentId: docId, fileBase64: b64(tampered) })).ok,
    ).toBe(false);
  });

  it('reads UTF-16 exports (Excel "Unicode text") but does not offer them as a byte-exact original', async () => {
    const { app, call } = await newOrg();
    const csv =
      'Mã đơn,Ngày,Giá trị,Phí,Mã lô chi trả,Kênh\r\nGF-1,05/11/2026,450000,45000,GF-PAY-1,GrabFood\r\n';
    const body = new Uint8Array(csv.length * 2);
    for (let i = 0; i < csv.length; i++) {
      body[i * 2] = csv.charCodeAt(i) & 0xff;
      body[i * 2 + 1] = csv.charCodeAt(i) >> 8;
    }
    const bytes = new Uint8Array([0xff, 0xfe, ...body]);
    const r = await app.documents.intake(call, {
      files: [{ name: 'don-hang.csv', contentBase64: b64(bytes) }],
    });
    const doc = await app.documents.getDocument(call, { documentId: r.files[0]!.documentId });
    expect(doc.document.rowKind).toBe('POS');
    expect(doc.document.rows[0]!.amount).toBe('450000');
    expect(doc.artifact!.rawSha256).toBe(sha256Hex(bytes));
    await app.documents.confirmDocument(call, { documentId: r.files[0]!.documentId });
    expect((await app.evidence.integrityInfo(call, { documentId: r.files[0]!.documentId })).hasOriginal).toBe(
      false,
    );
    expect(
      (
        await app.evidence.verifyDocument(call, {
          documentId: r.files[0]!.documentId,
          fileBase64: b64(bytes),
        })
      ).ok,
    ).toBe(true);
  });
});
