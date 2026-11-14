/**
 * A brand-new company on an empty system (no demo data, real calendar): every module must be
 * usable from scratch — structure, intake, review, reconciliation, approvals with a second
 * member, G1–G4 records, period close and rollover to the next month.
 */
import { expect } from 'vitest';
import {
  createArgoletApp,
  type ArgoletApp,
  type CallContext,
  type PasswordHasher,
  type Store,
} from '../../src';
import { expectAppError } from '../helpers';

let nowMs = Date.parse('2026-11-12T03:00:00Z');
const clock = () => new Date(nowMs);
const web = (): CallContext => ({ channel: 'web', userAgent: 'vitest', ip: '127.0.0.1' });

async function signUp(app: ArgoletApp, fullName: string, contact: string): Promise<CallContext> {
  const reg = await app.auth.register(web(), {
    fullName,
    contact,
    password: 'Mat-khau-that-dai-2026',
    acceptTerms: true,
  });
  const v = await app.auth.verifyContact(web(), { contact, code: reg.devCode! });
  return { sessionToken: v.token, channel: 'web' };
}

async function stepUp(app: ArgoletApp, call: CallContext) {
  const su = await app.auth.startStepUp(call);
  await app.auth.completeStepUp(call, { code: (su as { devCode?: string }).devCode! });
}

const pos = `Mã đơn,Ngày,Giá trị,Phí,Hoàn tiền,Chiết khấu,Mã lô chi trả,Kênh
GF-1101,05/11/2026,450000,45000,0,0,GF-PAY-1106,GrabFood
GF-1102,05/11/2026,320000,32000,0,0,GF-PAY-1106,GrabFood
GF-1103,06/11/2026,280000,28000,0,0,GF-PAY-1107,GrabFood`;
const bank = `Ngày giao dịch,Mã tham chiếu,Nội dung,Ghi có,Ghi nợ,Đối tác
06/11/2026,FT2611060001,GF-PAY-1106 thanh toan,693000,,GRAB VIETNAM
07/11/2026,FT2611070002,GF-PAY-1107 thanh toan,252000,,GRAB VIETNAM`;
const xml = (
  no: string,
  amount: number,
) => `<?xml version="1.0"?><HDon><DLHDon><TTChung><KHMSHDon>1</KHMSHDon><KHHDon>C26TBM</KHHDon><SHDon>${no}</SHDon><NLap>2026-11-09</NLap><DVTTe>VND</DVTTe></TTChung>
<NDHDon><NBan><Ten>Công ty TNHH Bột mì Sao Vàng</Ten><MST>0312987656</MST></NBan><NMua><Ten>Tiệm bánh Thu Hà</Ten><MST>8765432103</MST></NMua>
<DSHHDVu><HHDVu><THHDVu>Bột mì</THHDVu><SLuong>1</SLuong><ThTien>${amount}</ThTien></HHDVu></DSHHDVu><TToan><TgTCThue>${amount}</TgTCThue><TgTThue>0</TgTThue><TgTTTBSo>${amount}</TgTTTBSo></TToan></NDHDon></DLHDon><MCCQT Id="cqt">00F0A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5</MCCQT><DSCKS><NBan><Signature/></NBan></DSCKS></HDon>`;

export async function newCompanyScenario(
  makeStore: (now: () => string) => Store | Promise<Store>,
  hasher: PasswordHasher,
): Promise<void> {
  nowMs = Date.parse('2026-11-12T03:00:00Z');
  const store = await makeStore(() => clock().toISOString());
  const app = createArgoletApp({ store, hasher, clock, config: { exposeDevCodes: true } });

  // Founder signs up and creates the organisation
  const owner = await signUp(app, 'Trần Thu Hà', 'thuha@tiembanh.vn');
  const org = await app.org.createOrganization(owner, {
    name: 'Tiệm bánh Thu Hà',
    orgType: 'Hộ kinh doanh',
    taxCode: '8765432103',
  });
  let ctx = await app.org.context(owner);
  expect(ctx.tenant.settings.currentPeriod).toBe('2026-11');
  expect(ctx.member.permissions).toContain('document.validate');

  // Empty organisation: every screen answers without errors
  for (const view of [
    () => app.dashboard.overview(owner),
    () => app.approvals.inbox(owner),
    () => app.documents.listDocuments(owner),
    () => app.recon.summary(owner),
    () => app.close.status(owner),
    () => app.close.decisionPack(owner),
    () => app.modules.dailyClose(owner),
    () => app.modules.inventory(owner),
    () => app.modules.purchasing(owner),
    () => app.modules.booksTax(owner),
    () => app.modules.sales(owner),
    () => app.modules.projects(owner),
    () => app.modules.assets(owner),
    () => app.modules.logistics(owner),
    () => app.modules.logisticsFinance(owner),
    () => app.modules.group(owner),
    () => app.modules.intercompany(owner),
    () => app.finance.appraisal(owner),
    () => app.finance.scenarios(owner),
    () => app.assistant.conversations(owner),
  ])
    await view();
  expect((await app.finance.appraisal(owner)).empty).toBe(true);
  const conv = await app.assistant.conversations(owner);
  expect(conv.scopeLabel).toBe('Phạm vi: Tiệm bánh Thu Hà, tháng 11');
  expect(JSON.stringify(conv.suggestions)).not.toMatch(/DS-1031|tháng 10/);
  expect((await app.modules.group(owner)).items.map((r) => r.name)).toEqual(['Tiệm bánh Thu Hà']);

  // Structure: one store
  const store1 = await app.org.addEntity(owner, { kind: 'SITE', name: 'Cửa hàng Nguyễn Trãi' });
  await expectAppError(app.org.addEntity(owner, { kind: 'SITE', name: 'cửa hàng nguyễn trãi' }), 'CONFLICT');
  expect((await app.org.settings(owner)).entities.map((e) => e.kindLabel)).toEqual(['Pháp nhân', 'Cơ sở']);

  // Intake: POS export, bank statement, two e-invoices
  // A VAT invoice (net lines + VAT = gross total) must pass review and confirmation.
  const vatXml = `<?xml version="1.0"?><HDon><DLHDon><TTChung><KHMSHDon>1</KHMSHDon><KHHDon>C26TBM</KHHDon><SHDon>0000999</SHDon><NLap>2026-11-09</NLap></TTChung><NDHDon><NBan><Ten>Công ty TNHH Bột mì Sao Vàng</Ten><MST>0312987656</MST></NBan><NMua><Ten>Tiệm bánh Thu Hà</Ten><MST>8765432103</MST></NMua><DSHHDVu><HHDVu><THHDVu>Bột mì</THHDVu><ThTien>2500000</ThTien></HHDVu></DSHHDVu><TToan><TgTCThue>2500000</TgTCThue><TgTThue>250000</TgTThue><TgTTTBSo>2750000</TgTTTBSo></TToan></NDHDon></DLHDon><MCCQT Id="cqt">00F0A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5</MCCQT><DSCKS><NBan><Signature/></NBan></DSCKS></HDon>`;
  const vatDoc = (
    await app.documents.intake(owner, { entityId: store1.id, files: [{ name: 'hd-vat.xml', text: vatXml }] })
  ).files[0]!;
  const vatFull = await app.documents.getDocument(owner, { documentId: vatDoc.documentId });
  expect(vatFull.document.issues.filter((i) => i.severity === 'error')).toEqual([]);
  await app.documents.confirmDocument(owner, {
    documentId: vatDoc.documentId,
    fields: vatFull.document.fields,
    acknowledgeWarnings: true,
  });

  const intake = await app.documents.intake(owner, {
    entityId: store1.id,
    files: [
      { name: 'don-hang.csv', text: pos },
      { name: 'sao-ke.csv', text: bank },
      { name: 'hd-215.xml', text: xml('0000215', 2_750_000) },
      { name: 'hd-216.xml', text: xml('0000216', 1_200_000) },
    ],
  });
  expect(intake.files.length).toBe(4);
  const page1 = await app.documents.listDocuments(owner, { pageSize: 5 });
  expect(page1.total).toBe(5);
  expect(page1.pageCount).toBe(1);
  const tiny = await app.documents.listDocuments(owner, { pageSize: 5, page: 99 });
  expect(tiny.page).toBe(1); // clamped

  // Reconciliation only uses confirmed source files: the run says what is still waiting
  const early = await app.recon.run(owner, { entityId: store1.id, periodId: '2026-11' });
  expect(early.groups).toBe(0);
  expect(early.pendingSources).toBe(2);
  for (const f of intake.files.filter((x) => /csv$/.test(x.filename)))
    await app.documents.confirmDocument(owner, { documentId: f.documentId });
  const run = await app.recon.run(owner, { entityId: store1.id, periodId: '2026-11' });
  expect(run.groups).toBe(2);
  expect(run.pendingSources).toBe(0);
  const groups = (await app.recon.summary(owner)).items;
  for (const g of groups) {
    const detail = await app.recon.getGroup(owner, { groupId: g.id });
    await app.recon.confirm(owner, { groupId: g.id, digest: detail.group.digest });
  }
  expect((await app.recon.summary(owner)).kpis.matched).toBe(2);

  // G1: open a shift, count the till, submit with a note for the difference
  const shift = await app.modules.openShift(owner, {
    entityId: store1.id,
    date: '2026-11-12',
    shift: 'Ca sáng',
    system: { cash: '1500000', transfer: '800000', platform: '0' },
  });
  await expectAppError(
    app.modules.openShift(owner, { entityId: store1.id, date: '2026-11-12', shift: 'ca sáng', system: {} }),
    'CONFLICT',
  );
  await expectAppError(
    app.modules.submitDailyClose(owner, {
      shiftId: shift.id,
      counted: { 'Tiền mặt': '1450000', 'Chuyển khoản': '800000', 'Nền tảng giao hàng': '0' },
    }),
    'VALIDATION',
  );
  await app.modules.submitDailyClose(owner, {
    shiftId: shift.id,
    counted: { 'Tiền mặt': '1450000', 'Chuyển khoản': '800000', 'Nền tảng giao hàng': '0' },
    note: 'Trả lại tiền thừa cho khách',
  });
  expect((await app.modules.dailyClose(owner)).history[0]!.diffLabel).toBe('−50.000 đ');

  // G1: stock and recipe costing
  const flour = await app.modules.addInventoryItem(owner, {
    name: 'Bột mì',
    unit: 'kg',
    onHand: '50',
    unitCost: '20000',
    reorderLevel: '10',
  });
  const butter = await app.modules.addInventoryItem(owner, {
    name: 'Bơ',
    unit: 'kg',
    onHand: '5',
    unitCost: '180000',
    reorderLevel: '5',
  });
  await app.modules.saveRecipe(owner, {
    name: 'Bánh mì bơ',
    price: '25000',
    wasteRate: '0.05',
    lines: [
      { itemId: flour.id, quantity: '0.1' },
      { itemId: butter.id, quantity: '0.02' },
    ],
  });
  const inv = await app.modules.inventory(owner);
  expect(inv.items.length).toBe(2);
  expect(inv.kpis[1]!.value).toBe('1 mặt hàng'); // butter at reorder level
  expect(inv.recipe!.total).toBe('5.880 đ'); // (0.1×20.000 + 0.02×180.000) × 1,05

  // Purchase order → approval; separation of duties needs a second person
  const po = await app.modules.createPurchaseOrder(owner, {
    supplier: 'Bột mì Sao Vàng',
    amount: '2750000',
    dueDate: '2026-11-20',
    purpose: 'Nhập bột mì',
  });
  const apv = await app.approvals.get(owner, { approvalId: po.approvalId });
  expect(apv.canDecide).toBe(false);
  const inv2 = await app.org.inviteMember(owner, {
    email: 'duyet@tiembanh.vn',
    role: 'APPROVER',
    entityIds: '*',
    approvalLimit: '10000000',
  });
  const approver = await signUp(app, 'Lê Văn Duyệt', 'duyet@tiembanh.vn');
  await app.org.respondInvitation(approver, { code: inv2.code, accept: true });
  await app.org.selectWorkspace(approver, { tenantId: org.tenantId });
  const a2 = await app.approvals.get(approver, { approvalId: po.approvalId });
  expect(a2.canDecide).toBe(true);
  await app.approvals.decide(approver, {
    approvalId: po.approvalId,
    decision: 'APPROVE',
    digest: a2.approval.digest,
  });

  // G2: deal pipeline
  const deal = await app.modules.createDeal(owner, { customer: 'Quán cà phê Gió', value: '12000000' });
  await app.modules.updateDealStage(owner, { dealId: deal.id, stage: 'CONTRACT' });
  expect((await app.modules.sales(owner)).items[0]!.stage).toBe('Hợp đồng');

  // G3: project, WBS, budget; appraisal; assets; logistics
  const proj = await app.modules.createProject(owner, {
    name: 'Mở cửa hàng thứ hai',
    manager: 'Trần Thu Hà',
    budget: '300000000',
  });
  await app.modules.addWbsTask(owner, { projectId: proj.id, name: 'Thuê mặt bằng', owner: 'Thu Hà' });
  await app.modules.addWbsTask(owner, {
    projectId: proj.id,
    name: 'Sửa chữa',
    owner: 'Đội thợ',
    dependsOn: '1.1',
  });
  await expectAppError(
    app.modules.updateWbsTask(owner, { projectId: proj.id, code: '1.2', progress: 30 }),
    'VALIDATION',
  );
  await app.modules.updateWbsTask(owner, { projectId: proj.id, code: '1.1', progress: 100 });
  await app.modules.recordProjectCost(owner, { projectId: proj.id, kind: 'RECORDED', amount: '60000000' });
  const pv = await app.modules.projects(owner, { projectId: proj.id });
  expect(pv.kpis.map((k) => k.value)).toEqual(['300 triệu đ', '60 triệu đ', '0 triệu đ']);
  expect(pv.project!.tasks.map((t) => t.statusLabel)).toEqual(['Hoàn tất', 'Chưa bắt đầu']);

  const fp = await app.finance.createProject(owner, {
    name: 'Cửa hàng thứ hai',
    assumptions: {
      investment: '300',
      annualCashflow: '90',
      years: 5,
      discountRate: '0.12',
      annualDebtService: '60',
    },
  });
  const ap = await app.finance.appraisal(owner, { projectId: fp.id });
  // The first calculation is recorded like every recalculation (reproducible CalcRun).
  const runs = await app.finance.calcRuns(owner);
  expect(runs).toHaveLength(1);
  expect(runs[0]!.task).toBe('project_appraisal');
  if (ap.empty) throw new Error('appraisal missing');
  expect(ap.result.dscrLabel).toBe('1,50 lần');
  expect((await app.finance.scenarios(owner)).scenarios.map((s) => s.name)).toEqual([
    'Thận trọng',
    'Cơ sở',
    'Tích cực',
  ]);

  const oven = await app.modules.addAsset(owner, {
    kind: 'ASSET',
    name: 'Lò nướng đối lưu',
    schedule: 'Bảo trì 3 tháng',
    dueDate: '2026-11-15',
  });
  await app.modules.addAsset(owner, {
    kind: 'METRIC',
    name: 'Điện năng cửa hàng',
    unit: 'kWh',
    baseline: '1200',
    reporting: '1000',
  });
  let assets = await app.modules.assets(owner);
  expect(assets.kpis.map((k) => k.value)).toEqual(['1 tài sản', '200 kWh', '1 lịch']);
  expect(assets.title).toBe('Đo lường & kiểm chứng: Tiệm bánh Thu Hà');
  await app.modules.completeMaintenance(owner, { assetId: oven.id, nextDueDate: '2027-02-15' });
  assets = await app.modules.assets(owner);
  expect(assets.kpis[2]!.value).toBe('0 lịch');

  const sh = await app.modules.createShipment(owner, {
    route: 'Cát Lái → Kho Thủ Đức',
    container: '1×20DC',
    freeTimeStart: '2026-11-05',
    freeDays: 3,
    storageRatePerDay: '400000',
    revenue: '20000000',
    costs: [{ name: 'Cước vận chuyển', basis: '1 container', amount: '9000000' }],
    allocation: [
      { item: 'Bột mì', weightShare: '0.7' },
      { item: 'Bơ', weightShare: '0.3' },
    ],
  });
  await app.modules.addShipmentEvent(owner, {
    shipmentId: sh.id,
    title: 'Container ra cổng',
    status: 'DELIVERING',
    document: 'Phiếu EIR',
  });
  await app.modules.addShipmentCost(owner, { shipmentId: sh.id, name: 'Phí nội địa', amount: '2000000' });
  const lf = await app.modules.logisticsFinance(owner, { shipmentId: sh.id });
  expect(lf.shipment!.costs.find((c) => c.name === 'Lưu bãi')!.amountLabel).toBe('1.600.000 đ'); // 12/11 − 05/11 = 7 days, 3 free → 4 × 400.000
  expect(lf.shipment!.kpis[1]!.value).toBe('12.600.000 đ');
  await app.modules.confirmAllocation(owner, { shipmentId: sh.id });
  await expectAppError(
    app.modules.addShipmentCost(owner, { shipmentId: sh.id, name: 'Khác', amount: '1' }),
    'CONFLICT',
  );

  // G4: a second legal entity and an intercompany pair
  const sub = await app.org.addEntity(owner, { kind: 'LEGAL_ENTITY', name: 'Công ty TNHH Bánh Thu Hà' });
  const pair = await app.modules.createIntercompanyPair(owner, {
    reference: 'IC-2611-01',
    sideAEntityId: org.entityId,
    sideAAmount: '5000000',
    sideBEntityId: sub.id,
    sideBAmount: '4800000',
  });
  let icv = await app.modules.intercompany(owner, { pairId: pair.id });
  expect(icv.pair!.status).toBe('DIFFERENCE');
  expect(
    (
      await app.modules.updateIntercompanyAmounts(owner, {
        pairId: pair.id,
        sideAAmount: '5000000',
        sideBAmount: '5000000',
      })
    ).matched,
  ).toBe(true);
  icv = await app.modules.intercompany(owner);
  expect(icv.pair!.status).toBe('MATCHED');
  expect((await app.modules.group(owner)).items.length).toBe(2);

  // Close November for the store, then the books move to December
  const remaining = (await app.documents.listDocuments(owner, { status: 'review' })).items;
  for (const d of remaining) {
    const full = await app.documents.getDocument(owner, { documentId: d.id });
    await app.documents.confirmDocument(owner, {
      documentId: d.id,
      fields: full.document.fields,
      acknowledgeWarnings: true,
    });
  }
  await stepUp(app, owner);
  const st = await app.close.status(owner, { entityId: store1.id });
  expect(st.status).not.toBe('CLOSED');
  if (st.ready) {
    await app.close.close(owner, { entityId: store1.id, periodId: '2026-11', digest: st.draftDigest });
    ctx = await app.org.context(owner);
    expect(ctx.tenant.settings.currentPeriod).toBe('2026-12');
  } else {
    throw new Error(`close not ready: ${JSON.stringify(st.checklist)}`);
  }
  nowMs += 0;
}
