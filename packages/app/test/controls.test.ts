/**
 * Controls that protect the books: organisations never see each other's data, read-only members
 * cannot change anything, rejected documents leave no accounting trace, and revoked sessions stop
 * working at once.
 */
import { describe, expect, it } from 'vitest';
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
