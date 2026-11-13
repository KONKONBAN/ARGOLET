import { beforeAll, describe, expect, it } from 'vitest';
import type { ArgoletApp, CallContext } from '../src';
import { loginAs, seededApp } from './helpers';

/** The demo dataset must reproduce the numbers drawn in the Figma screens. */
describe('demo dataset matches the Figma design', () => {
  let app: ArgoletApp;
  let call: CallContext;
  beforeAll(async () => {
    ({ app } = await seededApp());
    call = await loginAs(app);
  });

  it('09 · Tổng quan kinh doanh', async () => {
    const o = await app.dashboard.overview(call);
    expect(o.netLabel).toBe('+84.600.000 đ');
    expect(o.revenueLabel).toBe('428.600.000 đ');
    expect(o.expenseLabel).toBe('344.000.000 đ');
    expect(o.netNote).toBe('Thu 428,6 triệu · Chi 344 triệu');
    expect(o.periodLabel).toBe('Tháng 10/2026');
    expect(o.channels.map((c) => [c.label, c.amountLabel])).toEqual([
      ['Tại quầy', '248.600.000 đ'],
      ['Nền tảng giao hàng', '180.000.000 đ'],
    ]);
    expect(o.channels[0]!.status).toBe('Đã đối soát');
    expect(o.tasks[0]!.detail).toBe('3 hồ sơ · 14.500.000 đ');
    expect(o.tasks[1]!.detail).toBe('2 nhóm giao dịch cần xác nhận');
    expect(o.tasks[2]!.detail).toBe('4 hồ sơ cần bổ sung thông tin');
    expect(o.series).toHaveLength(7);
    expect(o.series[0]!.label).toBe('25/10');
    expect(o.series[6]!.label).toBe('31/10');
  });

  it('workspace context: Minh An Commerce · 3 cơ sở · inbox badge 3', async () => {
    const ctx = await app.org.context(call);
    expect(ctx.tenant.name).toBe('Minh An Commerce');
    expect(ctx.entities.filter((e) => e.kind === 'SITE')).toHaveLength(3);
    expect(ctx.member.displayName).toBe('Minh Anh');
    expect(ctx.member.title).toBe('Quản trị tổ chức');
    expect(ctx.counts.inbox).toBe(4);
    const ws = await app.org.listWorkspaces(call);
    expect(ws.map((w) => [w.name, w.roleLabel, w.scopeLabel])).toEqual([
      ['An Việt Logistics', 'Chỉ xem', '1 pháp nhân'],
      ['Minh An Commerce', 'Quản trị', '3 cơ sở'],
    ]);
  });

  it('10 · Hộp công việc', async () => {
    const inbox = await app.approvals.inbox(call);
    expect(inbox.kpis.toApprove).toBe(4);
    expect(inbox.kpis.toSupplement).toBe(4);
    expect(inbox.items[0]!.title).toBe('Duyệt chi mua nguyên liệu');
    expect(inbox.items[0]!.value).toBe('7.250.000 đ');
    expect(inbox.items.some((i) => i.title === 'Xác nhận nhóm DS-1031')).toBe(true);
  });

  it('11 · Chứng từ: 128 / 4 / 124 and the latest five', async () => {
    const d = await app.documents.listDocuments(call, {});
    expect(d.kpis).toEqual({ total: 128, needsReview: 4, validated: 124 });
    expect(d.items.slice(0, 5).map((i) => [i.code, i.source, i.amountLabel, i.statusLabel])).toEqual([
      ['CT-1028', 'Ảnh chụp', '7.250.000 đ', 'Cần kiểm tra'],
      ['CT-1027', 'XML', '3.680.000 đ', 'Đã xác nhận'],
      ['CT-1026', 'Ngân hàng', '24.600.000 đ', 'Đã xác nhận'],
      ['CT-1025', 'Tệp CSV', '1.250.000 đ', 'Cần đối soát'],
      ['CT-1024', 'PDF', '1.840.000 đ', 'Đã xác nhận'],
    ]);
  });

  it('14/15 · Đối soát: 82 / 6 / 2 and DS-1031 details', async () => {
    const s = await app.recon.summary(call, {});
    expect(s.kpis.matched).toBe(82);
    expect(s.kpis.toConfirm).toBe(6);
    expect(s.kpis.discrepancies).toBe(2);
    const byCode = Object.fromEntries(s.items.map((i) => [i.code, i]));
    expect(byCode['DS-1031']!.statusLabel).toBe('Khớp, chờ duyệt');
    expect(byCode['DS-1030']!.statusLabel).toBe('Lệch 50.000 đ');
    expect(byCode['DS-1028']!.receivedLabel).toBe('3.128.000 đ');
    const g = await app.recon.getGroup(call, { groupId: 'DS-1031' });
    expect(g.group.gross).toBe('1250000');
    expect(g.group.fee).toBe('125000');
    expect(g.group.received).toBe('1125000');
    expect(g.group.residual).toBe('0');
    expect(g.group.feeRule).toBe('10% · Quy tắc hiệu lực 01/10');
    expect(g.orders.map((o) => o.code)).toEqual(['DH-1031-01', 'DH-1031-02', 'DH-1031-03']);
    expect(g.receipts[0]!.code).toBe('GD-883019');
    const g32 = await app.recon.getGroup(call, { groupId: 'DS-1032' });
    expect(g32.group.links).toHaveLength(4);
    expect(g32.group.kind).toBe('MANY_TO_MANY');
  });

  it('16 · Phê duyệt hồ sơ', async () => {
    const a = await app.approvals.get(call, { approvalId: 'apv_031' });
    expect(a.approval.amountLabel).toBe('7.250.000 đ');
    expect(a.approval.statusLabel).toBe('Chờ bạn phê duyệt');
    expect(a.canDecide).toBe(true);
    expect(a.approval.details.map((d) => d.value)).toContain('Mua nguyên liệu tuần 44');
  });

  it('17 · Chốt kỳ (Quận 3) shows the checklist', async () => {
    const st = await app.close.status(call, { entityId: 'site_q3' });
    expect(st.periodLabel).toBe('Kỳ tháng 10/2026');
    expect(st.scopeLabel).toBe('Minh An · Cơ sở Quận 3');
    expect(st.status).toBe('OPEN');
    expect(st.ready).toBe(false);
    expect(st.checklist.find((c) => c.key === 'approvals')!.title).toBe('3 hồ sơ chờ phê duyệt');
  });

  it('18 · Bằng chứng CT-1027 phiên bản 03 in batch EV-20261031-003', async () => {
    const e = await app.evidence.documentEvidence(call, { documentId: 'CT-1027' });
    expect(e.version!.label).toBe('Phiên bản 03');
    expect(e.version!.confirmedAtLabel).toBe('Xác nhận lúc 09:32 · 31/10/2026');
    expect(e.rows.find((r) => r.label === 'Mã lô bằng chứng')!.value).toBe('EV-20261031-003');
    expect(e.rows.find((r) => r.label === 'Người xác nhận')!.value).toBe('Thanh Hà · Kế toán');
    expect(e.rows.find((r) => r.label === 'Phiên bản trước')!.value).toBe('02 · 30/10/2026, 17:05');
    expect(e.history.map((h) => h.title)).toEqual([
      'Tiếp nhận bản gốc',
      'Xác nhận phiên bản 01',
      'Bổ sung thông tin',
      'Xác nhận phiên bản 03',
    ]);
  });

  it('19 · Trợ lý: seeded conversations and the DS-1031 answer', async () => {
    const list = await app.assistant.conversations(call);
    expect(list.items.map((c) => c.title)).toEqual([
      'Vì sao nhóm DS-1031 được gợi ý khớp?',
      'Khoản nào chưa khớp?',
      'Hồ sơ còn thiếu tháng 10',
      'Giải thích kết quả NPV',
    ]);
    const conv = await app.assistant.conversation(call, { conversationId: list.items[0]!.id });
    const ans = conv.messages[1]!.answer!;
    expect(ans.headline).toBe('3 đơn hàng khớp với 1 khoản nhận tiền.');
    expect(ans.facts).toEqual([
      { label: 'Tổng giá trị đơn', value: '1.250.000 đ' },
      { label: 'Phí nền tảng', value: '−125.000 đ' },
      { label: 'Tiền thực nhận', value: '1.125.000 đ' },
    ]);
    expect(ans.note).toBe('Chưa thực hiện xác nhận. Cần người có quyền duyệt.');
  });

  it('20–23 · G1 modules', async () => {
    const dc = await app.modules.dailyClose(call);
    expect(dc.kpis.map((k) => k.value)).toEqual(['8.450.000 đ', '5.800.000 đ', '14.250.000 đ']);
    const inv = await app.modules.inventory(call);
    expect(inv.kpis.map((k) => k.value)).toEqual(['12.400 đ', '3 mặt hàng', '48.600.000 đ']);
    expect(inv.items.slice(0, 4).map((i) => [i.name, i.onHand, i.status])).toEqual([
      ['Cà phê hạt', '24,5', 'Đủ tồn'],
      ['Sữa tươi', '18', 'Sắp hết'],
      ['Đường', '12', 'Đủ tồn'],
      ['Ly giấy', '250', 'Sắp hết'],
    ]);
    const po = await app.modules.purchasing(call);
    expect(po.kpis.map((k) => k.value)).toEqual(['36.800.000 đ', '7.250.000 đ', '4 đơn']);
    const books = await app.modules.booksTax(call);
    expect(books.kpis.map((k) => k.value)).toEqual(['428.600.000 đ', '344.000.000 đ', '4 hồ sơ']);
  });

  it('24–25 · G2 modules', async () => {
    const c = await app.modules.clients(call);
    expect(c.kpis.map((k) => k.value)).toEqual(['12', '3', '9']);
    expect(c.items[0]!.status).toBe('Thiếu 4 hồ sơ');
    const s = await app.modules.sales(call);
    expect(s.kpis.map((k) => k.value)).toEqual(['860.000.000 đ', '6 hợp đồng', '126.400.000 đ']);
  });

  it('26–31 · G3 modules', async () => {
    const p = await app.modules.projects(call);
    expect(p.kpis.map((k) => k.value)).toEqual(['1.000 triệu đ', '420 triệu đ', '180 triệu đ']);
    expect(p.kpis[2]!.note).toBe('Còn khả dụng 400 triệu đ');
    const f = await app.finance.appraisal(call);
    if (f.empty) throw new Error('demo finance project missing');
    expect([f.result.npvLabel, f.result.irrLabel, f.result.paybackLabel, f.result.dscrLabel]).toEqual([
      '137,24 triệu',
      '15,24%',
      '3,33 năm',
      '1,50 lần',
    ]);
    const sc = await app.finance.scenarios(call);
    expect(sc.scenarios.map((x) => x.npvLabel)).toEqual([
      '-52,30 triệu đ',
      '137,24 triệu đ',
      '326,78 triệu đ',
    ]);
    expect(sc.sensitivity).toContain('+137,24 xuống −52,30 triệu đồng');
    const a = await app.modules.assets(call);
    expect(a.kpis.map((k) => k.value)).toEqual(['12 tài sản', '25.000 kWh', '2 lịch']);
    const l = await app.modules.logistics(call);
    expect(l.shipment!.freeTimeEnd).toBe('02/11/2026');
    expect(l.shipment!.freeTimeNote).toContain('Còn 2 ngày theo biểu phí BPL-10');
    const lf = await app.modules.logisticsFinance(call);
    expect(lf.shipment!.kpis.map((k) => k.value)).toEqual(['24.000.000 đ', '18.200.000 đ', '5.800.000 đ']);
    expect(lf.shipment!.kpis[2]!.note).toBe('Biên lợi nhuận gộp 24,17%');
    expect(lf.shipment!.allocation.map((x) => x.amount)).toEqual(['10.920.000 đ', '7.280.000 đ']);
  });

  it('32–33 · G4 modules', async () => {
    const g = await app.modules.group(call);
    expect(g.kpis.map((k) => k.value)).toEqual(['4 đơn vị', '3 / 4 đơn vị', '300.000 đ']);
    expect(g.items.map((i) => i.code)).toEqual(['MAH', 'MAR', 'MAL', 'MAE']);
    const ic = await app.modules.intercompany(call);
    expect(ic.pair!.kpis.map((k) => k.value)).toEqual(['85.400.000 đ', '85.100.000 đ', '300.000 đ']);
    expect(ic.pair!.rows[1]!.result).toBe('Lệch 300.000 đ');
  });

  it('34–37, 39 · admin, notifications, ingestion, decision pack', async () => {
    const m = await app.org.listMembers(call);
    expect(m.members.slice(0, 4).map((x) => [x.name, x.roleLabel, x.scopeLabel, x.limitLabel])).toEqual([
      ['Minh Anh', 'Quản trị', 'Toàn tổ chức', 'Theo chính sách'],
      ['Thanh Hà', 'Kế toán', '3 cơ sở', 'Không cấp'],
      ['Hải Nam', 'Người duyệt', 'Dự án DA-001', '50.000.000 đ'],
      ['Nguyễn Minh Anh', 'Nhân viên', 'Cơ sở Quận 3', 'Không cấp'],
    ]);
    const n = await app.dashboard.notifications(call);
    expect(n.kpis).toEqual({ unread: 5, actionRequired: 3, today: 8 });
    const b = await app.documents.listBatches(call);
    expect(b.latest!.code).toBe('LO-20261031');
    expect(b.latest!.fileCount).toBe(16);
    expect(b.sources).toHaveLength(6);
    const dp = await app.close.decisionPack(call);
    expect(dp.kpis.netLabel).toBe('+84.600.000 đ');
    expect(dp.statusLabel).toBe('Bản nháp · Chưa chốt');
    expect(dp.rows[3]!.value).toBe('82 nhóm');
  });

  it('40 · Kiểm tra toàn vẹn CT-1027 with the stored original passes', async () => {
    const info = await app.evidence.integrityInfo(call, { documentId: 'CT-1027' });
    expect(info.title).toBe('Hồ sơ CT-1027 · Phiên bản 03');
    expect(info.subtitle).toBe('Bản gốc lưu ngoài chuỗi · EV-20261031-003');
    expect(info.hasOriginal).toBe(true);
    const v = await app.evidence.verifyDocument(call, {
      documentId: 'CT-1027',
      fileText: info.originalContent!,
    });
    expect(v.ok).toBe(true);
    expect(v.chainValid).toBe(true);
    const bad = await app.evidence.verifyDocument(call, {
      documentId: 'CT-1027',
      fileText: info.originalContent!.replace('3680000', '3690000'),
    });
    expect(bad.ok).toBe(false);
    expect(bad.steps[0]!.ok).toBe(false);
  });
});
