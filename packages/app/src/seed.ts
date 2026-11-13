import {
  canonicalize,
  D,
  dec,
  EVIDENCE_SCHEMA_VERSION,
  randomHex,
  saltedFingerprint,
  sha256Hex,
  sum,
  targetDigest,
  APPROVAL_POLICY_VERSION,
  DEFAULT_RULES,
} from '@argolet/core';
import type { ArgoletApp } from './app';
import type { Tx } from './store';
import { defaultIntegrations } from './services/org';
import { groupDigest } from './services/recon';
import {
  GLOBAL,
  type BusinessRecordRow,
  type DocumentRow,
  type DocumentVersionRow,
  type MatchGroupRow,
  type NewRow,
  type StructuredRow,
} from './types';

/** Demo dataset: "Minh An Commerce", October 2026 — the scenario drawn in the Figma design. */
export const DEMO_PASSWORD = 'Argolet@2026';
export const DEMO_EMAIL = 'ketoan@minhan.example';
/** 31/10/2026 09:40 (UTC+7): the moment the design screens depict. */
export const DEMO_NOW = '2026-10-31T02:40:00.000Z';
export const DEMO_TENANT = 'ten_minhan';

/** A clock that starts at DEMO_NOW and then advances in real time. */
export function demoClock(startedAt: number = Date.now()): () => Date {
  const base = Date.parse(DEMO_NOW);
  return () => new Date(base + (Date.now() - startedAt));
}

const T = DEMO_TENANT;
const SITES = { q3: 'site_q3', q1: 'site_q1', td: 'site_td' } as const;
type SiteId = (typeof SITES)[keyof typeof SITES];
const USERS = {
  admin: 'usr_minhanh',
  staff: 'usr_nguyenminhanh',
  accountant: 'usr_thanhha',
  approver: 'usr_hainam',
} as const;

/** Local Vietnam time (UTC+7) → ISO UTC. */
const vn = (date: string, time = '09:00') => new Date(Date.parse(`${date}T${time}:00+07:00`)).toISOString();
const day = (d: number) => `2026-10-${String(d).padStart(2, '0')}`;

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface GroupSpec {
  code: string;
  site: SiteId;
  date: string;
  orders: { code: string; gross: string; fee: string; refund: string; channel: string }[];
  receipts: { code: string; amount: string; kind: 'BANK_TXN' | 'CASH' }[];
  status: MatchGroupRow['status'];
  sourceLabel: string;
  payoutBatch: string;
  orderDoc: string | null;
  bankDoc: string | null;
}

export async function isSeeded(app: ArgoletApp): Promise<boolean> {
  return app.core.store.read(async (tx) => !!(await tx.get('tenants', T, T)));
}

export async function seedDemo(app: ArgoletApp): Promise<{ seeded: boolean }> {
  if (await isSeeded(app)) return { seeded: false };
  const hash = await app.deps.hasher.hash(DEMO_PASSWORD);
  const rnd = prng(20261031);
  const pick = <V>(arr: readonly V[]) => arr[Math.floor(rnd() * arr.length)]!;
  const roundTo = (v: number, step: number) => Math.max(step, Math.round(v / step) * step);

  // ─────────────── master data ───────────────
  await app.core.store.transaction(async (tx) => {
    const put = <K extends Parameters<Tx['put']>[0]>(col: K, row: NewRow<K>) => tx.put(col, row);
    const users = [
      { id: USERS.admin, fullName: 'Minh Anh', email: DEMO_EMAIL },
      { id: USERS.staff, fullName: 'Nguyễn Minh Anh', email: 'minhanh.nguyen@minhan.example' },
      { id: USERS.accountant, fullName: 'Trần Thanh Hà', email: 'thanhha@minhan.example' },
      { id: USERS.approver, fullName: 'Lê Hải Nam', email: 'hainam@minhan.example' },
    ];
    for (const u of users) {
      await put('users', {
        ...u,
        tenantId: GLOBAL,
        phone: null,
        status: 'ACTIVE',
        verifiedAt: vn('2026-09-01'),
        totpSecret: null,
        mfaEnabledAt: null,
        failedLogins: 0,
        lockedUntil: null,
        lastLoginAt: null,
        pendingInvitationCode: null,
        createdAt: vn('2026-09-01'),
      });
      await put('credentials', {
        id: u.id,
        tenantId: GLOBAL,
        userId: u.id,
        passwordHash: hash,
        passwordUpdatedAt: vn('2026-09-01'),
        createdAt: vn('2026-09-01'),
      });
    }
    await put('tenants', {
      id: T,
      tenantId: T,
      name: 'Minh An Commerce',
      orgType: 'Doanh nghiệp thương mại',
      taxCode: '0312345678',
      policyVersion: 'policy-2026.10',
      settings: {
        currency: 'VND',
        timezone: 'Asia/Ho_Chi_Minh',
        periodType: 'MONTH',
        accountingRegime: 'TT133',
        packages: ['G1', 'G2', 'G3', 'G4'],
        currentPeriod: '2026-10',
        dataLocation: 'Việt Nam',
      },
      createdBy: USERS.admin,
      createdAt: vn('2026-09-01'),
    });
    const ents: [string, string, string, string, 'LEGAL_ENTITY' | 'SITE', string | null][] = [
      ['ent_mah', 'Minh An Holdings', 'Minh An Holdings', 'MAH', 'LEGAL_ENTITY', null],
      ['ent_mar', 'Minh An Retail', 'Minh An', 'MAR', 'LEGAL_ENTITY', null],
      ['ent_mal', 'Minh An Logistics', 'Minh An Logistics', 'MAL', 'LEGAL_ENTITY', null],
      ['ent_mae', 'Minh An Energy', 'Minh An Energy', 'MAE', 'LEGAL_ENTITY', null],
      [SITES.q3, 'Cơ sở Quận 3', 'Quận 3', 'S1-Q3', 'SITE', 'ent_mar'],
      [SITES.q1, 'Cơ sở Quận 1', 'Quận 1', 'S2-Q1', 'SITE', 'ent_mar'],
      [SITES.td, 'Cơ sở Thủ Đức', 'Thủ Đức', 'S3-TD', 'SITE', 'ent_mar'],
    ];
    for (const [id, name, shortName, code, kind, parentId] of ents) {
      await put('entities', {
        id,
        tenantId: T,
        name,
        shortName,
        code,
        kind,
        parentId,
        baseCurrency: 'VND',
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: vn('2026-09-01'),
      });
    }
    const members: NewRow<'memberships'>[] = [
      {
        id: 'mem_admin',
        tenantId: T,
        userId: USERS.admin,
        displayName: 'Minh Anh',
        title: 'Quản trị tổ chức',
        bindings: [
          { role: 'ORG_ADMIN', entityIds: '*', approvalLimit: null },
          { role: 'CHIEF_ACCOUNTANT', entityIds: '*', approvalLimit: 'POLICY' },
        ],
        status: 'ACTIVE',
        scopeLabel: 'Toàn tổ chức',
        limitLabel: 'Theo chính sách',
        createdAt: vn('2026-09-01', '08:00'),
      },
      {
        id: 'mem_staff',
        tenantId: T,
        userId: USERS.staff,
        displayName: 'Nguyễn Minh Anh',
        title: 'Nhân viên',
        bindings: [{ role: 'STAFF', entityIds: [SITES.q3], approvalLimit: null }],
        status: 'ACTIVE',
        scopeLabel: 'Cơ sở Quận 3',
        limitLabel: 'Không cấp',
        createdAt: vn('2026-09-01', '08:01'),
      },
      {
        id: 'mem_accountant',
        tenantId: T,
        userId: USERS.accountant,
        displayName: 'Thanh Hà',
        title: 'Kế toán',
        bindings: [{ role: 'ACCOUNTANT', entityIds: '*', approvalLimit: null }],
        status: 'ACTIVE',
        scopeLabel: '3 cơ sở',
        limitLabel: 'Không cấp',
        createdAt: vn('2026-09-01', '08:02'),
      },
      {
        id: 'mem_approver',
        tenantId: T,
        userId: USERS.approver,
        displayName: 'Hải Nam',
        title: 'Người duyệt',
        bindings: [{ role: 'APPROVER', entityIds: ['ent_mae'], approvalLimit: '50000000' }],
        status: 'ACTIVE',
        scopeLabel: 'Dự án DA-001',
        limitLabel: '50.000.000 đ',
        createdAt: vn('2026-09-01', '08:03'),
      },
    ];
    for (const m of members) await put('memberships', m);
    // Second workspace (view only).
    await put('tenants', {
      id: 'ten_anviet',
      tenantId: 'ten_anviet',
      name: 'An Việt Logistics',
      orgType: 'Logistics',
      taxCode: '0315556677',
      policyVersion: 'policy-2026.10',
      settings: {
        currency: 'VND',
        timezone: 'Asia/Ho_Chi_Minh',
        periodType: 'MONTH',
        accountingRegime: 'TT200',
        packages: ['G3'],
        currentPeriod: '2026-10',
        dataLocation: 'Việt Nam',
      },
      createdBy: USERS.approver,
      createdAt: vn('2026-09-15'),
    });
    await put('entities', {
      id: 'ent_anviet',
      tenantId: 'ten_anviet',
      name: 'An Việt Logistics',
      shortName: 'An Việt',
      code: 'AVL',
      kind: 'LEGAL_ENTITY',
      parentId: null,
      baseCurrency: 'VND',
      timezone: 'Asia/Ho_Chi_Minh',
    });
    await put('memberships', {
      id: 'mem_anviet_admin',
      tenantId: 'ten_anviet',
      userId: USERS.admin,
      displayName: 'Minh Anh',
      title: 'Chỉ xem',
      bindings: [{ role: 'VIEWER', entityIds: '*', approvalLimit: null }],
      status: 'ACTIVE',
      scopeLabel: 'Toàn tổ chức',
      limitLabel: 'Không cấp',
    });
    for (const integ of defaultIntegrations('ten_anviet')) await put('integrations', integ);
    for (const integ of defaultIntegrations(T)) {
      const connected = ['POS', 'PLATFORM', 'BANK', 'EINVOICE'].includes(integ.kind);
      await put('integrations', {
        ...integ,
        status: connected ? 'CONNECTED' : 'AVAILABLE',
        connectedAt: connected ? vn('2026-09-02') : null,
      });
    }
    await put('invitations', {
      id: 'inv_demo',
      tenantId: GLOBAL,
      orgTenantId: T,
      orgName: 'Minh An Commerce',
      code: 'MOI-2026',
      email: 'nhanvien.moi@minhan.example',
      role: 'ACCOUNTANT',
      entityIds: [SITES.q3],
      scopeLabel: 'Cơ sở Quận 3',
      permissionsLabel: 'Xem, lập, gửi hồ sơ',
      approvalLimit: null,
      invitedBy: USERS.staff,
      inviterName: 'Nguyễn Minh Anh',
      expiresAt: '2027-12-31T00:00:00.000Z',
      status: 'PENDING',
    });
    for (const s of Object.values(SITES)) {
      await put('periods', {
        id: `per_2026-10_${s}`,
        tenantId: T,
        entityId: s,
        periodId: '2026-10',
        status: 'OPEN',
        closeMemoPrepared: false,
        closeId: null,
        version: 1,
      });
    }
  });

  // ─────────────── reconciliation groups (90) ───────────────
  const channels = [
    { name: 'GrabFood', fee: 0.22 },
    { name: 'ShopeeFood', fee: 0.2 },
    { name: 'BeFood', fee: 0.18 },
  ];
  const groups: GroupSpec[] = [];
  const mkOrders = (
    prefix: string,
    grosses: number[],
    fees: number[],
    channel: string,
    refunds: number[] = [],
  ) =>
    grosses.map((g, i) => ({
      code: `${prefix}-${String(i + 1).padStart(2, '0')}`,
      gross: String(g),
      fee: String(fees[i] ?? 0),
      refund: String(refunds[i] ?? 0),
      channel,
    }));
  // Visible groups (Figma screens 14, 15, 38).
  groups.push({
    code: 'DS-1032',
    site: SITES.q3,
    date: day(31),
    orders: mkOrders('DH-1032', [450000, 400000, 400000], [45000, 40000, 40000], 'ShopeeFood'),
    receipts: [
      { code: 'GD-883021', amount: '600000', kind: 'BANK_TXN' },
      { code: 'GD-883022', amount: '525000', kind: 'BANK_TXN' },
    ],
    status: 'PROPOSED',
    sourceLabel: 'Nền tảng',
    payoutBatch: 'TT-1032',
    orderDoc: null,
    bankDoc: 'CT-1026',
  });
  groups.push({
    code: 'DS-1031',
    site: SITES.q3,
    date: day(31),
    orders: mkOrders('DH-1031', [450000, 400000, 400000], [45000, 40000, 40000], 'ShopeeFood'),
    receipts: [{ code: 'GD-883019', amount: '1125000', kind: 'BANK_TXN' }],
    status: 'PENDING_APPROVAL',
    sourceLabel: 'Nền tảng',
    payoutBatch: 'TT-1031',
    orderDoc: 'CT-1025',
    bankDoc: 'CT-1026',
  });
  groups.push({
    code: 'DS-1030',
    site: SITES.q3,
    date: day(31),
    orders: mkOrders('DH-1030', [620000, 540000, 480000, 590000, 450000], [0, 0, 0, 0, 0], 'Chuyển khoản'),
    receipts: [{ code: 'GD-883012', amount: '2630000', kind: 'BANK_TXN' }],
    status: 'DISCREPANCY',
    sourceLabel: 'Ngân hàng',
    payoutBatch: 'CK-1030',
    orderDoc: null,
    bankDoc: 'CT-1026',
  });
  groups.push({
    code: 'DS-1029',
    site: SITES.q3,
    date: day(30),
    orders: mkOrders('DH-1029', [450000], [0], 'Tiền mặt'),
    receipts: [{ code: 'TM-301029', amount: '450000', kind: 'CASH' }],
    status: 'CONFIRMED',
    sourceLabel: 'Tiền mặt',
    payoutBatch: 'TM-1029',
    orderDoc: null,
    bankDoc: null,
  });
  groups.push({
    code: 'DS-1028',
    site: SITES.q3,
    date: day(29),
    orders: mkOrders(
      'DH-1028',
      [520000, 480000, 410000, 460000, 390000, 520000, 450000, 450000],
      [78000, 72000, 61500, 69000, 58500, 78000, 67500, 67500],
      'GrabFood',
    ),
    receipts: [{ code: 'GD-882977', amount: '3128000', kind: 'BANK_TXN' }],
    status: 'CONFIRMED',
    sourceLabel: 'Nền tảng',
    payoutBatch: 'TT-1028',
    orderDoc: null,
    bankDoc: 'CT-1026',
  });

  const special: Record<number, MatchGroupRow['status']> = {
    1027: 'PROPOSED',
    1026: 'PROPOSED',
    1021: 'PROPOSED',
    1018: 'PROPOSED',
    1024: 'DISCREPANCY',
  };
  const siteCycle: SiteId[] = [SITES.q1, SITES.td, SITES.q3];
  const generic = (
    n: number,
    d: number,
    forced?: { gross: number; fee: number; received: number },
  ): GroupSpec => {
    const ch = pick(channels);
    const site = special[n] ? (n % 2 ? SITES.q1 : SITES.td) : siteCycle[n % 3]!;
    let orders;
    let received: number;
    if (forced) {
      orders = [
        {
          code: `DH-${n}-01`,
          gross: String(forced.gross),
          fee: String(forced.fee),
          refund: '0',
          channel: ch.name,
        },
      ];
      received = forced.received;
    } else {
      const count = 1 + Math.floor(rnd() * 5);
      const grosses = Array.from({ length: count }, () => roundTo(250000 + rnd() * 450000, 10000));
      const fees = grosses.map((g) => Math.round((g * ch.fee) / 500) * 500);
      const refunds = grosses.map(() => (rnd() < 0.08 ? 20000 : 0));
      orders = grosses.map((g, i) => ({
        code: `DH-${n}-${String(i + 1).padStart(2, '0')}`,
        gross: String(g),
        fee: String(fees[i]),
        refund: String(refunds[i]),
        channel: ch.name,
      }));
      received = sum(orders.map((o) => D(o.gross).minus(o.fee).minus(o.refund))).toNumber();
    }
    const status = special[n] ?? 'CONFIRMED';
    if (status === 'DISCREPANCY') received -= 120000;
    const split = !forced && received > 1_500_000 && rnd() < 0.3;
    const receipts = split
      ? [
          { code: `GD-88${n}1`, amount: String(Math.round(received * 0.55)), kind: 'BANK_TXN' as const },
          {
            code: `GD-88${n}2`,
            amount: String(received - Math.round(received * 0.55)),
            kind: 'BANK_TXN' as const,
          },
        ]
      : [{ code: `GD-88${n}0`, amount: String(received), kind: 'BANK_TXN' as const }];
    return {
      code: `DS-${String(n).padStart(4, '0')}`,
      site,
      date: day(d),
      orders,
      receipts,
      status,
      sourceLabel: 'Nền tảng',
      payoutBatch: `TT-${String(n).padStart(4, '0')}`,
      orderDoc: null,
      bankDoc: null,
    };
  };
  // Window 20–28 Oct belongs to statement CT-1026 ("Sao kê tháng 10") whose total must be 24.600.000 đ.
  const visibleBank = sum(
    groups.flatMap((g) => g.receipts.filter((r) => r.kind === 'BANK_TXN').map((r) => r.amount)),
  );
  const windowTarget = D(24_600_000).minus(visibleBank).toNumber();
  const genericCodes = Array.from({ length: 85 }, (_, i) => 943 + i); // DS-0943 … DS-1027
  const windowGroups: GroupSpec[] = [];
  const otherGroups: GroupSpec[] = [];
  let windowSum = 0;
  const descending = genericCodes.slice().reverse(); // newest codes first → window
  let idx = 0;
  while (idx < descending.length) {
    const n = descending[idx]!;
    if (special[n]) {
      // proposals / discrepancies stay out of the statement window (their money arrived via another account)
      otherGroups.push(generic(n, 27 + (n % 2)));
      idx++;
      continue;
    }
    const g = generic(n, 20 + (idx % 9));
    const amt = sum(g.receipts.map((r) => r.amount)).toNumber();
    if (windowSum + amt > windowTarget - 900_000) break;
    windowSum += amt;
    windowGroups.push(g);
    idx++;
  }
  // Balancing group A closes the window exactly.
  const balA = descending[idx++]!;
  const recA = windowTarget - windowSum;
  const grossA = Math.ceil(recA / 0.8 / 1000) * 1000;
  windowGroups.push(generic(balA, 28, { gross: grossA, fee: grossA - recA, received: recA }));
  const rest = descending.slice(idx);
  const balB = rest.pop()!; // oldest code balances total platform revenue
  rest.forEach((n, i) => otherGroups.push(generic(n, 1 + Math.floor((i / rest.length) * 19))));
  groups.push(...windowGroups.map((g) => ({ ...g, bankDoc: 'CT-1026' })), ...otherGroups);
  const grossSoFar = sum(groups.flatMap((g) => g.orders.map((o) => o.gross))).toNumber();
  const grossB = 180_000_000 - grossSoFar;
  if (grossB < 200_000) throw new Error(`Seed balancing failed (grossB=${grossB})`);
  const feeB = Math.round(grossB * 0.2);
  groups.push(generic(balB, 1, { gross: grossB, fee: feeB, received: grossB - feeB }));
  // Assign statement documents to receipts outside the window by date.
  for (const g of groups) {
    if (g.bankDoc || g.receipts.every((r) => r.kind === 'CASH')) continue;
    const d = Number(g.date.slice(8));
    g.bankDoc = d <= 9 ? 'CT-STMT-1' : 'CT-STMT-2';
  }
  for (const g of groups) {
    if (g.orderDoc) continue;
    const d = Number(g.date.slice(8));
    if (g.code === 'DS-1032' || g.code === 'DS-1030' || g.code === 'DS-1029' || g.code === 'DS-1028')
      continue;
    g.orderDoc = d <= 9 ? 'CT-PLAT-1' : d <= 19 ? 'CT-PLAT-2' : 'CT-PLAT-3';
  }

  // ─────────────── documents (128 = CT-0901 … CT-1028) ───────────────
  interface DocPlan {
    key: string;
    pinned?: number;
    date: string;
    receivedAt: string;
    validatedAt: string | null;
    doc: Omit<
      DocumentRow,
      | 'id'
      | 'code'
      | 'tenantId'
      | 'createdAt'
      | 'updatedAt'
      | 'rev'
      | 'receivedAt'
      | 'validatedAt'
      | 'currentVersion'
      | 'artifactId'
      | 'batchId'
      | 'receivedBy'
      | 'validatedBy'
    >;
    versions?: { at: string; by: string; byName: string; note: string }[];
    xml?: string;
    receivedBy?: string;
    validatedBy?: string;
  }
  const plans: DocPlan[] = [];
  const expFields = (
    supplier: string,
    documentNo: string,
    date: string,
    total: string,
    taxCode?: string,
  ) => ({ supplier, documentNo, documentDate: date, total, taxCode });
  const base = {
    rows: [] as StructuredRow[],
    rowKind: null as DocumentRow['rowKind'],
    extraction: null,
    issues: [] as DocumentRow['issues'],
    lines: [] as DocumentRow['lines'],
  };
  const xml1027 = `<?xml version="1.0" encoding="UTF-8"?>
<HDon><DLHDon><TTChung><PBan>2.0.1</PBan><THDon>HÓA ĐƠN GIÁ TRỊ GIA TĂNG</THDon><KHHDon>1C26TNV</KHHDon><SHDon>00412</SHDon><NLap>2026-10-30</NLap><DVTTe>VND</DVTTe></TTChung>
<NDHDon><NBan><Ten>Nguyên liệu Việt</Ten><MST>0312345678</MST><DChi>Quận 7, TP. Hồ Chí Minh</DChi></NBan><NMua><Ten>Minh An Retail</Ten><MST>0309876543</MST></NMua>
<DSHHDVu><HHDVu><STT>1</STT><THHDVu>Cà phê hạt Robusta</THHDVu><DVTinh>kg</DVTinh><SLuong>8</SLuong><DGia>300000</DGia><ThTien>2400000</ThTien></HHDVu><HHDVu><STT>2</STT><THHDVu>Sữa tươi tiệt trùng</THHDVu><DVTinh>hộp</DVTinh><SLuong>32</SLuong><DGia>40000</DGia><ThTien>1280000</ThTien></HHDVu></DSHHDVu>
<TToan><TgTCThue>3680000</TgTCThue><TgTThue>0</TgTThue><TgTTTBSo>3680000</TgTTTBSo><TgTTTBChu>Ba triệu sáu trăm tám mươi nghìn đồng</TgTTTBChu></TToan></NDHDon></DLHDon>
<DSCKS><NBan><Signature Id="seller">MIIDemoSignatureValue</Signature></NBan></DSCKS></HDon>
`;
  plans.push({
    key: 'CT-1028',
    pinned: 1028,
    date: day(31),
    receivedAt: vn(day(31), '09:30'),
    validatedAt: null,
    receivedBy: USERS.staff,
    doc: {
      ...base,
      title: 'Hóa đơn mua hàng',
      counterparty: 'Nguyên liệu Việt',
      sourceKind: 'PHOTO',
      entityId: SITES.q3,
      date: day(31),
      amount: '7250000',
      status: 'NEEDS_REVIEW',
      kind: 'EXPENSE',
      fields: expFields('Nguyên liệu Việt', 'HD-00318', day(31), '7250000'),
      lines: [
        { description: 'Cà phê hạt · 15 kg', amount: '3750000' },
        { description: 'Sữa tươi · 100 hộp', amount: '2500000' },
        { description: 'Bao bì · 1 lô', amount: '1000000' },
      ],
      extraction: {
        modelVersion: 'vlm-receipt-2026.10',
        fields: [
          { name: 'supplier', value: 'Nguyên liệu Việt', confidence: 0.97, bbox: [40, 70, 400, 92], page: 1 },
          { name: 'documentNo', value: 'HD-00318', confidence: 0.95, bbox: [220, 110, 330, 126], page: 1 },
          { name: 'documentDate', value: day(31), confidence: 0.62, bbox: [40, 110, 200, 126], page: 1 },
          { name: 'total', value: '7250000', confidence: 0.98, bbox: [260, 420, 460, 452], page: 1 },
        ],
      },
      issues: [
        { field: 'documentDate', severity: 'warning', message: 'Kiểm tra lại ngày chứng từ trên ảnh gốc.' },
      ],
    },
  });
  plans.push({
    key: 'CT-1027',
    pinned: 1027,
    date: day(30),
    receivedAt: vn(day(30), '16:20'),
    validatedAt: vn(day(31), '09:32'),
    receivedBy: USERS.admin,
    validatedBy: USERS.accountant,
    xml: xml1027,
    doc: {
      ...base,
      title: 'Nguyên liệu Việt',
      counterparty: 'Nguyên liệu Việt',
      sourceKind: 'XML_EINVOICE',
      entityId: SITES.q3,
      date: day(30),
      amount: '3680000',
      status: 'VALIDATED',
      kind: 'EXPENSE',
      fields: expFields('Nguyên liệu Việt', '00412', day(30), '3680000', '0312345678'),
      lines: [
        { description: 'Cà phê hạt Robusta', amount: '2400000' },
        { description: 'Sữa tươi tiệt trùng', amount: '1280000' },
      ],
    },
    versions: [
      { at: vn(day(30), '16:24'), by: USERS.admin, byName: 'Minh Anh', note: 'Xác nhận phiên bản 01' },
      { at: vn(day(30), '17:05'), by: USERS.accountant, byName: 'Thanh Hà', note: 'Bổ sung thông tin' },
      { at: vn(day(31), '09:32'), by: USERS.accountant, byName: 'Thanh Hà', note: 'Xác nhận phiên bản 03' },
    ],
  });
  plans.push({
    key: 'CT-1026',
    pinned: 1026,
    date: day(30),
    receivedAt: vn(day(30), '11:05'),
    validatedAt: vn(day(31), '08:10'),
    validatedBy: USERS.accountant,
    doc: {
      ...base,
      title: 'Sao kê tháng 10',
      counterparty: 'Ngân hàng Á Châu',
      sourceKind: 'BANK',
      entityId: SITES.q3,
      date: day(30),
      amount: '24600000',
      status: 'VALIDATED',
      kind: 'STATEMENT',
      fields: expFields('Ngân hàng Á Châu', 'SK-ACB-2610', day(30), '24600000'),
      rowKind: 'BANK',
    },
  });
  plans.push({
    key: 'CT-1025',
    pinned: 1025,
    date: day(29),
    receivedAt: vn(day(29), '17:40'),
    validatedAt: null,
    doc: {
      ...base,
      title: 'Báo cáo nền tảng',
      counterparty: 'ShopeeFood',
      sourceKind: 'CSV',
      entityId: SITES.q3,
      date: day(29),
      amount: '1250000',
      status: 'NEEDS_RECON',
      kind: 'STATEMENT',
      fields: expFields('ShopeeFood', 'SPF-TT-1031', day(29), '1250000'),
      rowKind: 'POS',
      issues: [{ field: 'total', severity: 'warning', message: 'Chờ đối soát với khoản tiền về GD-883019' }],
    },
  });
  plans.push({
    key: 'CT-1024',
    pinned: 1024,
    date: day(29),
    receivedAt: vn(day(29), '10:15'),
    validatedAt: vn(day(31), '08:55'),
    validatedBy: USERS.accountant,
    doc: {
      ...base,
      title: 'Phiếu giao hàng',
      counterparty: 'Bao bì An Phát',
      sourceKind: 'PDF',
      entityId: SITES.q3,
      date: day(29),
      amount: '1840000',
      status: 'VALIDATED',
      kind: 'EXPENSE',
      fields: expFields('Bao bì An Phát', 'PGH-2910', day(29), '1840000'),
    },
  });
  plans.push({
    key: 'CT-1019',
    pinned: 1019,
    date: day(27),
    receivedAt: vn(day(31), '07:50'),
    validatedAt: null,
    receivedBy: USERS.approver,
    doc: {
      ...base,
      title: 'Phiếu giao hàng',
      counterparty: 'Vận tải Phương Nam',
      sourceKind: 'PDF',
      entityId: SITES.td,
      date: day(27),
      amount: '3680000',
      status: 'NEEDS_REVIEW',
      kind: 'EXPENSE',
      fields: expFields('Vận tải Phương Nam', '', day(27), '3680000'),
      issues: [{ field: 'documentNo', severity: 'error', message: 'Thiếu số chứng từ' }],
    },
  });
  plans.push({
    key: 'CT-1012',
    pinned: 1012,
    date: day(22),
    receivedAt: vn(day(22), '15:00'),
    validatedAt: null,
    doc: {
      ...base,
      title: 'Biên nhận',
      counterparty: '',
      sourceKind: 'PHOTO',
      entityId: SITES.q1,
      date: day(22),
      amount: '860000',
      status: 'NEEDS_REVIEW',
      kind: 'EXPENSE',
      fields: expFields('', 'BN-2210', day(22), '860000'),
      issues: [{ field: 'supplier', severity: 'error', message: 'Thiếu nhà cung cấp' }],
    },
  });
  // Platform reports & bank statements (structured sources).
  const struct = (
    key: string,
    d: number,
    title: string,
    cp: string,
    kind: 'BANK' | 'CSV',
    rowKind: 'BANK' | 'POS',
  ) =>
    plans.push({
      key,
      date: day(d),
      receivedAt: vn(day(d), '18:00'),
      validatedAt: vn(day(d), '18:30'),
      validatedBy: USERS.accountant,
      doc: {
        ...base,
        title,
        counterparty: cp,
        sourceKind: kind,
        entityId: SITES.q1,
        date: day(d),
        amount: '0',
        status: 'VALIDATED',
        kind: 'STATEMENT',
        fields: expFields(cp, key, day(d), '0'),
        rowKind,
      },
    });
  struct('CT-PLAT-1', 9, 'Báo cáo nền tảng', 'Tổng hợp nền tảng', 'CSV', 'POS');
  struct('CT-PLAT-2', 19, 'Báo cáo nền tảng', 'Tổng hợp nền tảng', 'CSV', 'POS');
  struct('CT-PLAT-3', 28, 'Báo cáo nền tảng', 'Tổng hợp nền tảng', 'CSV', 'POS');
  struct('CT-STMT-1', 9, 'Sao kê ngân hàng', 'Ngân hàng Ngoại thương', 'BANK', 'BANK');
  struct('CT-STMT-2', 19, 'Sao kê ngân hàng', 'Ngân hàng Ngoại thương', 'BANK', 'BANK');
  // POS weekly revenue reports (4 weeks × 3 sites).
  const weeks: [number, number][] = [
    [1, 7],
    [8, 14],
    [15, 21],
    [22, 31],
  ];
  const siteList: [SiteId, string][] = [
    [SITES.q3, 'Quận 3'],
    [SITES.q1, 'Quận 1'],
    [SITES.td, 'Thủ Đức'],
  ];
  for (const [wi, [a, b]] of weeks.entries()) {
    for (const [site, label] of siteList) {
      const d = Math.min(b, 28);
      plans.push({
        key: `CT-POS-${wi}-${site}`,
        date: day(d),
        receivedAt: vn(day(d), '22:00'),
        validatedAt: vn(day(d), '22:15'),
        validatedBy: USERS.accountant,
        doc: {
          ...base,
          title: `Doanh thu POS tuần ${wi + 1}`,
          counterparty: `POS ${label}`,
          sourceKind: 'POS',
          entityId: site,
          date: day(d),
          amount: '0',
          status: 'VALIDATED',
          kind: 'REVENUE',
          fields: expFields(`POS ${label}`, `POS-${label}-T${wi + 1}`, day(d), '0'),
          rowKind: 'POS',
        },
      });
      void a;
    }
  }
  // Expense documents: generic ones fill the remaining codes; with CT-1027 + CT-1024 they total 344.000.000 đ.
  const genericCount = 128 - plans.length;
  const suppliers = [
    'Nguyên liệu Việt',
    'Sữa Xanh',
    'Bao bì An Phát',
    'Điện lực TP.HCM',
    'Cấp nước Sài Gòn',
    'Vận tải Phương Nam',
    'Cà phê Cầu Đất',
    'Văn phòng phẩm Hồng Hà',
    'Thiết bị Bếp Việt',
    'Nhà đất Quận 3',
  ];
  const titles: Record<string, string> = {
    'Điện lực TP.HCM': 'Hóa đơn tiền điện',
    'Cấp nước Sài Gòn': 'Hóa đơn tiền nước',
    'Nhà đất Quận 3': 'Tiền thuê mặt bằng',
  };
  const expenseTarget = 344_000_000 - 3_680_000 - 1_840_000;
  const genericExpenses: { amount: number; d: number; supplier: string }[] = [];
  for (let i = 0; i < genericCount; i++)
    genericExpenses.push({
      amount: roundTo(1_800_000 + rnd() * 2_600_000, 10_000),
      d: 1 + (i % 31),
      supplier: pick(suppliers),
    });
  const expSum = genericExpenses.reduce((a, e) => a + e.amount, 0);
  const scale = expenseTarget / expSum;
  let acc = 0;
  genericExpenses.forEach((e, i) => {
    e.amount = i === genericExpenses.length - 1 ? expenseTarget - acc : roundTo(e.amount * scale, 10_000);
    acc += e.amount;
  });
  genericExpenses.forEach((e, i) => {
    const d = e.d;
    const kindSrc = pick(['XML_EINVOICE', 'XML_EINVOICE', 'PDF', 'PHOTO'] as const);
    plans.push({
      key: `EXP-${i}`,
      date: day(d),
      // Documents of the demo day (31/10) arrive before 09:40 — the moment the design depicts.
      receivedAt:
        d === 31
          ? vn(day(d), `07:${String(10 + ((i * 7) % 40)).padStart(2, '0')}`)
          : vn(day(d), `${String(8 + (i % 9)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`),
      validatedAt: d === 31 ? vn(day(d), '09:28') : vn(day(d), '17:30'),
      validatedBy: i % 3 === 0 ? USERS.admin : USERS.accountant,
      doc: {
        ...base,
        title: kindSrc === 'XML_EINVOICE' ? e.supplier : (titles[e.supplier] ?? 'Hóa đơn mua hàng'),
        counterparty: e.supplier,
        sourceKind: kindSrc,
        entityId: siteCycle[i % 3]!,
        date: day(d),
        amount: String(e.amount),
        status: 'VALIDATED',
        kind: 'EXPENSE',
        fields: expFields(
          e.supplier,
          `HD-${String(100 + i).padStart(5, '0')}`,
          day(d),
          String(e.amount),
          kindSrc === 'XML_EINVOICE' ? '0312345678' : undefined,
        ),
      },
    });
  });
  // Assign codes: pinned ones keep their code, the rest fill CT-0901… in date order.
  const pinnedCodes = new Set(plans.filter((p) => p.pinned).map((p) => p.pinned!));
  const free = Array.from({ length: 128 }, (_, i) => 901 + i).filter((n) => !pinnedCodes.has(n));
  const unpinned = plans.filter((p) => !p.pinned).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  if (unpinned.length !== free.length)
    throw new Error(`Seed: ${unpinned.length} documents for ${free.length} codes`);
  const codeOf = new Map<string, string>();
  plans.filter((p) => p.pinned).forEach((p) => codeOf.set(p.key, `CT-${p.pinned}`));
  unpinned.forEach((p, i) => codeOf.set(p.key, `CT-${String(free[i]).padStart(4, '0')}`));
  const docIdOf = (key: string) => `doc_${codeOf.get(key)!.replace('CT-', '')}`;

  await app.core.store.transaction(async (tx) => {
    const records: NewRow<'records'>[] = [];
    const evidenceLinks: NewRow<'recordEvidence'>[] = [];
    const rowsOf = new Map<string, StructuredRow[]>();
    const addRow = (docKey: string | null, r: StructuredRow) => {
      if (!docKey) return;
      if (!rowsOf.has(docKey)) rowsOf.set(docKey, []);
      rowsOf.get(docKey)!.push({ ...r, lineNo: rowsOf.get(docKey)!.length + 2 });
    };
    const mkRecord = (
      r: Omit<
        BusinessRecordRow,
        | 'id'
        | 'tenantId'
        | 'createdAt'
        | 'updatedAt'
        | 'rev'
        | 'recordId'
        | 'version'
        | 'currency'
        | 'adjustment'
        | 'periodId'
      > & { id: string },
    ) => {
      const row = {
        ...r,
        tenantId: T,
        recordId: r.id,
        version: 1,
        currency: 'VND',
        adjustment: '0',
        periodId: r.date.slice(0, 7),
        createdAt: vn(r.date, r.date === day(31) ? '09:00' : '12:00'),
      };
      records.push(row);
      if (r.documentId)
        evidenceLinks.push({
          id: `rev_${r.id}`,
          tenantId: T,
          recordId: r.id,
          recordVersion: 1,
          documentId: r.documentId,
          documentVersion: 1,
          fieldLocator: 'row',
        });
      return row;
    };
    // Revenue at the counter: 248.600.000 đ over 31 days × 3 sites.
    const revTarget = 248_600_000;
    const raw: { site: SiteId; d: number; v: number }[] = [];
    for (let d = 1; d <= 31; d++)
      for (const [site] of siteList)
        raw.push({ site, d, v: 1_800_000 + rnd() * 1_900_000 + (d % 7 === 6 || d % 7 === 0 ? 700_000 : 0) });
    const rawSum = raw.reduce((a, r) => a + r.v, 0);
    let revAcc = 0;
    raw.forEach((r, i) => {
      const v = i === raw.length - 1 ? revTarget - revAcc : roundTo((r.v * revTarget) / rawSum, 1000);
      revAcc += v;
      const wi = weeks.findIndex(([a, b]) => r.d >= a && r.d <= b);
      const docKey = `CT-POS-${wi}-${r.site}`;
      const id = `rec_rev_${r.site}_${r.d}`;
      mkRecord({
        id,
        entityId: r.site,
        kind: 'REVENUE',
        code: `POS-${day(r.d)}`,
        amount: String(v),
        date: day(r.d),
        channel: 'Tại quầy',
        counterparty: 'Khách lẻ',
        reference: '',
        payoutBatch: '',
        fee: '0',
        refund: '0',
        discount: '0',
        documentId: docIdOf(docKey),
        matchGroupId: null,
      });
      addRow(docKey, {
        lineNo: 0,
        code: `POS-${day(r.d)}`,
        date: day(r.d),
        amount: String(v),
        fee: '0',
        refund: '0',
        discount: '0',
        reference: '',
        payoutBatch: '',
        counterparty: 'Khách lẻ',
        channel: 'Tại quầy',
        description: 'Doanh thu tại quầy',
      });
    });
    // Orders, receipts and match groups.
    const runId = 'run_seed_2026_10';
    for (const g of groups) {
      const gid = `grp_${g.code.replace('DS-', '')}`;
      const orderIds: string[] = [];
      const txnIds: string[] = [];
      for (const o of g.orders) {
        const id = `rec_${o.code}`;
        orderIds.push(id);
        mkRecord({
          id,
          entityId: g.site,
          kind: 'ORDER',
          code: o.code,
          amount: o.gross,
          date: g.date,
          channel: o.channel,
          counterparty: o.channel,
          reference: '',
          payoutBatch: g.payoutBatch,
          fee: o.fee,
          refund: o.refund,
          discount: '0',
          documentId: g.orderDoc ? docIdOf(g.orderDoc) : null,
          matchGroupId: gid,
        });
        addRow(g.orderDoc, {
          lineNo: 0,
          code: o.code,
          date: g.date,
          amount: o.gross,
          fee: o.fee,
          refund: o.refund,
          discount: '0',
          reference: '',
          payoutBatch: g.payoutBatch,
          counterparty: o.channel,
          channel: o.channel,
          description: '',
        });
      }
      for (const r of g.receipts) {
        const id = `rec_${r.code}`;
        txnIds.push(id);
        mkRecord({
          id,
          entityId: g.site,
          kind: r.kind,
          code: r.code,
          amount: r.amount,
          date: g.date,
          channel: r.kind === 'CASH' ? 'Tiền mặt' : 'Ngân hàng',
          counterparty: g.orders[0]!.channel,
          reference: r.code,
          payoutBatch: g.payoutBatch,
          fee: '0',
          refund: '0',
          discount: '0',
          documentId: g.bankDoc ? docIdOf(g.bankDoc) : null,
          matchGroupId: gid,
        });
        addRow(g.bankDoc, {
          lineNo: 0,
          code: r.code,
          date: g.date,
          amount: r.amount,
          fee: '0',
          refund: '0',
          discount: '0',
          reference: r.code,
          payoutBatch: g.payoutBatch,
          counterparty: g.orders[0]!.channel,
          channel: 'Ngân hàng',
          description: `${g.payoutBatch} chi trả`,
        });
      }
      // Run the real engine on the group so allocations/explanations are genuine.
      const { runReconciliation } = await import('@argolet/core');
      const res = runReconciliation(
        g.orders.map((o, i) => ({
          recordId: orderIds[i]!,
          recordVersion: 1,
          code: o.code,
          gross: o.gross,
          fee: o.fee,
          refund: o.refund,
          discount: '0',
          adjustment: '0',
          currency: 'VND',
          date: g.date,
          payoutBatch: g.payoutBatch,
        })),
        g.receipts.map((r, i) => ({
          recordId: txnIds[i]!,
          recordVersion: 1,
          code: r.code,
          amount: r.amount,
          currency: 'VND',
          date: g.date,
          source: r.kind === 'CASH' ? 'CASH' : 'BANK',
          payoutBatch: g.payoutBatch,
        })),
        { ...DEFAULT_RULES },
      );
      const p = res.groups[0]!;
      const feePct = D(p.gross).isZero() ? D(0) : D(p.fee).div(p.gross).times(100);
      const confirmedAt =
        g.status === 'CONFIRMED' ? vn(g.date, g.date === day(31) ? '09:10' : '16:00') : null;
      await tx.put('matchGroups', {
        id: gid,
        tenantId: T,
        code: g.code,
        runId,
        entityId: g.site,
        periodId: '2026-10',
        kind: p.kind,
        status: g.status,
        sourceLabel: g.sourceLabel,
        orderIds,
        txnIds,
        gross: p.gross,
        fee: p.fee,
        refund: p.refund,
        discount: p.discount,
        adjustment: p.adjustment,
        net: p.net,
        received: p.received,
        residual: p.residual,
        score: p.score,
        links: p.links,
        allocations: p.allocations,
        explanation: p.explanation,
        basis: p.basis,
        feeRule: `${feePct.toDecimalPlaces(1).toFixed().replace('.', ',').replace(/,0$/, '')}% · Quy tắc hiệu lực 01/10`,
        inputSnapshotVersion: sha256Hex(canonicalize({ g: g.code })).slice(0, 16),
        rulesVersion: DEFAULT_RULES.rulesVersion,
        confirmedBy: confirmedAt ? USERS.accountant : null,
        confirmedAt,
        approvalId: g.code === 'DS-1031' ? 'apv_ds1031' : null,
        version: confirmedAt ? 2 : 1,
        createdAt: vn(g.date, g.date === day(31) ? '09:05' : '15:00'),
      });
    }
    await tx.put('reconRuns', {
      id: runId,
      tenantId: T,
      entityId: SITES.q3,
      periodId: '2026-10',
      inputSnapshotDigest: sha256Hex('seed-run'),
      rulesVersion: DEFAULT_RULES.rulesVersion,
      groupIds: groups.map((g) => `grp_${g.code.replace('DS-', '')}`),
      unmatchedOrders: [],
      unmatchedTxns: [],
      createdBy: USERS.accountant,
      createdAt: vn(day(31), '09:15'),
    });
    // Expense records from validated expense documents.
    for (const p of plans) {
      if (p.doc.kind !== 'EXPENSE' || p.doc.status !== 'VALIDATED') continue;
      const id = `rec_exp_${codeOf.get(p.key)}`;
      mkRecord({
        id,
        entityId: p.doc.entityId,
        kind: 'EXPENSE',
        code: codeOf.get(p.key)!,
        amount: p.doc.amount,
        date: p.doc.date,
        channel: 'Chi phí',
        counterparty: p.doc.counterparty,
        reference: p.doc.fields.documentNo,
        payoutBatch: '',
        fee: '0',
        refund: '0',
        discount: '0',
        documentId: docIdOf(p.key),
        matchGroupId: null,
      });
    }
    for (const r of records) await tx.put('records', r);
    for (const l of evidenceLinks) await tx.put('recordEvidence', l);
    // Documents, artifacts and versions.
    for (const p of plans) {
      const code = codeOf.get(p.key)!;
      const id = docIdOf(p.key);
      const rows = rowsOf.get(p.key) ?? [];
      const total = rows.length && p.doc.amount === '0' ? dec(sum(rows.map((r) => r.amount))) : p.doc.amount;
      const content =
        p.xml ??
        (rows.length
          ? ['Mã;Ngày;Số tiền', ...rows.map((r) => `${r.code};${r.date};${r.amount}`)].join('\n')
          : null);
      const filename = p.xml
        ? `HD-${p.doc.fields.documentNo}.xml`
        : rows.length
          ? `${code}.csv`
          : `${code}.${p.doc.sourceKind === 'PDF' ? 'pdf' : p.doc.sourceKind === 'PHOTO' ? 'jpg' : 'xml'}`;
      const rawSha256 = sha256Hex(content ?? `${code}:${p.doc.amount}:${p.doc.counterparty}`);
      const artifactId = `art_${code.replace('CT-', '')}`;
      await tx.put('artifacts', {
        id: artifactId,
        tenantId: T,
        batchId: 'bat_seed',
        filename,
        mime: p.xml
          ? 'application/xml'
          : rows.length
            ? 'text/csv'
            : p.doc.sourceKind === 'PDF'
              ? 'application/pdf'
              : 'image/jpeg',
        size: (content ?? '').length || 182_400,
        rawSha256,
        objectUri: `object://${T}/bat_seed/${artifactId}`,
        sourceKey: `seed/${filename}`,
        receivedAt: p.receivedAt,
        duplicateOf: null,
        content,
        createdAt: p.receivedAt,
      });
      const versions =
        p.versions ??
        (p.validatedAt
          ? [
              {
                at: p.validatedAt,
                by: p.validatedBy ?? USERS.accountant,
                byName: p.validatedBy === USERS.admin ? 'Minh Anh' : 'Thanh Hà',
                note: 'Xác nhận phiên bản 01',
              },
            ]
          : []);
      const fields = { ...p.doc.fields, total };
      await tx.put('documents', {
        ...p.doc,
        id,
        tenantId: T,
        code,
        amount: total,
        fields,
        rows,
        currentVersion: versions.length,
        artifactId,
        batchId: 'bat_seed',
        receivedAt: p.receivedAt,
        receivedBy: p.receivedBy ?? USERS.accountant,
        validatedBy: p.validatedAt ? (p.validatedBy ?? USERS.accountant) : null,
        validatedAt: p.validatedAt,
        createdAt: p.receivedAt,
      });
      for (const [i, v] of versions.entries()) {
        const salt = randomHex(16);
        const payload = {
          schemaVersion: EVIDENCE_SCHEMA_VERSION,
          tenantId: T,
          documentId: id,
          documentCode: code,
          version: i + 1,
          rawSha256,
          fields: fields as unknown as Record<string, unknown>,
          confirmedBy: v.by,
          confirmedAt: v.at,
        };
        const row: NewRow<'documentVersions'> = {
          id: `${id}@${i + 1}`,
          tenantId: T,
          documentId: id,
          version: i + 1,
          artifactId,
          parserVersion: 'parser-2026.10.2',
          fields,
          fieldLocator: p.xml ? 'xml:/HDon/DLHDon' : 'seed',
          confirmedBy: v.by,
          confirmedByName: v.byName,
          confirmedAt: v.at,
          note: v.note,
          fingerprint: saltedFingerprint(payload, salt),
          salt,
          createdAt: v.at,
        };
        await tx.put('documentVersions', row);
      }
    }
    await tx.put('importBatches', {
      id: 'bat_seed',
      tenantId: T,
      code: 'LO-20261031',
      entityId: SITES.q3,
      sourceKind: 'MIXED',
      location: 'Kệ A-02',
      status: 'NEEDS_REVIEW',
      fileCount: 16,
      normalized: 13,
      needsReview: 2,
      duplicates: 1,
      createdBy: USERS.staff,
      parserVersion: 'parser-2026.10.2',
      createdAt: vn(day(31), '08:50'),
    });

    // Approvals waiting (Figma 10 / 16): 3 hồ sơ · 14.500.000 đ.
    await tx.put('purchaseOrders', {
      id: 'po_031',
      tenantId: T,
      code: 'PO-031',
      supplier: 'Nguyên liệu Việt',
      entityId: SITES.q3,
      orderDate: day(30),
      dueDate: '2026-11-02',
      amount: '7250000',
      outstanding: '7250000',
      status: 'PENDING_APPROVAL',
      createdAt: vn(day(30)),
    });
    await tx.put('purchaseOrders', {
      id: 'po_028',
      tenantId: T,
      code: 'PO-028',
      supplier: 'Bao bì An Phát',
      entityId: SITES.q3,
      orderDate: day(25),
      dueDate: '2026-11-08',
      amount: '4680000',
      outstanding: '4680000',
      status: 'RECEIVED',
      createdAt: vn(day(25)),
    });
    await tx.put('purchaseOrders', {
      id: 'po_026',
      tenantId: T,
      code: 'PO-026',
      supplier: 'Sữa Xanh',
      entityId: SITES.q1,
      orderDate: day(24),
      dueDate: '2026-11-10',
      amount: '6800000',
      outstanding: '6800000',
      status: 'AWAITING_INVOICE',
      createdAt: vn(day(24)),
    });
    await tx.put('purchaseOrders', {
      id: 'po_025',
      tenantId: T,
      code: 'PO-025',
      supplier: 'Cà phê Cầu Đất',
      entityId: SITES.td,
      orderDate: day(20),
      dueDate: '2026-11-20',
      amount: '18070000',
      outstanding: '18070000',
      status: 'AWAITING_INVOICE',
      createdAt: vn(day(20)),
    });
    await tx.put('purchaseOrders', {
      id: 'po_019',
      tenantId: T,
      code: 'PO-019',
      supplier: 'Thiết bị Bếp Việt',
      entityId: SITES.q1,
      orderDate: day(5),
      dueDate: day(20),
      amount: '12400000',
      outstanding: '0',
      status: 'PAID',
      createdAt: vn(day(5)),
    });
    const poDigest = (code: string, supplier: string, amount: string, dueDate: string) =>
      targetDigest({ code, supplier, amount, dueDate });
    const approval = (a: {
      id: string;
      entityId: SiteId;
      entityLabel: string;
      targetType: 'EXPENSE' | 'MATCH_GROUP';
      targetId: string;
      digest: string;
      amount: string;
      title: string;
      makerId: string;
      requesterName: string;
      details: { label: string; value: string }[];
      timeline: { title: string; by: string; at: string }[];
      createdAt: string;
      targetVersion?: number;
    }) =>
      tx.put('approvals', {
        id: a.id,
        tenantId: T,
        approvalId: a.id,
        entityId: a.entityId,
        targetType: a.targetType,
        targetId: a.targetId,
        targetVersion: a.targetVersion ?? 1,
        digest: a.digest,
        amount: a.amount,
        title: a.title,
        makerId: a.makerId,
        status: 'PENDING',
        policyVersion: APPROVAL_POLICY_VERSION,
        requesterName: a.requesterName,
        entityLabel: a.entityLabel,
        details: a.details,
        timeline: a.timeline,
        dueDate: day(31),
        createdAt: a.createdAt,
      });
    // PO rows were just written with rev 1 → approval pins targetVersion = 1.
    await approval({
      id: 'apv_031',
      entityId: SITES.q3,
      entityLabel: 'Cơ sở Quận 3',
      targetType: 'EXPENSE',
      targetId: 'po_031',
      digest: poDigest('PO-031', 'Nguyên liệu Việt', '7250000', '2026-11-02'),
      amount: '7250000',
      title: 'Duyệt chi mua nguyên liệu',
      makerId: USERS.staff,
      requesterName: 'Nguyễn Minh Anh',
      details: [
        { label: 'Người đề nghị', value: 'Nguyễn Minh Anh' },
        { label: 'Người nhận', value: 'Nhà cung cấp Nguyên liệu Việt' },
        { label: 'Mục đích', value: 'Mua nguyên liệu tuần 44' },
        { label: 'Phương thức', value: 'Chuyển khoản' },
        { label: 'Chứng từ kèm theo', value: 'HD-00318 · Đã kiểm tra' },
      ],
      timeline: [
        { title: 'Đã lập hồ sơ', by: 'Nguyễn Minh Anh', at: vn(day(31), '08:45') },
        { title: 'Đã kiểm tra', by: 'Thanh Hà', at: vn(day(31), '09:10') },
      ],
      createdAt: vn(day(31), '08:45'),
    });
    await approval({
      id: 'apv_028',
      entityId: SITES.q3,
      entityLabel: 'Cơ sở Quận 3',
      targetType: 'EXPENSE',
      targetId: 'po_028',
      digest: poDigest('PO-028', 'Bao bì An Phát', '4680000', '2026-11-08'),
      amount: '4680000',
      title: 'Duyệt thanh toán bao bì',
      makerId: USERS.staff,
      requesterName: 'Nguyễn Minh Anh',
      details: [
        { label: 'Người đề nghị', value: 'Nguyễn Minh Anh' },
        { label: 'Người nhận', value: 'Bao bì An Phát' },
        { label: 'Mục đích', value: 'Thanh toán bao bì tháng 10' },
        { label: 'Phương thức', value: 'Chuyển khoản' },
        { label: 'Chứng từ kèm theo', value: 'PGH-2910 · Đã kiểm tra' },
      ],
      timeline: [{ title: 'Đã lập hồ sơ', by: 'Nguyễn Minh Anh', at: vn(day(30), '15:20') }],
      createdAt: vn(day(30), '15:20'),
    });
    await approval({
      id: 'apv_vpp',
      entityId: SITES.q1,
      entityLabel: 'Cơ sở Quận 1',
      targetType: 'EXPENSE',
      targetId: 'exp_vpp_2610',
      digest: targetDigest({ title: 'Văn phòng phẩm tháng 10', amount: '2570000' }),
      amount: '2570000',
      title: 'Duyệt chi văn phòng phẩm',
      makerId: USERS.accountant,
      requesterName: 'Thanh Hà',
      details: [
        { label: 'Người đề nghị', value: 'Thanh Hà' },
        { label: 'Người nhận', value: 'Văn phòng phẩm Hồng Hà' },
        { label: 'Mục đích', value: 'Văn phòng phẩm tháng 10' },
        { label: 'Phương thức', value: 'Tiền mặt' },
        { label: 'Chứng từ kèm theo', value: 'Chưa có hóa đơn' },
      ],
      timeline: [{ title: 'Đã lập hồ sơ', by: 'Thanh Hà', at: vn(day(31), '07:55') }],
      createdAt: vn(day(31), '07:55'),
    });
    // DS-1031 waits for approval of the match (Figma 14: "Khớp, chờ duyệt").
    const g1031 = (await tx.get('matchGroups', T, 'grp_1031'))!;
    await approval({
      id: 'apv_ds1031',
      entityId: SITES.q3,
      entityLabel: 'Cơ sở Quận 3',
      targetType: 'MATCH_GROUP',
      targetId: 'grp_1031',
      targetVersion: g1031.version,
      digest: groupDigest(g1031),
      amount: g1031.received,
      title: 'Xác nhận nhóm DS-1031',
      makerId: USERS.accountant,
      requesterName: 'Thanh Hà',
      details: [
        { label: 'Nhóm giao dịch', value: 'DS-1031 · 3 đơn hàng' },
        { label: 'Tổng đơn', value: '1.250.000 đ' },
        { label: 'Phí & hoàn tiền', value: '125.000 đ' },
        { label: 'Tiền thực nhận', value: '1.125.000 đ' },
        { label: 'Chênh lệch', value: '0 đ' },
      ],
      timeline: [{ title: 'Đã lập hồ sơ', by: 'Thanh Hà', at: vn(day(31), '09:15') }],
      createdAt: vn(day(31), '09:15'),
    });

    // ───── G1–G4 module data ─────
    const inv: [string, string, string, string, string][] = [
      ['Cà phê hạt', 'kg', '24.5', '10', '300000'],
      ['Sữa tươi', 'hộp', '18', '24', '35000'],
      ['Đường', 'kg', '12', '5', '25000'],
      ['Ly giấy', 'cái', '250', '300', '1900'],
      ['Ống hút & nắp', 'bộ', '400', '500', '600'],
      ['Trà ô long', 'kg', '40', '8', '450000'],
      ['Bột cacao', 'kg', '25', '5', '320000'],
      ['Siro các loại', 'chai', '60', '12', '180000'],
      ['Bánh quy bơ', 'hộp', '85', '20', '33000'],
    ];
    for (const [i, [name, unit, onHand, reorder, cost]] of inv.entries()) {
      await tx.put('inventoryItems', {
        id: `inv_${i}`,
        tenantId: T,
        entityId: SITES.q3,
        name,
        unit,
        onHand,
        reorderLevel: reorder,
        unitCost: cost,
        createdAt: vn('2026-10-01', `08:${String(i).padStart(2, '0')}`),
      });
    }
    await tx.put('recipes', {
      id: 'rcp_caphesua',
      tenantId: T,
      name: 'Ly cà phê',
      price: '35000',
      wasteRate: '0',
      lines: [
        { itemId: 'beans', name: 'Cà phê hạt', quantity: '18', unit: 'g', unitCost: '300' },
        { itemId: 'milk', name: 'Sữa tươi', quantity: '120', unit: 'ml', unitCost: '35' },
        { itemId: 'sugar', name: 'Đường', quantity: '12', unit: 'g', unitCost: '25' },
        { itemId: 'cup', name: 'Ly giấy', quantity: '1', unit: 'cái', unitCost: '1900' },
        { itemId: 'lid', name: 'Ống hút & nắp', quantity: '1', unit: 'bộ', unitCost: '600' },
      ],
    });
    await tx.put('dailyCloses', {
      id: 'shift_q3_3110_pm',
      tenantId: T,
      entityId: SITES.q3,
      date: day(31),
      shift: 'Ca chiều',
      lines: [
        { channel: 'Tiền mặt', system: '4200000', counted: '4200000' },
        { channel: 'Chuyển khoản', system: '4250000', counted: '4250000' },
        { channel: 'Nền tảng giao hàng', system: '5800000', counted: '5800000' },
      ],
      status: 'OPEN',
      submittedBy: null,
      submittedAt: null,
    });
    const clients: [
      string,
      string,
      number,
      string,
      'MISSING_DOCS' | 'READY' | 'REVIEWED' | 'WAITING',
      number,
    ][] = [
      ['Minh An Coffee', '1 cơ sở', 92, '2026-11-02', 'MISSING_DOCS', 4],
      ['Việt Xanh Retail', '3 điểm bán', 100, '2026-11-02', 'READY', 0],
      ['An Phúc Trading', '1 pháp nhân', 100, '2026-11-03', 'REVIEWED', 0],
      ['Mộc Lan Bakery', '2 cơ sở', 78, '2026-11-03', 'WAITING', 0],
      ['Hòa Bình Mart', '2 cửa hàng', 85, '2026-11-04', 'MISSING_DOCS', 2],
      ['Sen Việt Spa', '1 cơ sở', 100, '2026-11-04', 'READY', 0],
      ['Lam Sơn Food', '1 pháp nhân', 100, '2026-11-05', 'READY', 0],
      ['Thảo Nguyên Farm', '2 trang trại', 100, '2026-11-05', 'READY', 0],
      ['Phố Xanh Coffee', '4 cơ sở', 100, '2026-11-06', 'REVIEWED', 0],
      ['Đông Á Foods', '1 pháp nhân', 100, '2026-11-06', 'READY', 0],
      ['Gốm Bát Tràng', '1 cửa hàng', 100, '2026-11-07', 'READY', 0],
      ['Hương Quê Restaurant', '2 cơ sở', 100, '2026-11-07', 'READY', 0],
    ];
    for (const [i, [name, scope, completion, closeDue, status, missing]] of clients.entries()) {
      await tx.put('clients', {
        id: `cli_${i}`,
        tenantId: T,
        name,
        scope,
        completion,
        closeDue,
        status,
        missingDocs: missing,
        delegationValidUntil: '2027-10-31',
        createdAt: vn('2026-09-10', `09:${String(i).padStart(2, '0')}`),
      });
    }
    const deals: [string, string, NewRow<'deals'>['stage'], string, NewRow<'deals'>['status']][] = [
      ['HD-019', 'An Phúc', 'QUOTE', '120000000', 'WAITING_REPLY'],
      ['HD-018', 'Việt Xanh', 'DELIVERY', '85400000', 'IN_PROGRESS'],
      ['HD-016', 'Mộc Lan', 'COLLECTION', '41000000', 'DUE'],
      ['HD-017', 'Minh An Coffee', 'CONTRACT', '150000000', 'IN_PROGRESS'],
      ['HD-015', 'Thảo Nguyên', 'CONTRACT', '98000000', 'IN_PROGRESS'],
      ['HD-014', 'Lam Sơn', 'CONTRACT', '112000000', 'IN_PROGRESS'],
      ['HD-013', 'Hòa Bình', 'CONTRACT', '76000000', 'IN_PROGRESS'],
      ['CH-003', 'Đông Á Foods', 'OPPORTUNITY', '177600000', 'WAITING_REPLY'],
    ];
    for (const [code, customer, stage, value, status] of deals) {
      await tx.put('deals', {
        id: `deal_${code}`,
        tenantId: T,
        code,
        customer,
        stage,
        value,
        status,
        dueDate: '2026-11-15',
      });
    }
    await tx.put('projects', {
      id: 'prj_da001',
      tenantId: T,
      code: 'DA-001',
      name: 'Điện mặt trời · Nhà máy Minh An',
      manager: 'Hải Nam',
      budget: '1000000000',
      recorded: '420000000',
      committed: '180000000',
      wbs: [
        {
          code: '1.1',
          name: 'Khảo sát hiện trạng',
          dependsOn: null,
          owner: 'Hải Nam',
          progress: 100,
          status: 'DONE',
        },
        {
          code: '1.2',
          name: 'Thiết kế hệ thống',
          dependsOn: '1.1',
          owner: 'Minh Anh',
          progress: 70,
          status: 'IN_PROGRESS',
        },
        {
          code: '1.3',
          name: 'Thi công lắp đặt',
          dependsOn: '1.2',
          owner: 'Đội EPC',
          progress: 45,
          status: 'IN_PROGRESS',
        },
        {
          code: '1.4',
          name: 'Nghiệm thu',
          dependsOn: '1.3',
          owner: 'Chủ đầu tư',
          progress: 0,
          status: 'NOT_STARTED',
        },
        {
          code: '1.5',
          name: 'Vận hành bàn giao',
          dependsOn: '1.4',
          owner: 'Kỹ thuật',
          progress: 0,
          status: 'NOT_STARTED',
        },
      ],
    });
    await tx.put('assets', {
      id: 'ast_mv',
      tenantId: T,
      code: 'MV-01',
      name: 'Điện năng đã điều chỉnh',
      kind: 'METRIC',
      projectCode: 'DA-001',
      baseline: '125000',
      reporting: '100000',
      unit: 'kWh',
      schedule: '',
      dueDate: null,
      status: 'OK',
      createdAt: vn('2026-10-01', '08:00'),
    });
    await tx.put('assets', {
      id: 'ast_pv',
      tenantId: T,
      code: 'TS-001',
      name: 'Hệ thống điện mặt trời',
      kind: 'ASSET',
      projectCode: 'DA-001',
      baseline: '',
      reporting: '',
      unit: '',
      schedule: 'DA-001',
      dueDate: null,
      status: 'MONITORING',
      createdAt: vn('2026-10-01', '08:01'),
    });
    await tx.put('assets', {
      id: 'ast_inv2',
      tenantId: T,
      code: 'TS-002',
      name: 'Biến tần số 02',
      kind: 'ASSET',
      projectCode: 'DA-001',
      baseline: '',
      reporting: '',
      unit: '',
      schedule: 'Kiểm tra 3 tháng',
      dueDate: '2026-11-02',
      status: 'MAINTENANCE_DUE',
      createdAt: vn('2026-10-01', '08:02'),
    });
    await tx.put('assets', {
      id: 'ast_ev1',
      tenantId: T,
      code: 'TS-003',
      name: 'Trạm sạc số 01',
      kind: 'ASSET',
      projectCode: 'DA-001',
      baseline: '',
      reporting: '',
      unit: '',
      schedule: 'Kiểm tra 6 tháng',
      dueDate: '2026-11-05',
      status: 'MAINTENANCE_DUE',
      createdAt: vn('2026-10-01', '08:03'),
    });
    for (let i = 4; i <= 12; i++) {
      await tx.put('assets', {
        id: `ast_${i}`,
        tenantId: T,
        code: `TS-${String(i).padStart(3, '0')}`,
        name: `Tài sản vận hành ${i}`,
        kind: 'ASSET',
        projectCode: 'DA-001',
        baseline: '',
        reporting: '',
        unit: '',
        schedule: '',
        dueDate: null,
        status: 'OK',
        createdAt: vn('2026-10-01', `09:${String(i).padStart(2, '0')}`),
      });
    }
    await tx.put('shipments', {
      id: 'shp_261031',
      tenantId: T,
      code: 'SH-261031',
      route: 'Cát Lái → Kho Minh An',
      container: '1 container 40HC',
      status: 'DELIVERING',
      events: [
        {
          title: 'Đã nhận booking',
          detail: 'BK-20318 · Hãng vận tải',
          at: vn('2026-10-27', '09:00'),
          done: true,
        },
        { title: 'Tàu đến cảng', detail: 'Cảng Cát Lái', at: vn('2026-10-29', '06:30'), done: true },
        {
          title: 'Hoàn tất khai báo',
          detail: 'Hồ sơ được người phụ trách xác nhận',
          at: vn('2026-10-30', '14:15'),
          done: true,
        },
        {
          title: 'Container ra cổng',
          detail: 'EIR-1031 · Đính kèm biên bản',
          at: vn('2026-10-31', '08:40'),
          done: true,
        },
        {
          title: 'Giao đến kho',
          detail: 'Dự kiến · Chờ xác nhận giao nhận',
          at: vn('2026-10-31', '14:00'),
          done: false,
        },
      ],
      documents: [
        { name: 'Vận đơn BL-20318', status: 'Đã đối chiếu' },
        { name: 'Biên bản giao nhận', status: 'Chờ người nhận xác nhận' },
        { name: 'Hóa đơn cước', status: 'Đã tiếp nhận' },
      ],
      freeTimeStart: '2026-10-28',
      freeDays: 5,
      tariffCode: 'BPL-10',
      tariffFrom: '2026-10-01',
      storageRatePerDay: '600000',
      storageDays: 2,
      revenue: '24000000',
      costs: [
        { name: 'Cước vận chuyển', basis: '1 container', amount: '12000000' },
        { name: 'Phí nội địa', basis: 'Hồ sơ + vận chuyển', amount: '5000000' },
        { name: 'Lưu bãi', basis: '2 ngày × 600.000', amount: '1200000' },
      ],
      allocation: [
        { item: 'Hàng A', weightShare: '60' },
        { item: 'Hàng B', weightShare: '40' },
      ],
      allocationConfirmed: false,
    });
    const ge: [string, string, string, number, number, 'SUBMITTED' | 'PENDING', string][] = [
      ['ent_mah', 'Minh An Holdings', 'MAH', 128, 128, 'SUBMITTED', 'Đã khớp'],
      ['ent_mar', 'Minh An Retail', 'MAR', 94, 94, 'SUBMITTED', 'Đã khớp'],
      ['ent_mal', 'Minh An Logistics', 'MAL', 82, 86, 'PENDING', 'Lệch 300.000 đ'],
      ['ent_mae', 'Minh An Energy', 'MAE', 76, 76, 'SUBMITTED', 'Đã khớp'],
    ];
    for (const [entityId, name, code, docsSubmitted, docsTotal, periodStatus, icStatus] of ge) {
      await tx.put('groupEntities', {
        id: `ge_${code}`,
        tenantId: T,
        entityId,
        name,
        code,
        docsSubmitted,
        docsTotal,
        periodStatus,
        icStatus,
      });
    }
    await tx.put('intercompany', {
      id: 'ic_2610_018',
      tenantId: T,
      reference: 'IC-2610-018',
      contract: 'HD-018',
      periodId: '2026-10',
      sideA: { entityId: 'ent_mar', name: 'Minh An Retail', role: 'RECEIVABLE', amount: '85400000' },
      sideB: { entityId: 'ent_mal', name: 'Minh An Logistics', role: 'PAYABLE', amount: '85100000' },
      status: 'DIFFERENCE',
      nextAction:
        'Đề nghị Minh An Logistics bổ sung chứng từ phí 300.000 đ. Giữ nguyên số liệu hai bên cho đến khi có người có quyền xác nhận điều chỉnh.',
      requestedAt: null,
    });
    await tx.put('financeProjects', {
      id: 'fin_da001',
      tenantId: T,
      code: 'DA-001',
      name: 'Dự án Điện mặt trời',
      assumptions: {
        investment: '1000',
        annualCashflow: '300',
        years: 5,
        discountRate: '0.1',
        annualDebtService: '200',
      },
      scenarios: [
        { name: 'Thận trọng', annualCashflow: '250' },
        { name: 'Cơ sở', annualCashflow: '300' },
        { name: 'Tích cực', annualCashflow: '350' },
      ],
      lastCalcRunId: null,
    });
    // Notifications (Figma 36): 8 today, 5 unread, 3 need action.
    const ntf: [string, string, string, string, 'UNREAD' | 'READ', boolean, string, string | undefined][] = [
      [
        'Minh Anh gửi hồ sơ chờ duyệt',
        'Quận 3',
        'CT-1028',
        '/approvals/apv_031',
        'UNREAD',
        true,
        vn(day(31), '09:32'),
        'Chưa đọc',
      ],
      [
        'Đối soát hoàn tất, cần xác nhận',
        'Quận 3',
        'DS-1031',
        '/reconciliation/grp_1031',
        'UNREAD',
        true,
        vn(day(31), '09:15'),
        'Cần xem',
      ],
      [
        'Dữ liệu nhập đã sẵn sàng',
        'Tất cả',
        'Lô 10-31',
        '/ingestion',
        'READ',
        false,
        vn(day(31), '08:50'),
        undefined,
      ],
      [
        'Thanh Hà đề nghị chi văn phòng phẩm',
        'Quận 1',
        '2.570.000 đ',
        '/approvals/apv_vpp',
        'UNREAD',
        true,
        vn(day(31), '07:55'),
        'Cần xem',
      ],
      [
        'Sao kê tháng 10 đã xác nhận',
        'Quận 3',
        'CT-1026',
        '/documents',
        'READ',
        false,
        vn(day(31), '08:10'),
        undefined,
      ],
      [
        'Phiếu giao hàng cần bổ sung số chứng từ',
        'Thủ Đức',
        'CT-1019',
        '/documents/doc_1019/review',
        'UNREAD',
        false,
        vn(day(31), '07:50'),
        'Chưa đọc',
      ],
      [
        'Bằng chứng hồ sơ đã được neo',
        'Quận 3',
        'EV-20261031-003',
        '/evidence/doc_1027',
        'READ',
        false,
        vn(day(31), '09:33'),
        undefined,
      ],
      [
        'Lô hàng SH-261031 đã ra cổng',
        'Logistics',
        'SH-261031',
        '/logistics',
        'READ',
        false,
        vn(day(31), '08:40'),
        undefined,
      ],
      [
        'Có lời mời tham gia dự án',
        'Minh An',
        'DA-001',
        '/projects',
        'UNREAD',
        false,
        vn(day(30), '16:00'),
        'Chưa đọc',
      ],
    ];
    for (const [
      i,
      [title, unitLabel, refCode, route, status, actionRequired, at, statusLabel],
    ] of ntf.entries()) {
      await tx.put('notifications', {
        id: `ntf_seed_${i}`,
        tenantId: T,
        userId: null,
        title,
        unitLabel,
        refCode,
        route,
        status,
        actionRequired,
        statusLabel,
        createdAt: at,
      });
    }
  });

  // ─────────────── evidence: daily Merkle batches anchored on the ledger ───────────────
  await app.core.store.transaction(async (tx) => {
    const versions = (await tx.list('documentVersions', T)).filter((v) => {
      return v.version === 1 || v.documentId === docIdOf('CT-1027');
    });
    const docs = new Map((await tx.list('documents', T)).map((d) => [d.id, d]));
    const latest = new Map<string, DocumentVersionRow>();
    for (const v of versions) {
      const cur = latest.get(v.documentId);
      if (!cur || v.version > cur.version) latest.set(v.documentId, v);
    }
    const all = [...latest.values()];
    // Batches on 31/10 in order: CT-1026 (001), CT-1024 (002), CT-1027 v3 (003).
    const special = ['CT-1026', 'CT-1024', 'CT-1027'].map((k) => docIdOf(k));
    const byDay = new Map<string, DocumentVersionRow[]>();
    for (const v of all.filter((x) => !special.includes(x.documentId))) {
      const d = new Date(Date.parse(v.confirmedAt) + 7 * 3_600_000).toISOString().slice(0, 10);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(v);
    }
    // Anchor every batch in time order so batch codes follow the clock (EV-YYYYMMDD-NNN).
    const jobs: { at: string; list: DocumentVersionRow[] }[] = [];
    for (const list of byDay.values()) {
      const at = list
        .map((v) => v.confirmedAt)
        .sort()
        .pop()!;
      jobs.push({ at: new Date(Date.parse(at) + 600_000).toISOString(), list });
    }
    for (const id of special) {
      const v = latest.get(id)!;
      jobs.push({ at: new Date(Date.parse(v.confirmedAt) + 60_000).toISOString(), list: [v] });
    }
    jobs.sort((a, b) => a.at.localeCompare(b.at));
    for (const job of jobs) {
      await app.evidence.anchorDocumentVersions(
        tx,
        T,
        job.at,
        job.list.map((v) => ({ doc: docs.get(v.documentId)!, version: v })),
      );
    }
  });

  // ─────────────── assistant history (runs the real assistant) ───────────────
  const login = await app.auth.login(
    { channel: 'web', userAgent: 'seed' },
    { contact: DEMO_EMAIL, password: DEMO_PASSWORD },
  );
  const call = { sessionToken: login.token, channel: 'web' as const };
  await app.org.selectWorkspace(call, { tenantId: T });
  for (const q of [
    'Giải thích kết quả NPV',
    'Hồ sơ còn thiếu tháng 10',
    'Khoản nào chưa khớp?',
    'Vì sao nhóm DS-1031 được gợi ý khớp?',
  ]) {
    await app.assistant.ask(call, { question: q });
  }
  await app.auth.logout(call);
  // Seed activity must not show as unread notifications or audit noise beyond the seeded ones.
  await app.core.store.transaction(async (tx) => {
    for (const n of await tx.list('notifications', T)) {
      if (!n.id.startsWith('ntf_seed_')) await tx.delete('notifications', T, n.id);
    }
    for (const s of await tx.findGlobal('sessions', { userAgent: 'seed' }))
      await tx.delete('sessions', GLOBAL, s.id);
  });
  return { seeded: true };
}
