import { describe, expect, it } from 'vitest';
import { createArgoletApp, MemoryStore, demoClock, type ArgoletApp, type CallContext } from '../src';
import { expectAppError, fastHasher, loginAs, seededApp } from './helpers';

async function freshApp(): Promise<ArgoletApp> {
  const clock = demoClock();
  const store = new MemoryStore(undefined, undefined, () => clock().toISOString());
  return createArgoletApp({ store, hasher: fastHasher, clock });
}

const xmlInvoice = (no: string, total: number, seller = 'Cà phê Cầu Đất') => `<?xml version="1.0"?>
<HDon><DLHDon><TTChung><KHHDon>1C26TCD</KHHDon><SHDon>${no}</SHDon><NLap>2026-10-30</NLap><DVTTe>VND</DVTTe></TTChung>
<NDHDon><NBan><Ten>${seller}</Ten><MST>0311112222</MST></NBan><NMua><Ten>Minh An Retail</Ten><MST>0309876543</MST></NMua>
<DSHHDVu><HHDVu><THHDVu>Cà phê Arabica</THHDVu><SLuong>5</SLuong><DGia>${total / 5}</DGia><ThTien>${total}</ThTien></HHDVu></DSHHDVu>
<TToan><TgTCThue>${total}</TgTCThue><TgTThue>0</TgTThue><TgTTTBSo>${total}</TgTTTBSo></TToan></NDHDon></DLHDon><DSCKS><NBan><Signature/></NBan></DSCKS></HDon>`;

describe('01–03 · account, sign-in and organisation', () => {
  it('registers with OTP, signs in, creates an organisation (OrgAdmin)', async () => {
    const app = await freshApp();
    const call0: CallContext = { channel: 'web' };
    await expectAppError(app.auth.register(call0, { fullName: 'Lê An', contact: 'an@example.vn', password: 'ngan', acceptTerms: true }), 'VALIDATION');
    await expectAppError(app.auth.register(call0, { fullName: 'Lê An', contact: 'an@example.vn', password: 'Mat-khau-du-dai-1', acceptTerms: false }), 'VALIDATION');
    const reg = await app.auth.register(call0, { fullName: 'Lê An', contact: ' An@Example.vn ', password: 'Mat-khau-du-dai-1', acceptTerms: true });
    expect(reg.sentTo).toBe('an@example.vn');
    expect(reg.devCode).toMatch(/^\d{6}$/);
    // Unverified accounts cannot sign in.
    await expectAppError(app.auth.login(call0, { contact: 'an@example.vn', password: 'Mat-khau-du-dai-1' }), 'FORBIDDEN');
    await expectAppError(app.auth.verifyContact(call0, { contact: 'an@example.vn', code: reg.devCode === '000000' ? '111111' : '000000' }), 'VALIDATION');
    await expectAppError(app.auth.resendCode(call0, { contact: 'an@example.vn' }), 'RATE_LIMITED');
    const v = await app.auth.verifyContact(call0, { contact: 'an@example.vn', code: reg.devCode! });
    const call: CallContext = { sessionToken: v.token, channel: 'web' };
    expect((await app.auth.me(call))!.user.status).toBe('ACTIVE');
    expect(await app.org.listWorkspaces(call)).toEqual([]);
    await expectAppError(app.org.context(call), 'NO_WORKSPACE');
    await expectAppError(app.org.createOrganization(call, { name: 'Công ty An', orgType: 'Hộ kinh doanh', taxCode: '12' }), 'VALIDATION');
    const org = await app.org.createOrganization(call, { name: 'Công ty An', orgType: 'Hộ kinh doanh', taxCode: '0312345679' });
    const ctx = await app.org.context(call);
    expect(ctx.tenant.id).toBe(org.tenantId);
    // The founder administers the organisation and keeps its books.
    expect(ctx.member.roles).toEqual(['ORG_ADMIN', 'CHIEF_ACCOUNTANT']);
    for (const perm of ['member.manage', 'document.validate', 'recon.confirm', 'approval.decide', 'period.close']) expect(ctx.member.permissions).toContain(perm);
    await app.auth.logout(call);
    expect(await app.auth.me(call)).toBeNull();
    await expectAppError(app.org.context(call), 'UNAUTHENTICATED');
  });

  it('locks the account after repeated failures and resets the password', async () => {
    const { app } = await seededApp();
    const c: CallContext = { channel: 'web' };
    for (let i = 0; i < 8; i++) await expectAppError(app.auth.login(c, { contact: 'hainam@minhan.example', password: 'sai-mat-khau-123' }), 'UNAUTHENTICATED');
    await expectAppError(app.auth.login(c, { contact: 'hainam@minhan.example', password: 'Argolet@2026' }), 'RATE_LIMITED');
    const r = await app.auth.requestPasswordReset(c, { contact: 'hainam@minhan.example' });
    expect(r.devCode).toMatch(/^\d{6}$/);
    expect((await app.auth.requestPasswordReset(c, { contact: 'khongtontai@x.vn' })).sent).toBe(true);
    await app.auth.resetPassword(c, { contact: 'hainam@minhan.example', code: (await app.auth.requestPasswordReset(c, { contact: 'hainam@minhan.example' })).devCode!, newPassword: 'Mat-khau-moi-2026' });
    const ok = await app.auth.login(c, { contact: 'hainam@minhan.example', password: 'Mat-khau-moi-2026' });
    expect(ok.user.fullName).toBe('Lê Hải Nam');
  });

  it('accepts an invitation that matches the verified identity', async () => {
    const { app } = await seededApp();
    const c0: CallContext = { channel: 'mobile' };
    const reg = await app.auth.register(c0, { fullName: 'Nhân viên Mới', contact: 'nhanvien.moi@minhan.example', password: 'Mat-khau-du-dai-1', acceptTerms: true, invitationCode: 'MOI-2026' });
    const v = await app.auth.verifyContact(c0, { contact: 'nhanvien.moi@minhan.example', code: reg.devCode! });
    expect(v.pendingInvitationCode).toBe('MOI-2026');
    const call: CallContext = { sessionToken: v.token, channel: 'mobile' };
    const inv = await app.org.getInvitation(call, { code: 'moi-2026' });
    expect(inv).toMatchObject({ orgName: 'Minh An Commerce', inviterName: 'Nguyễn Minh Anh', roleLabel: 'Kế toán', scopeLabel: 'Cơ sở Quận 3' });
    await app.org.respondInvitation(call, { code: 'MOI-2026', accept: true });
    const ctx = await app.org.context(call);
    expect(ctx.member.roles).toEqual(['ACCOUNTANT']);
    // Scope is limited to Quận 3: documents from other sites are invisible.
    const docs = await app.documents.listDocuments(call, { pageSize: 100 });
    const all = await app.documents.listDocuments(await loginAs(app), { pageSize: 100 });
    expect(docs.kpis.total).toBeLessThan(all.kpis.total);
    await expectAppError(app.documents.getDocument(call, { documentId: 'CT-1012' }), 'NOT_FOUND');
    await expectAppError(app.org.respondInvitation(call, { code: 'MOI-2026', accept: true }), 'CONFLICT');
  });

  it('enables TOTP MFA and requires it at sign-in', async () => {
    const { app } = await seededApp();
    const call = await loginAs(app, 'thanhha@minhan.example');
    const { secret } = await app.auth.setupTotp(call);
    const { totp } = await import('@argolet/core');
    const now = Date.parse(app.core.now());
    await app.auth.enableTotp(call, { code: totp(secret, now) });
    await expectAppError(app.auth.login({}, { contact: 'thanhha@minhan.example', password: 'Argolet@2026' }), 'STEP_UP_REQUIRED');
    const r = await app.auth.login({}, { contact: 'thanhha@minhan.example', password: 'Argolet@2026', totpCode: totp(secret, Date.parse(app.core.now())) });
    expect(r.session.aal).toBe(2);
  });
});

describe('04–05 · intake, validation, evidence', () => {
  it('ingests XML + duplicate + image, confirms, anchors evidence and verifies integrity', async () => {
    const { app } = await seededApp();
    const call = await loginAs(app, 'thanhha@minhan.example');
    const xml = xmlInvoice('00777', 2_500_000);
    const r = await app.documents.intake(call, {
      entityId: 'site_q3',
      location: 'Kệ B-01',
      files: [
        { name: 'hd-00777.xml', mime: 'application/xml', text: xml },
        { name: 'hd-00777-copy.xml', mime: 'application/xml', text: xml },
        { name: 'PN-551_1840000_2026-10-30_Bao-bi-An-Phat.jpg', mime: 'image/jpeg', contentBase64: btoa('fake-image-bytes') },
      ],
    });
    expect(r.duplicates).toBe(1);
    expect(r.files.filter((f) => !f.duplicate)).toHaveLength(2);
    const xmlDoc = r.files[0]!;
    expect(xmlDoc.status).toBe('EXTRACTED');
    const d = await app.documents.getDocument(call, { documentId: xmlDoc.documentId });
    expect(d.document.fields).toMatchObject({ supplier: 'Cà phê Cầu Đất', documentNo: '00777', total: '2500000' });
    const before = await app.dashboard.overview(call);
    const conf = await app.documents.confirmDocument(call, { documentId: xmlDoc.documentId });
    expect(conf.version).toBe(1);
    await expectAppError(app.documents.confirmDocument(call, { documentId: xmlDoc.documentId }), 'CONFLICT');
    const after = await app.dashboard.overview(call);
    expect(Number(after.expense) - Number(before.expense)).toBe(2_500_000);
    const ev = await app.evidence.documentEvidence(call, { documentId: xmlDoc.documentId });
    expect(ev.integrity).toBe('ANCHORED');
    expect(ev.receipt!.validationCode).toBe('VALID');
    const v = await app.evidence.verifyDocument(call, { documentId: xmlDoc.documentId, fileText: xml });
    expect(v.ok).toBe(true);
    expect(v.steps.map((s) => s.code)).toEqual(['B1', 'B3', 'B4', 'B5', 'B6', 'B7']);
    expect((await app.evidence.verifyDocument(call, { documentId: xmlDoc.documentId, fileText: xml + ' ' })).ok).toBe(false);
    // Image: offline OCR hints, confirm after review.
    const img = r.files[2]!;
    const imgDoc = await app.documents.getDocument(call, { documentId: img.documentId });
    expect(imgDoc.document.fields).toMatchObject({ documentNo: 'PN-551', total: '1840000', documentDate: '2026-10-30' });
    await app.documents.confirmDocument(call, { documentId: img.documentId, fields: { ...imgDoc.document.fields, supplier: 'Bao bì An Phát' } });
  });

  it('rejects invalid fields, duplicates by supplier+number and future dates', async () => {
    const { app } = await seededApp();
    const call = await loginAs(app, 'thanhha@minhan.example');
    const d = await app.documents.getDocument(call, { documentId: 'CT-1019' });
    await expectAppError(app.documents.confirmDocument(call, { documentId: d.document.id }), 'VALIDATION');
    const draft = await app.documents.saveDraft(call, { documentId: d.document.id, fields: { ...d.document.fields, documentNo: 'PGH-2710' } });
    expect(draft.status).toBe('EXTRACTED');
    await expectAppError(app.documents.confirmDocument(call, { documentId: d.document.id, fields: { ...d.document.fields, documentNo: 'PGH-2710', documentDate: '2027-01-01' } }), 'VALIDATION');
    await app.documents.confirmDocument(call, { documentId: d.document.id, fields: { ...d.document.fields, documentNo: 'PGH-2710' } });
    // CT-1028 has a low-confidence date: warning must be acknowledged... it is a confidence warning, so it confirms.
    const c28 = await app.documents.getDocument(call, { documentId: 'CT-1028' });
    expect(c28.document.issues[0]!.message).toContain('ngày chứng từ');
    await app.documents.confirmDocument(call, { documentId: 'CT-1028', fields: c28.document.fields });
    const list = await app.documents.listDocuments(call, {});
    expect(list.kpis.validated).toBe(126);
  });

  it('staff can submit but cannot validate; viewers cannot create', async () => {
    const { app } = await seededApp();
    const staff = await loginAs(app, 'minhanh.nguyen@minhan.example');
    await expectAppError(app.documents.confirmDocument(staff, { documentId: 'CT-1028' }), 'FORBIDDEN');
    const r = await app.documents.intake(staff, { files: [{ name: 'hd.xml', text: xmlInvoice('00999', 1_000_000) }] });
    expect(r.files[0]!.status).toBe('EXTRACTED');
    const viewer = await loginAs(app, 'ketoan@minhan.example', 'ten_anviet');
    await expectAppError(app.documents.intake(viewer, { files: [{ name: 'a.xml', text: xmlInvoice('1', 1000) }] }), 'FORBIDDEN');
  });
});

describe('06 · reconciliation M:N', () => {
  it('imports POS + bank CSV, runs the engine, confirms the proposed group', async () => {
    const { app } = await seededApp();
    const call = await loginAs(app, 'thanhha@minhan.example');
    const pos = 'Mã đơn,Ngày,Giá trị,Phí,Hoàn tiền,Mã lô chi trả,Kênh\nDH-2001,30/10/2026,100000,22000,0,S01,GrabFood\nDH-2002,30/10/2026,150000,33000,5000,S01,GrabFood\n';
    const bank = 'Ngày,Ghi có,Ghi nợ,Mã tham chiếu,Nội dung,Đối tác\n31/10/2026,120000,,B1,S01 chi tra,GrabFood\n31/10/2026,70000,,B2,S01 chi tra,GrabFood\n';
    const r = await app.documents.intake(call, { entityId: 'site_q1', files: [{ name: 'grab-s01.csv', text: pos }, { name: 'saoke-s01.csv', text: bank }] });
    for (const f of r.files) await app.documents.confirmDocument(call, { documentId: f.documentId });
    const run = await app.recon.run(call, { entityId: 'site_q1', periodId: '2026-10' });
    expect(run.groups).toBe(1);
    const s = await app.recon.summary(call, {});
    const newest = s.items[0]!;
    expect(newest.code).toBe('DS-1033');
    const g = await app.recon.getGroup(call, { groupId: newest.id });
    expect(g.group.kind).toBe('MANY_TO_MANY');
    expect(g.group.net).toBe('190000');
    expect(g.group.links.map((l) => l.amount)).toEqual(['78000', '42000', '70000']);
    await expectAppError(app.recon.confirm(call, { groupId: newest.id, digest: 'stale' }), 'CONFLICT');
    await app.recon.confirm(call, { groupId: newest.id, digest: g.group.digest });
    expect((await app.recon.summary(call, {})).kpis.matched).toBe(83);
    // A second run finds nothing new (records are locked to the group).
    expect((await app.recon.run(call, { entityId: 'site_q1', periodId: '2026-10' })).groups).toBe(0);
  });

  it('discrepancy groups require an explanatory note', async () => {
    const { app } = await seededApp();
    const call = await loginAs(app, 'thanhha@minhan.example');
    const g = await app.recon.getGroup(call, { groupId: 'DS-1030' });
    await expectAppError(app.recon.confirm(call, { groupId: 'DS-1030', digest: g.group.digest }), 'VALIDATION');
    await app.recon.confirm(call, { groupId: 'DS-1030', digest: g.group.digest, note: 'Khách chuyển thiếu 50.000 đ, sẽ thu bù kỳ sau' });
  });
});

describe('09 · approvals and close', () => {
  it('approves with digest binding, separation of duties and side effects', async () => {
    const { app } = await seededApp();
    const admin = await loginAs(app);
    const staff = await loginAs(app, 'minhanh.nguyen@minhan.example');
    await expectAppError(app.approvals.decide(staff, { approvalId: 'apv_031', decision: 'APPROVE', digest: 'x' }), 'FORBIDDEN');
    const a = await app.approvals.get(admin, { approvalId: 'apv_031' });
    await expectAppError(app.approvals.decide(admin, { approvalId: 'apv_031', decision: 'APPROVE', digest: 'wrong' }), 'CONFLICT');
    await expectAppError(app.approvals.decide(admin, { approvalId: 'apv_031', decision: 'REJECT', digest: a.approval.digest }), 'VALIDATION');
    await app.approvals.decide(admin, { approvalId: 'apv_031', decision: 'APPROVE', digest: a.approval.digest });
    await expectAppError(app.approvals.decide(admin, { approvalId: 'apv_031', decision: 'APPROVE', digest: a.approval.digest }), 'CONFLICT');
    const po = await app.modules.purchasing(admin);
    expect(po.items.find((i) => i.label.includes('PO-031'))!.status).toBe('Chờ hóa đơn');
    // Hải Nam's approval scope is Minh An Energy only.
    const nam = await loginAs(app, 'hainam@minhan.example');
    expect((await app.approvals.get(nam, { approvalId: 'apv_028' })).canDecide).toBe(false);
  });

  it('approving DS-1031 resolves the match and validates the waiting platform report CT-1025', async () => {
    const { app } = await seededApp();
    const admin = await loginAs(app);
    const a = await app.approvals.get(admin, { approvalId: 'apv_ds1031' });
    await app.approvals.decide(admin, { approvalId: 'apv_ds1031', decision: 'APPROVE', digest: a.approval.digest });
    const g = await app.recon.getGroup(admin, { groupId: 'DS-1031' });
    expect(g.group.status).toBe('CONFIRMED');
    const d = await app.documents.getDocument(admin, { documentId: 'CT-1025' });
    expect(d.document.status).toBe('VALIDATED');
    const ev = await app.evidence.documentEvidence(admin, { documentId: 'CT-1025' });
    expect(ev.receipt?.validationCode).toBe('VALID');
  });

  it('closes the Quận 3 period after the checklist, with step-up, and anchors the snapshot', async () => {
    const { app } = await seededApp();
    const admin = await loginAs(app);
    const acct = await loginAs(app, 'thanhha@minhan.example');
    let st = await app.close.status(admin, { entityId: 'site_q3' });
    await expectAppError(app.close.close(admin, { entityId: 'site_q3', periodId: '2026-10', digest: st.draftDigest }), 'STEP_UP_REQUIRED');
    const su = await app.auth.startStepUp(admin);
    expect(su.method).toBe('OTP');
    await app.auth.completeStepUp(admin, { code: su.devCode! });
    await expectAppError(app.close.close(admin, { entityId: 'site_q3', periodId: '2026-10', digest: st.draftDigest }), 'VALIDATION');
    // Clear the blocking items for Quận 3.
    const c28 = await app.documents.getDocument(acct, { documentId: 'CT-1028' });
    await app.documents.confirmDocument(acct, { documentId: 'CT-1028', fields: c28.document.fields });
    for (const id of ['apv_031', 'apv_028', 'apv_ds1031']) {
      const a = await app.approvals.get(admin, { approvalId: id });
      await app.approvals.decide(admin, { approvalId: id, decision: 'APPROVE', digest: a.approval.digest });
    }
    const g30 = await app.recon.getGroup(acct, { groupId: 'DS-1030' });
    await app.recon.confirm(acct, { groupId: 'DS-1030', digest: g30.group.digest, note: 'Thu bù kỳ sau' });
    const g32 = await app.recon.getGroup(acct, { groupId: 'DS-1032' });
    await app.recon.confirm(acct, { groupId: 'DS-1032', digest: g32.group.digest });
    st = await app.close.status(admin, { entityId: 'site_q3' });
    expect(st.ready).toBe(true);
    await expectAppError(app.close.close(admin, { entityId: 'site_q3', periodId: '2026-10', digest: 'old' }), 'CONFLICT');
    const res = await app.close.close(admin, { entityId: 'site_q3', periodId: '2026-10', digest: st.draftDigest });
    const snap = await app.evidence.snapshot(admin, { closeId: res.closeId });
    expect(snap.evidenceStatus).toBe('ANCHORED');
    expect(snap.receipt!.validationCode).toBe('VALID');
    expect(Number(snap.totals.revenue)).toBeGreaterThan(0);
    const verify = await app.evidence.verifyClose(admin, { closeId: res.closeId });
    expect(verify.ok).toBe(true);
    expect((await app.close.status(admin, { entityId: 'site_q3' })).status).toBe('CLOSED');
    await expectAppError(app.close.close(admin, { entityId: 'site_q3', periodId: '2026-10', digest: st.draftDigest }), 'CONFLICT');
    // Accountants cannot close.
    await expectAppError(app.close.close(acct, { entityId: 'site_q1', periodId: '2026-10', digest: 'x' }), 'FORBIDDEN');
  });
});

describe('04 · modules G1–G4 actions', () => {
  it('creates a purchase order that lands in the approver inbox', async () => {
    const { app } = await seededApp();
    const acct = await loginAs(app, 'thanhha@minhan.example');
    await expectAppError(app.modules.createPurchaseOrder(acct, { supplier: '', amount: '1', dueDate: '2026-11-30' }), 'VALIDATION');
    const po = await app.modules.createPurchaseOrder(acct, { supplier: 'Sữa Xanh', amount: '3.200.000', dueDate: '2026-11-15', purpose: 'Mua sữa tuần 45' });
    expect(po.code).toBe('PO-032');
    const admin = await loginAs(app);
    const inbox = await app.approvals.inbox(admin);
    expect(inbox.items.some((i) => i.title === 'Đề nghị chi mua sữa tuần 45' && i.value === '3.200.000 đ')).toBe(true);
    const n = await app.dashboard.notifications(admin);
    expect(n.items[0]!.title).toBe('Thanh Hà gửi hồ sơ chờ duyệt');
  });

  it('runs the other module commands', async () => {
    const { app } = await seededApp();
    const acct = await loginAs(app, 'thanhha@minhan.example');
    const dc = await app.modules.dailyClose(acct);
    await expectAppError(app.modules.submitDailyClose(acct, { shiftId: dc.shift!.id, counted: { 'Tiền mặt': '4100000' } }), 'VALIDATION');
    await app.modules.submitDailyClose(acct, { shiftId: dc.shift!.id, counted: { 'Tiền mặt': '4200000' } });
    await expectAppError(app.modules.submitDailyClose(acct, { shiftId: dc.shift!.id, counted: {} }), 'CONFLICT');
    expect((await app.modules.createDeal(acct, { customer: 'Phúc Long', value: '50000000' })).code).toBe('CH-004');
    const p = await app.modules.projects(acct);
    expect((await app.modules.addWbsTask(acct, { projectId: p.project!.id, name: 'Đào tạo vận hành', owner: 'Hải Nam', dependsOn: '1.5' })).code).toBe('1.6');
    await expectAppError(app.modules.addWbsTask(acct, { projectId: p.project!.id, name: 'X', owner: 'Y', dependsOn: '9.9' }), 'VALIDATION');
    await app.modules.addClient(acct, { name: 'Bếp Nhà Lá', scope: '1 cơ sở', closeDue: '2026-11-10' });
    expect((await app.modules.clients(acct)).kpis[0]!.value).toBe('13');
    const lf = await app.modules.logisticsFinance(acct);
    await app.modules.confirmAllocation(acct, { shipmentId: lf.shipment!.id });
    const ic = await app.modules.intercompany(acct);
    await app.modules.requestIntercompanyDocs(acct, { pairId: ic.pair!.id });
    expect((await app.modules.intercompany(acct)).pair!.status).toBe('REQUESTED');
    const inv = await app.modules.inventory(acct);
    await app.modules.adjustStock(acct, { itemId: inv.items[1]!.id, onHand: '48' });
    expect((await app.modules.inventory(acct)).kpis[1]!.value).toBe('2 mặt hàng');
    const fin = await app.finance.recalculate(acct, { assumptions: { investment: '1000', annualCashflow: '250', years: 5, discountRate: '0.1', annualDebtService: '200' } });
    expect(fin.result.npvLabel).toBe('−52,30 triệu');
    expect(fin.calcRun.engineVersion).toMatch(/^finance-engine/);
    await expectAppError(app.finance.recalculate(acct, { assumptions: { investment: 'abc', annualCashflow: '1', years: 5, discountRate: '0.1', annualDebtService: '1' } }), 'VALIDATION');
  });
});

describe('08 · controlled assistant', () => {
  it('answers from tools, respects permissions and never executes writes', async () => {
    const { app } = await seededApp();
    const admin = await loginAs(app);
    const r1 = await app.assistant.ask(admin, { question: 'Khoản nào chưa khớp?' });
    expect(r1.answer.headline).toContain('nhóm chưa xác nhận');
    // An approver without recon.confirm → the gateway refuses the write tool server side.
    const nam = await loginAs(app, 'hainam@minhan.example');
    const r2 = await app.assistant.ask(nam, { question: 'Xác nhận nhóm DS-1032 giúp tôi' });
    expect(r2.answer.proposal).toBeUndefined();
    expect(r2.answer.headline).toBe('Không thể thực hiện yêu cầu.');
    // An accountant gets a proposal that still needs an approver — nothing is executed.
    const acct = await loginAs(app, 'thanhha@minhan.example');
    const r2b = await app.assistant.ask(acct, { question: 'Xác nhận nhóm DS-1032 giúp tôi' });
    expect(r2b.answer.proposal?.toolName).toBe('propose_confirm_match');
    expect(r2b.answer.note).toContain('Chưa thực hiện');
    const g = await app.recon.getGroup(admin, { groupId: 'DS-1032' });
    expect(g.group.status).toBe('PROPOSED');
    const r3 = await app.assistant.ask(admin, { question: 'Doanh thu tháng này bao nhiêu?' });
    expect(r3.answer.facts[0]).toEqual({ label: 'Doanh thu', value: '428.600.000 đ' });
    const r4 = await app.assistant.ask(admin, { question: 'Thời tiết hôm nay?' });
    expect(r4.answer.headline).toContain('chưa xác định');
    const conv = await app.assistant.conversation(admin, { conversationId: r1.conversationId });
    expect(conv.messages).toHaveLength(2);
  });
});
