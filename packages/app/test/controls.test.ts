/**
 * Controls that protect the books: organisations never see each other's data, read-only members
 * cannot change anything, rejected documents leave no accounting trace, and revoked sessions stop
 * working at once.
 */
import { describe, expect, it } from 'vitest';
import { buildInvoiceQr } from '@argolet/core';
import { DEMO_EMAIL, DEMO_TENANT } from '../src';
import { expectAppError, loginAs, seededApp } from './helpers';

describe('controls', () => {
  it('keeps every organisation’s data to itself', async () => {
    const { app } = await seededApp();
    // The same person is admin of Minh An and only a viewer of An Việt.
    const minhAn = await loginAs(app, DEMO_EMAIL, DEMO_TENANT);
    expect((await app.documents.getDocument(minhAn, { documentId: 'CT-1028' })).document.code).toBe(
      'CT-1028',
    );
    const anViet = await loginAs(app, DEMO_EMAIL, 'ten_anviet');
    await expectAppError(app.documents.getDocument(anViet, { documentId: 'CT-1028' }), 'NOT_FOUND');
    await expectAppError(app.documents.getDocument(anViet, { documentId: 'doc_1028' }), 'NOT_FOUND');
    expect((await app.documents.listDocuments(anViet, {})).total).toBe(0);
    await expectAppError(app.recon.getGroup(anViet, { groupId: 'DS-1031' }), 'NOT_FOUND');
    await expectAppError(app.approvals.get(anViet, { approvalId: 'apv_vpp' }), 'NOT_FOUND');
  });

  it('a read-only member can look but every change is refused', async () => {
    const { app } = await seededApp();
    const viewer = await loginAs(app, DEMO_EMAIL, 'ten_anviet');
    expect((await app.dashboard.overview(viewer)).periodLabel).toBeTruthy();
    const refused = [
      () =>
        app.documents.intake(viewer, {
          files: [{ name: 'a.csv', text: 'Mã đơn,Ngày,Giá trị\nX,01/11/2026,1000' }],
        }),
      () => app.recon.run(viewer, {}),
      () =>
        app.modules.addInventoryItem(viewer, {
          name: 'Bột mì',
          unit: 'kg',
          onHand: '1',
          unitCost: '1000',
          reorderLevel: '0',
        } as never),
      () => app.modules.createProject(viewer, { name: 'Dự án', manager: 'A', budget: '1000' }),
      () =>
        app.finance.createProject(viewer, {
          name: 'Thẩm định',
          assumptions: {
            investment: '100',
            annualCashflow: '30',
            years: 5,
            discountRate: '0.1',
            annualDebtService: '10',
          },
        }),
      () => app.org.inviteMember(viewer, { email: 'a@b.vn', role: 'ACCOUNTANT' }),
      () => app.org.updateSettings(viewer, { accountingRegime: 'TT200' }),
      () => app.org.addEntity(viewer, { kind: 'SITE', name: 'Cơ sở mới' }),
    ];
    for (const call of refused) await expectAppError(call(), 'FORBIDDEN');
  });

  it('a rejected document keeps its reason, creates no records and cannot be confirmed later', async () => {
    const { app, store } = await seededApp();
    const staff = await loginAs(app, 'minhanh.nguyen@minhan.example');
    const acct = await loginAs(app, 'thanhha@minhan.example');
    await expectAppError(
      app.documents.rejectDocument(staff, { documentId: 'CT-1028', reason: 'Trùng' }),
      'FORBIDDEN',
    );
    await expectAppError(
      app.documents.rejectDocument(acct, { documentId: 'CT-1028', reason: ' ' }),
      'VALIDATION',
    );
    await app.documents.rejectDocument(acct, {
      documentId: 'CT-1028',
      reason: 'Trùng với chứng từ đã tiếp nhận',
    });
    const d = await app.documents.getDocument(acct, { documentId: 'CT-1028' });
    expect(d.document.status).toBe('REJECTED');
    expect(d.document.issues[0]!.message).toBe('Trùng với chứng từ đã tiếp nhận');
    await expectAppError(app.documents.confirmDocument(acct, { documentId: 'CT-1028' }), 'CONFLICT');
    const records = await store.read((tx) => tx.list('records', DEMO_TENANT, { documentId: d.document.id }));
    expect(records).toHaveLength(0);
    const audit = await store.read((tx) => tx.list('audit', DEMO_TENANT, { action: 'document.reject' }));
    expect(audit.map((a) => a.target)).toContain('CT-1028');
    // A confirmed document is part of the books: it can no longer be rejected.
    await expectAppError(
      app.documents.rejectDocument(acct, { documentId: 'CT-1027', reason: 'Sai' }),
      'CONFLICT',
    );
  });

  it('a forged e-invoice is flagged as high risk and cannot be booked', async () => {
    const { app, store } = await seededApp();
    const acct = await loginAs(app, 'thanhha@minhan.example');
    // The genuine invoice in the demo books passes every check.
    const genuine = await app.documents.getDocument(acct, { documentId: 'CT-1027' });
    expect(genuine.authenticity?.level).toBe('LOW');
    expect(genuine.authenticity?.checks.filter((c) => c.status === 'FAIL')).toEqual([]);
    // A look-alike: seller tax code with a wrong check digit, issued to another company, unsigned,
    // no tax-authority code, and a VAT amount that does not match the rate.
    const forged = `<HDon><DLHDon><TTChung><KHMSHDon>1</KHMSHDon><KHHDon>C26TNV</KHHDon><SHDon>00999</SHDon><NLap>2026-10-30</NLap></TTChung>
      <NDHDon><NBan><Ten>Nguyên liệu Việt</Ten><MST>0312345678</MST></NBan><NMua><Ten>Công ty khác</Ten><MST>0100109106</MST></NMua>
      <DSHHDVu><HHDVu><THHDVu>Cà phê hạt</THHDVu><ThTien>2000000</ThTien><TSuat>10%</TSuat></HHDVu></DSHHDVu>
      <TToan><THTTLTSuat><LTSuat><TSuat>10%</TSuat><ThTien>2000000</ThTien><TThue>100000</TThue></LTSuat></THTTLTSuat>
      <TgTCThue>2000000</TgTCThue><TgTThue>100000</TgTThue><TgTTTBSo>2100000</TgTTTBSo></TToan></NDHDon></DLHDon></HDon>`;
    const r = await app.documents.intake(acct, { files: [{ name: 'hd-00999.xml', text: forged }] });
    const id = r.files[0]!.documentId;
    const d = await app.documents.getDocument(acct, { documentId: id });
    const failed = d.authenticity!.checks.filter((c) => c.status === 'FAIL').map((c) => c.code);
    expect(d.authenticity!.level).toBe('HIGH');
    expect(failed).toEqual(
      expect.arrayContaining(['TAX_CODE', 'ADDRESSEE', 'SIGNATURE', 'TAX_AUTHORITY_CODE', 'ARITHMETIC']),
    );
    // The arithmetic error alone already blocks the confirmation outright.
    await expectAppError(app.documents.confirmDocument(acct, { documentId: id }), 'VALIDATION');
    const records = await store.read((tx) => tx.list('records', DEMO_TENANT, { documentId: id }));
    expect(records).toHaveLength(0);
  });

  it('confirming a document with failed checks requires acknowledgement and is audited', async () => {
    const { app, store } = await seededApp();
    const acct = await loginAs(app, 'thanhha@minhan.example');
    // Arithmetic is right, but the invoice is unsigned and addressed to another company.
    const xml = `<HDon><DLHDon><TTChung><KHMSHDon>1</KHMSHDon><KHHDon>C26TNV</KHHDon><SHDon>00998</SHDon><NLap>2026-10-30</NLap></TTChung>
      <NDHDon><NBan><Ten>Nguyên liệu Việt</Ten><MST>0312345673</MST></NBan><NMua><Ten>Công ty khác</Ten><MST>0100109106</MST></NMua>
      <DSHHDVu><HHDVu><THHDVu>Cà phê hạt</THHDVu><ThTien>2000000</ThTien><TSuat>10%</TSuat></HHDVu></DSHHDVu>
      <TToan><THTTLTSuat><LTSuat><TSuat>10%</TSuat><ThTien>2000000</ThTien><TThue>200000</TThue></LTSuat></THTTLTSuat>
      <TgTCThue>2000000</TgTCThue><TgTThue>200000</TgTThue><TgTTTBSo>2200000</TgTTTBSo></TToan></NDHDon></DLHDon>
      <MCCQT>00ABCDEF0123456789</MCCQT></HDon>`;
    const r = await app.documents.intake(acct, { files: [{ name: 'hd-00998.xml', text: xml }] });
    const id = r.files[0]!.documentId;
    const err = await app.documents.confirmDocument(acct, { documentId: id }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'VALIDATION', details: { needsAcknowledge: true } });
    expect((err as Error).message).toMatch(/dấu hiệu bất thường.*chữ ký số/);
    const ok = await app.documents.confirmDocument(acct, { documentId: id, acknowledgeWarnings: true });
    expect(ok.version).toBe(1);
    const audit = await store.read((tx) =>
      tx.list('audit', DEMO_TENANT, { action: 'document.authenticity_override' }),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.detail).toMatch(/SIGNATURE/);
    // Booked pre-VAT (2 000 000), the 200 000 VAT is input tax, not expense.
    const records = await store.read((tx) => tx.list('records', DEMO_TENANT, { documentId: id }));
    expect(records.map((x) => x.amount)).toEqual(['2000000']);
  });

  it('a photo with the e-invoice QR code is filled in from the QR and checked against it', async () => {
    const { app } = await seededApp();
    const acct = await loginAs(app, 'thanhha@minhan.example');
    const qr = buildInvoiceQr({
      sellerTaxCode: '0314222331',
      formNo: '1',
      series: 'C26TSX',
      documentNo: '0000777',
      issueDate: '2026-10-29',
      total: '1650000',
    });
    // A tiny JPEG stands in for the photo; the client read the QR printed on it.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
    const r = await app.documents.intake(acct, {
      files: [{ name: 'hoa-don-sua-xanh.jpg', mime: 'image/jpeg', contentBase64: jpeg, qr }],
    });
    const id = r.files[0]!.documentId;
    const d = await app.documents.getDocument(acct, { documentId: id });
    expect(d.document.fields).toMatchObject({
      supplier: '',
      taxCode: '0314222331',
      series: '1C26TSX',
      documentNo: '777',
      documentDate: '2026-10-29',
      total: '1650000',
    });
    const qrCheck = () => d.authenticity!.checks.find((c) => c.code === 'QR');
    expect(qrCheck()?.status).toBe('PASS');
    // Someone "corrects" the total to more than the invoice says: the QR contradicts it.
    await app.documents.saveDraft(acct, {
      documentId: id,
      fields: { ...d.document.fields, supplier: 'Sữa Xanh', total: '7650000' },
    });
    const after = await app.documents.getDocument(acct, { documentId: id });
    const check = after.authenticity!.checks.find((c) => c.code === 'QR')!;
    expect(check.status).toBe('FAIL');
    expect(check.detail).toMatch(/Tổng tiền thanh toán 1650000/);
    // A QR whose CRC does not match fills in nothing.
    const r2 = await app.documents.intake(acct, {
      files: [
        {
          name: 'anh-2.jpg',
          mime: 'image/jpeg',
          contentBase64: Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]).toString('base64'),
          qr: qr.slice(0, -4) + '0000',
        },
      ],
    });
    const d2 = await app.documents.getDocument(acct, { documentId: r2.files[0]!.documentId });
    expect(d2.document.fields.documentNo).toBe('');
    expect(d2.authenticity!.checks.find((c) => c.code === 'QR')?.status).toBe('FAIL');
  });

  it('a revoked session stops working immediately, the others keep going', async () => {
    const { app } = await seededApp();
    const phone = await loginAs(app, DEMO_EMAIL, DEMO_TENANT);
    const laptop = await loginAs(app, DEMO_EMAIL, DEMO_TENANT);
    const sessions = await app.auth.listSessions(laptop);
    const phoneSession = sessions.find((s) => !s.current)!;
    await app.auth.revokeSession(laptop, { sessionId: phoneSession.id });
    await expectAppError(app.dashboard.overview(phone), 'UNAUTHENTICATED');
    expect((await app.dashboard.overview(laptop)).periodLabel).toBeTruthy();
    await app.auth.logout(laptop);
    await expectAppError(app.dashboard.overview(laptop), 'UNAUTHENTICATED');
  });
});
