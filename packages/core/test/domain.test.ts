import { describe, expect, it } from 'vitest';
import {
  ApprovalError, assertNoPii, assertTransition, authorize, canMovePeriod, canTransition, checkVerificationToken, chooseParser, closeChecklist,
  createEvent, decide, detectFormat, documentKey, EventBroker, formatCompactVnd, formatDate, formatPeriod, formatPercent, formatShortDateTime,
  formatSignedVnd, formatVnd, generateOtp, hashSecret, Inbox, initials, isNextInSequence, isValidTaxCode, nextCode, newId, normalizeContact,
  normalizePhone, parseAmount, parseBankStatementCsv, parseCsv, parseDate, parseEInvoiceXml, parsePosCsv, parseXml, permissionsOf, shortHash,
  targetDigest, ToolGateway, totp, validateFields, validatePassword, verifyTotp, newSessionToken, sessionTokenHash, base32Encode, base32Decode,
  type AccessContext, type ApprovalRequest,
} from '../src';

describe('Vietnamese formatting', () => {
  it('formats VND like the design', () => {
    expect(formatVnd('7250000')).toBe('7.250.000 đ');
    expect(formatSignedVnd('84600000')).toBe('+84.600.000 đ');
    expect(formatSignedVnd('-125000')).toBe('−125.000 đ');
    expect(formatVnd(0)).toBe('0 đ');
    expect(formatCompactVnd('428600000')).toBe('428,6 triệu');
    expect(formatCompactVnd('344000000')).toBe('344 triệu');
    expect(formatPercent('0.2417', 2)).toBe('24,17%');
    expect(formatDate('2026-10-31')).toBe('31/10/2026');
    expect(formatShortDateTime('2026-10-31T02:32:00Z')).toBe('31/10, 09:32');
    expect(formatPeriod('2026-10')).toBe('Tháng 10/2026');
    expect(initials('Minh Anh')).toBe('MA');
    expect(initials('Trần Thanh Hà')).toBe('TH');
    expect(shortHash('0167ecbf31e793aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa237b3c1e1e3d5c')).toBe('0167ecbf31e793...237b3c1e1e3d5c');
  });
});

describe('ids', () => {
  it('generates sortable prefixed ids and sequential codes', () => {
    const a = newId('doc', 1000);
    const b = newId('doc', 2000);
    expect(a < b).toBe(true);
    expect(a).toMatch(/^doc_[0-9A-Z]{26}$/);
    expect(nextCode('CT', ['CT-1027', 'CT-1028', 'DS-2000'])).toBe('CT-1029');
    expect(nextCode('PO', [], 3, 1)).toBe('PO-001');
  });
});

describe('documents', () => {
  it('detects format and parser', () => {
    expect(detectFormat('hd.xml')).toBe('XML');
    expect(detectFormat('saoke.csv')).toBe('CSV');
    expect(detectFormat('a.xlsx')).toBe('EXCEL');
    expect(detectFormat('scan.pdf')).toBe('PDF');
    expect(detectFormat('photo.jpg', 'image/jpeg')).toBe('IMAGE');
    expect(chooseParser('XML')).toBe('structured');
    expect(chooseParser('IMAGE')).toBe('ocr_vlm');
  });

  it('enforces the lifecycle RECEIVED → EXTRACTED → VALIDATED', () => {
    expect(canTransition('RECEIVED', 'EXTRACTED')).toBe(true);
    expect(canTransition('RECEIVED', 'VALIDATED')).toBe(false);
    expect(() => assertTransition('REJECTED', 'VALIDATED')).toThrow();
  });

  it('parses amounts and dates in Vietnamese formats', () => {
    expect(parseAmount('1.250.000')).toBe('1250000');
    expect(parseAmount('1,250,000')).toBe('1250000');
    expect(parseAmount('-125.000 đ')).toBe('-125000');
    expect(parseAmount('(500)')).toBe('-500');
    expect(parseAmount('12,5')).toBe('12.5');
    expect(() => parseAmount('abc')).toThrow();
    expect(parseDate('31/10/2026')).toBe('2026-10-31');
    expect(parseDate('2026-10-31T10:00:00')).toBe('2026-10-31');
    expect(() => parseDate('31-31')).toThrow();
  });

  it('parses CSV with quotes, semicolons and BOM', () => {
    expect(parseCsv('﻿a;b\n"x;1";"he said ""hi"""\n')).toEqual([['a', 'b'], ['x;1', 'he said "hi"']]);
  });

  it('parses a bank statement', () => {
    const lines = parseBankStatementCsv('Ngày,Ghi có,Ghi nợ,Mã tham chiếu,Nội dung,Đối tác\n31/10/2026,"1.125.000",,GD-883019,TT-1031 chi tra,ShopeeFood\n31/10/2026,,200.000,GD-1,Phi,Bank\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ date: '2026-10-31', amount: '1125000', reference: 'GD-883019', counterparty: 'ShopeeFood' });
    expect(lines[1]!.amount).toBe('-200000');
    expect(() => parseBankStatementCsv('Foo\n1')).toThrow();
  });

  it('parses a POS export', () => {
    const rows = parsePosCsv('Mã đơn,Ngày,Giá trị,Phí,Hoàn tiền,Mã lô chi trả,Kênh\nDH-1,30/10/2026,150000,33000,5000,S01,GrabFood\n');
    expect(rows[0]).toMatchObject({ orderCode: 'DH-1', gross: '150000', fee: '33000', refund: '5000', discount: '0', payoutBatch: 'S01' });
  });

  it('parses an e-invoice XML safely', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><HDon><DLHDon><TTChung><KHHDon>1C26TAA</KHHDon><SHDon>00318</SHDon><NLap>2026-10-31</NLap><DVTTe>VND</DVTTe></TTChung><NDHDon><NBan><Ten>Nguyên liệu Việt &amp; Cộng sự</Ten><MST>0312345678</MST></NBan><NMua><Ten>Minh An</Ten><MST>0309876543</MST></NMua><DSHHDVu><HHDVu><THHDVu>Cà phê hạt</THHDVu><SLuong>15</SLuong><DVTinh>kg</DVTinh><DGia>250000</DGia><ThTien>3750000</ThTien></HHDVu><HHDVu><THHDVu>Sữa tươi</THHDVu><ThTien>2500000</ThTien></HHDVu><HHDVu><THHDVu>Bao bì</THHDVu><ThTien>1000000</ThTien></HHDVu></DSHHDVu><TToan><TgTCThue>7250000</TgTCThue><TgTThue>0</TgTThue><TgTTTBSo>7250000</TgTTTBSo></TToan></NDHDon></DLHDon><DSCKS><NBan><Signature/></NBan></DSCKS></HDon>`;
    const inv = parseEInvoiceXml(xml);
    expect(inv).toMatchObject({ documentNo: '00318', series: '1C26TAA', issueDate: '2026-10-31', sellerName: 'Nguyên liệu Việt & Cộng sự', sellerTaxCode: '0312345678', total: '7250000', signed: true });
    expect(inv.lines).toHaveLength(3);
    expect(() => parseEInvoiceXml('<Foo/>')).toThrow();
    expect(() => parseXml('<a><b></a>')).toThrow();
  });

  it('validates fields: totals, dates, tax code, duplicates, low confidence', () => {
    const ok = { supplier: 'Nguyên liệu Việt', documentNo: 'HD-00318', documentDate: '2026-10-31', total: '7250000', taxCode: '0312345678', lines: [{ description: 'a', amount: '3750000' }, { description: 'b', amount: '2500000' }, { description: 'c', amount: '1000000' }] };
    expect(validateFields(ok, { today: '2026-11-12', periodId: '2026-10' })).toEqual([]);
    expect(validateFields({ ...ok, total: '7000000' }).some((i) => i.field === 'total')).toBe(true);
    expect(validateFields({ ...ok, documentDate: '2027-01-01' }, { today: '2026-11-12' })[0]!.message).toContain('tương lai');
    expect(validateFields({ ...ok, taxCode: '123' })[0]!.field).toBe('taxCode');
    expect(validateFields(ok, { knownDocumentKeys: [documentKey(ok)] })[0]!.field).toBe('duplicate');
    expect(validateFields(ok, { lowConfidence: ['documentDate'] })[0]).toMatchObject({ field: 'documentDate', severity: 'warning' });
    expect(validateFields({ ...ok, supplier: '', documentNo: '', total: 'x', lines: undefined }).length).toBeGreaterThanOrEqual(3);
    expect(isValidTaxCode('0312345678-001')).toBe(true);
  });
});

const ctx = (over: Partial<AccessContext> = {}): AccessContext => ({
  userId: 'u_admin',
  tenantId: 't1',
  aal: 1,
  bindings: [
    { role: 'ORG_ADMIN', entityIds: '*', approvalLimit: null },
    { role: 'APPROVER', entityIds: '*', approvalLimit: 'POLICY' },
  ],
  ...over,
});

describe('RBAC / ABAC', () => {
  it('enforces role permissions, entity scope, limits and SoD', () => {
    const staff = ctx({ userId: 'u_staff', bindings: [{ role: 'STAFF', entityIds: ['q3'], approvalLimit: null }] });
    expect(authorize(staff, { action: 'document.create', entityId: 'q3' }).allowed).toBe(true);
    expect(authorize(staff, { action: 'document.create', entityId: 'q1' }).allowed).toBe(false);
    expect(authorize(staff, { action: 'approval.decide' }).allowed).toBe(false);
    const approver = ctx({ userId: 'u_nam', bindings: [{ role: 'APPROVER', entityIds: '*', approvalLimit: '50000000' }] });
    expect(authorize(approver, { action: 'approval.decide', amount: '7250000', makerId: 'u_staff' }).allowed).toBe(true);
    expect(authorize(approver, { action: 'approval.decide', amount: '70000000', makerId: 'u_staff' }).reason).toContain('hạn mức');
    expect(authorize(approver, { action: 'approval.decide', amount: '100', makerId: 'u_nam' }).reason).toContain('tự phê duyệt');
    const big = authorize(ctx(), { action: 'approval.decide', amount: '60000000', makerId: 'x' });
    expect(big.allowed).toBe(false);
    expect(big.requiresStepUp).toBe(true);
    expect(authorize(ctx({ aal: 2 }), { action: 'approval.decide', amount: '60000000', makerId: 'x' }).allowed).toBe(true);
  });

  it('expires delegations', () => {
    const d = ctx({ now: '2026-12-01T00:00:00Z', bindings: [{ role: 'CLIENT_DELEGATE', entityIds: '*', approvalLimit: null, validUntil: '2026-11-30T23:59:59Z' }] });
    expect(authorize(d, { action: 'document.read' }).allowed).toBe(false);
  });

  it('lists effective permissions', () => {
    expect(permissionsOf([{ role: 'VIEWER', entityIds: '*', approvalLimit: null }])).toContain('document.read');
  });
});

describe('approvals bound to digest', () => {
  const payload = { amount: '7250000', supplier: 'Nguyên liệu Việt' };
  const req: ApprovalRequest = {
    approvalId: 'a1', tenantId: 't1', entityId: 'q3', targetType: 'EXPENSE', targetId: 'exp1', targetVersion: 1, digest: targetDigest(payload),
    amount: '7250000', title: 'Đề nghị chi', makerId: 'u_staff', status: 'PENDING', policyVersion: 'p', createdAt: 'x',
  };
  const input = { decision: 'APPROVE' as const, seenDigest: req.digest, currentDigest: req.digest, currentVersion: 1, now: '2026-10-31T03:00:00Z' };

  it('approves when content is unchanged', () => {
    expect(decide(req, ctx(), input)).toMatchObject({ status: 'APPROVED', actorId: 'u_admin' });
  });

  it('rejects stale or mismatched content and double decisions', () => {
    expect(() => decide(req, ctx(), { ...input, currentDigest: targetDigest({ ...payload, amount: '1' }) })).toThrow(ApprovalError);
    expect(() => decide(req, ctx(), { ...input, seenDigest: 'x' })).toThrow(/khác nội dung/);
    expect(() => decide({ ...req, status: 'APPROVED' }, ctx(), input)).toThrow(/đã được xử lý/);
    expect(() => decide({ ...req, makerId: 'u_admin' }, ctx(), input)).toThrow(/tự phê duyệt/);
  });

  it('allows requesting changes', () => {
    expect(decide(req, ctx(), { ...input, decision: 'REQUEST_CHANGES', comment: 'Bổ sung' }).status).toBe('CHANGES_REQUESTED');
  });
});

describe('period close', () => {
  it('follows OPEN → REVIEW → APPROVED → CLOSED', () => {
    expect(canMovePeriod('OPEN', 'REVIEW')).toBe(true);
    expect(canMovePeriod('OPEN', 'CLOSED')).toBe(false);
    expect(canMovePeriod('CLOSED', 'OPEN')).toBe(false);
  });

  it('builds the checklist from Figma screen 17', () => {
    const c = closeChecklist({ documentsTotal: 124, documentsValidated: 124, groupsTotal: 82, groupsConfirmed: 82, unexplainedDiscrepancies: 0, pendingApprovals: 2, closeMemoPrepared: false });
    expect(c.items.map((i) => i.title)).toEqual(['124 chứng từ đã xác nhận', '82 nhóm đã đối soát', '2 hồ sơ chờ phê duyệt', 'Biên bản chốt chưa được lập']);
    expect(c.blocking).toBe(1);
    expect(c.ready).toBe(false);
  });
});

describe('events', () => {
  it('builds envelopes, refuses PII and dedupes consumers', () => {
    const e = createEvent({ type: 'DocumentValidated', tenantId: 't', entityId: 'q3', aggregateType: 'Document', aggregateId: 'd1', aggregateSeq: 1, correlationId: 'c', causationId: null, actorId: 'u', dataRef: 'doc/d1', dataVersion: 2, data: { documentId: 'd1' } });
    expect(e.eventId).toMatch(/^evt_/);
    expect(() => assertNoPii({ nested: { email: 'a@b.c' } })).toThrow();
    const inbox = new Inbox();
    expect(inbox.has(e.eventId, 'projection')).toBe(false);
    inbox.mark(e.eventId, 'projection');
    expect(inbox.has(e.eventId, 'projection')).toBe(true);
    expect(isNextInSequence(0, e)).toBe(true);
    expect(isNextInSequence(1, e)).toBe(false);
    const broker = new EventBroker();
    broker.subscribe('DocumentValidated', 'a', () => {});
    broker.subscribe('*', 'b', () => {});
    expect(broker.consumersFor('DocumentValidated').map((c) => c.consumer)).toEqual(['a', 'b']);
  });
});

describe('auth', () => {
  it('validates passwords and contacts', () => {
    expect(validatePassword('short')).toContain('12');
    expect(validatePassword('aaaaaaaaaaaaaaa')).toContain('đơn giản');
    expect(validatePassword('Argolet@2026!x')).toBeNull();
    expect(normalizeContact('  KeToan@MinhAn.Example ')).toEqual({ type: 'email', value: 'ketoan@minhan.example' });
    expect(normalizePhone('0901 234 567')).toBe('+84901234567');
    expect(normalizePhone('+84 901234567')).toBe('+84901234567');
    expect(normalizePhone('123')).toBeNull();
    expect(normalizeContact('bad@')).toBeNull();
  });

  it('checks OTP tokens with expiry, attempts and one-time use', () => {
    const code = generateOtp();
    expect(code).toMatch(/^\d{6}$/);
    const rec = { tokenHash: hashSecret(code, 'pep'), purpose: 'VERIFY_CONTACT' as const, userId: 'u', expiresAt: '2026-10-31T10:00:00Z', attempts: 0 };
    expect(checkVerificationToken(rec, code, 'pep', '2026-10-31T09:00:00Z')).toEqual({ ok: true });
    expect(checkVerificationToken(rec, '000000' === code ? '111111' : '000000', 'pep', '2026-10-31T09:00:00Z')).toEqual({ ok: false, reason: 'INVALID' });
    expect(checkVerificationToken(rec, code, 'pep', '2026-10-31T11:00:00Z')).toEqual({ ok: false, reason: 'EXPIRED' });
    expect(checkVerificationToken({ ...rec, attempts: 5 }, code, 'pep', '2026-10-31T09:00:00Z')).toEqual({ ok: false, reason: 'TOO_MANY_ATTEMPTS' });
    expect(checkVerificationToken({ ...rec, consumedAt: 'x' }, code, 'pep', '2026-10-31T09:00:00Z')).toEqual({ ok: false, reason: 'CONSUMED' });
  });

  it('implements TOTP per RFC 6238 test vectors (SHA-1)', () => {
    const secret = base32Encode(new TextEncoder().encode('12345678901234567890'));
    expect(base32Decode(secret)).toEqual(new TextEncoder().encode('12345678901234567890'));
    expect(totp(secret, 59_000, 30, 8)).toBe('94287082');
    expect(totp(secret, 1111111109_000, 30, 8)).toBe('07081804');
    expect(totp(secret, 20000000000_000, 30, 8)).toBe('65353130');
    expect(verifyTotp(secret, totp(secret, 1_000_000_000), 1_000_000_000 + 25_000)).toBe(true);
    expect(verifyTotp(secret, '000000', 1_000_000_000)).toBe(totp(secret, 1_000_000_000) === '000000');
  });

  it('issues opaque session tokens and stores only the hash', () => {
    const { token, tokenHash } = newSessionToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(sessionTokenHash(token)).toBe(tokenHash);
  });
});

describe('AI tool gateway', () => {
  const gw = new ToolGateway();
  gw.register({ name: 'get_kpis', description: 'Đọc chỉ tiêu', kind: 'read', permission: 'workspace.read', params: { periodId: { type: 'string', description: 'kỳ', required: true } } }, async (a) => ({ period: a.periodId }));
  gw.register({ name: 'confirm_match', description: 'Xác nhận nhóm đối soát', kind: 'write', permission: 'recon.confirm', params: { groupCode: { type: 'string', description: 'mã', required: true } } }, async () => 'never');
  const viewer: AccessContext = { userId: 'v', tenantId: 't', aal: 1, bindings: [{ role: 'VIEWER', entityIds: '*', approvalLimit: null }] };
  const accountant: AccessContext = { userId: 'k', tenantId: 't', aal: 1, bindings: [{ role: 'ACCOUNTANT', entityIds: '*', approvalLimit: null }] };

  it('executes read tools after schema + permission checks', async () => {
    expect(await gw.handle({ toolName: 'get_kpis', args: { periodId: '2026-10' } }, viewer)).toEqual({ status: 'executed', result: { period: '2026-10' } });
    expect((await gw.handle({ toolName: 'get_kpis', args: {} }, viewer)).status).toBe('rejected');
    expect((await gw.handle({ toolName: 'get_kpis', args: { periodId: '2026-10', tenantId: 'other' } }, viewer)).status).toBe('rejected');
    expect((await gw.handle({ toolName: 'nope', args: {} }, viewer)).status).toBe('rejected');
  });

  it('turns write tools into proposals and checks permissions', async () => {
    expect((await gw.handle({ toolName: 'confirm_match', args: { groupCode: 'DS-1031' } }, viewer)).status).toBe('rejected');
    expect((await gw.handle({ toolName: 'confirm_match', args: { groupCode: 'DS-1031' } }, accountant)).status).toBe('needs_approval');
    expect(gw.definitionsFor(viewer).map((d) => d.name)).toEqual(['get_kpis']);
    expect(gw.audit.length).toBeGreaterThanOrEqual(6);
  });
});
