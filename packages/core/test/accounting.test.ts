import { describe, expect, it } from 'vitest';
import {
  D,
  balanceSheet,
  buildLedger,
  classifyCost,
  financialRatios,
  incomeStatement,
  journalEntry,
  trialBalance,
  type LedgerEvent,
} from '../src';

const M = (v: number) => String(v * 1_000_000);
const r = (v: string | null, places = 6) => (v === null ? null : D(v).toDecimalPlaces(places).toNumber());

/**
 * Tháng 01/2026 của một doanh nghiệp thương mại (TT99), số liệu tính tay:
 *  - Số dư đầu kỳ: tiền mặt 50, tiền gửi 200, hàng hóa 30, TSCĐ 120, hao mòn 20, phải trả người bán 40,
 *    vốn góp 300, lợi nhuận năm trước 40 (triệu đồng).
 *  - Mua hàng 100 + VAT 10 (chưa trả); bán hàng 150 + VAT 15 (chưa thu); bán qua nền tảng 20, hoàn tiền 1,
 *    phí nền tảng 2; khách trả 120 qua ngân hàng; tiền điện 5 + VAT 0,5 (chưa trả); lãi vay 1 trả tiền mặt;
 *    trả người bán 50 qua ngân hàng; kiểm kê cuối tháng hàng hóa còn 50.
 */
const events: LedgerEvent[] = [
  {
    kind: 'PURCHASE',
    id: 'e1',
    date: '2026-01-05',
    ref: 'HD-01',
    party: 'Công ty Hàng Việt',
    net: M(100),
    vat: M(10),
    text: 'Nhập hàng hóa',
    onCredit: true,
  },
  {
    kind: 'SALE',
    id: 'e2',
    date: '2026-01-10',
    ref: 'HD-02',
    party: 'Khách sỉ',
    net: M(150),
    vat: M(15),
    cash: false,
  },
  {
    kind: 'PLATFORM_SALE',
    id: 'e3',
    date: '2026-01-12',
    ref: 'SPF-01',
    party: 'ShopeeFood',
    gross: M(20),
    refund: M(1),
    discount: '0',
    fee: M(2),
  },
  {
    kind: 'RECEIPT',
    id: 'e4',
    date: '2026-01-20',
    ref: 'GD-01',
    party: 'Khách sỉ',
    amount: M(120),
    via: 'BANK',
    text: 'Thanh toán hóa đơn HD-02',
  },
  {
    kind: 'PURCHASE',
    id: 'e5',
    date: '2026-01-25',
    ref: 'HD-03',
    party: 'Điện lực TP.HCM',
    net: M(5),
    vat: '500000',
    text: 'Tiền điện tháng 1',
    onCredit: true,
  },
  {
    kind: 'PURCHASE',
    id: 'e6',
    date: '2026-01-28',
    ref: 'PC-01',
    party: 'Ngân hàng',
    net: M(1),
    vat: '0',
    text: 'Lãi vay tháng 1',
    onCredit: false,
  },
  {
    kind: 'PAYMENT',
    id: 'e7',
    date: '2026-01-29',
    ref: 'GD-02',
    party: 'Công ty Hàng Việt',
    amount: M(50),
    text: 'Thanh toán tiền hàng',
  },
];
const opening = {
  '111': M(50),
  '112': M(200),
  '156': M(30),
  '211': M(120),
  '214': `-${M(20)}`,
  '331': `-${M(40)}`,
  '4111': `-${M(300)}`,
  '4211': `-${M(40)}`,
};

describe('automatic double-entry ledger (TT99)', () => {
  const ledger = buildLedger({
    regime: 'TT99',
    periods: ['2026-01'],
    events,
    opening,
    stockCounts: { '2026-01': M(50) },
    citRate: '0.2',
  });

  it('every entry balances and the books close to zero on revenue and cost accounts', () => {
    for (const e of ledger.entries) {
      const d = e.lines.reduce((t, l) => t.plus(l.debit), D(0));
      const c = e.lines.reduce((t, l) => t.plus(l.credit), D(0));
      expect(d.eq(c)).toBe(true);
    }
    const tb = trialBalance(ledger, '2026-01', '2026-01');
    for (const code of ['511', '521', '632', '635', '641', '642', '8211', '911']) {
      const row = tb.find((x) => x.account === code);
      if (row) expect([row.closingDebit, row.closingCredit]).toEqual(['0', '0']);
    }
    const sum = (k: 'closingDebit' | 'closingCredit') => tb.reduce((t, x) => t.plus(x[k]), D(0));
    expect(sum('closingDebit').eq(sum('closingCredit'))).toBe(true);
  });

  it('income statement B02-DN matches the hand calculation', () => {
    const { figures: f, lines } = incomeStatement(ledger, '2026-01', '2026-01');
    expect(f.grossSales).toBe(M(170));
    expect(f.returns).toBe(M(1));
    expect(f.netRevenue).toBe(M(169));
    expect(f.cogs).toBe(M(80)); // 30 + 100 − 50
    expect(f.grossProfit).toBe(M(89));
    expect(f.financialExpense).toBe(M(1));
    expect(f.interest).toBe(M(1));
    expect(f.selling).toBe(M(2));
    expect(f.admin).toBe(M(5));
    expect(f.operatingProfit).toBe(M(81));
    expect(f.profitBeforeTax).toBe(M(81));
    expect(f.cit).toBe('16200000');
    expect(f.profitAfterTax).toBe('64800000');
    expect(f.ebit).toBe(M(82));
    expect(lines.map((l) => l.code)).toEqual([
      '01',
      '02',
      '10',
      '11',
      '20',
      '21',
      '22',
      '23',
      '25',
      '26',
      '30',
      '31',
      '32',
      '40',
      '50',
      '51',
      '60',
    ]);
  });

  it('balance sheet balances: assets 531 = liabilities 126,2 + equity 404,8', () => {
    const { figures: b } = balanceSheet(ledger, '2026-01');
    expect(b.cash).toBe(M(319));
    expect(b.receivables).toBe(M(62));
    expect(b.inventory).toBe(M(50));
    expect(b.vatDeductible).toBe('0');
    expect(b.fixedAssets).toBe(M(100));
    expect(b.totalAssets).toBe(M(531));
    expect(b.payables).toBe('105500000');
    expect(b.taxes).toBe('20700000'); // VAT 15 − 10,5 + CIT 16,2
    expect(b.liabilities).toBe('126200000');
    expect(b.equity).toBe('404800000');
    expect(b.balanced).toBe(true);
    const o = balanceSheet(ledger, null).figures;
    expect(o.totalAssets).toBe(M(380));
    expect(o.equity).toBe(M(340));
    expect(o.balanced).toBe(true);
  });

  it('ratios come from the statements (DuPont identity holds)', () => {
    const income = incomeStatement(ledger, '2026-01', '2026-01').figures;
    const { groups, leverageInputs } = financialRatios({
      income,
      start: balanceSheet(ledger, null).figures,
      end: balanceSheet(ledger, '2026-01').figures,
      days: 31,
    });
    const v = (k: string) => r(groups.flatMap((g) => g.items).find((x) => x.key === k)!.value);
    expect(v('current')).toBeCloseTo(431 / 126.2, 6);
    expect(v('quick')).toBeCloseTo(381 / 126.2, 6);
    expect(v('cash')).toBeCloseTo(319 / 126.2, 6);
    expect(v('debtRatio')).toBeCloseTo(126.2 / 531, 6);
    expect(v('roa')).toBeCloseTo(64.8 / 455.5, 6);
    expect(v('roe')).toBeCloseTo(64.8 / 372.4, 6);
    expect(v('ros')).toBeCloseTo(64.8 / 169, 6);
    expect(v('grossMargin')).toBeCloseTo(89 / 169, 6);
    expect(v('assetTurnover')! * v('equityMultiplier')! * v('ros')!).toBeCloseTo(v('roe')!, 5);
    expect(v('inventoryTurnover')).toBeCloseTo(2, 6);
    expect(v('dio')).toBeCloseTo(15.5, 6);
    expect(v('interestCover')).toBeCloseTo(82, 6);
    expect(v('dol')).toBeCloseTo(87 / 82, 6);
    expect(v('dfl')).toBeCloseTo(82 / 81, 6);
    expect(v('dtl')).toBeCloseTo(87 / 81, 6);
    expect(leverageInputs).toEqual({
      revenue: M(169),
      variableCosts: M(82),
      fixedCosts: M(5),
      interest: M(1),
    });
  });

  it('without a stock count, goods bought in the month are expensed; a too-large count is flagged', () => {
    const l2 = buildLedger({ regime: 'TT99', periods: ['2026-01'], events, opening, citRate: '0.2' });
    expect(incomeStatement(l2, '2026-01', '2026-01').figures.cogs).toBe(M(100));
    const l3 = buildLedger({
      regime: 'TT99',
      periods: ['2026-01'],
      events,
      opening,
      stockCounts: { '2026-01': M(500) },
      citRate: '0.2',
    });
    expect(l3.warnings).toHaveLength(1);
  });
});

describe('TT133 and multi-month rules', () => {
  it('TT133: returns reduce 511 directly; selling and admin are 6421 / 6422; B02-DNN line 24', () => {
    const ledger = buildLedger({
      regime: 'TT133',
      periods: ['2026-01'],
      events,
      opening,
      stockCounts: { '2026-01': M(50) },
      citRate: '0.2',
    });
    const { figures, lines } = incomeStatement(ledger, '2026-01', '2026-01');
    expect(figures.netRevenue).toBe(M(169));
    expect(figures.profitAfterTax).toBe('64800000');
    expect(lines.find((l) => l.code === '24')!.value).toBe(M(7));
    expect(ledger.entries.some((e) => e.lines.some((l) => l.account === '521'))).toBe(false);
    expect(balanceSheet(ledger, '2026-01').figures.balanced).toBe(true);
  });

  it('tax is provisioned on the year-to-date profit: a loss month gives back tax', () => {
    const loss: LedgerEvent = {
      kind: 'PURCHASE',
      id: 'x',
      date: '2026-02-10',
      ref: 'HD-9',
      party: 'Công ty quảng cáo',
      net: M(100),
      vat: '0',
      text: 'Quảng cáo',
      onCredit: true,
    };
    const ledger = buildLedger({
      regime: 'TT99',
      periods: ['2026-01', '2026-02'],
      events: [...events, loss],
      opening,
      stockCounts: { '2026-01': M(50) },
      citRate: '0.2',
    });
    const feb = incomeStatement(ledger, '2026-02', '2026-02').figures;
    // YTD profit 81 − 100 = −19 → no tax for the year: January's 16,2 is reversed in February.
    expect(feb.cit).toBe('-16200000');
    expect(incomeStatement(ledger, '2026-01', '2026-02').figures.cit).toBe('0');
    expect(balanceSheet(ledger, '2026-02').figures.balanced).toBe(true);
  });

  it('a new year moves last year profit from 4212 to 4211', () => {
    const ledger = buildLedger({
      regime: 'TT99',
      periods: ['2025-12', '2026-01'],
      events: events.map((e) => ({ ...e, date: e.date.replace('2026-01', '2025-12') })),
      opening,
      stockCounts: { '2025-12': M(50) },
      citRate: '0.2',
    });
    const tb = trialBalance(ledger, '2026-01', '2026-01');
    expect(tb.find((x) => x.account === '4211')!.closingCredit).toBe('104800000'); // 40 + 64,8
    expect(tb.find((x) => x.account === '4212')?.closingCredit ?? '0').toBe('0');
  });

  it('an unbalanced entry or opening is refused', () => {
    expect(() =>
      journalEntry({
        id: 'x',
        date: '2026-01-01',
        periodId: '2026-01',
        ref: 'X',
        description: '',
        kind: 'DOCUMENT',
        documentId: null,
        lines: [{ account: '111', debit: '1', credit: '0' }],
      }),
    ).toThrow(/không cân/);
    expect(() =>
      buildLedger({
        regime: 'TT99',
        periods: ['2026-01'],
        events: [],
        opening: { '111': '100' },
        citRate: '0.2',
      }),
    ).toThrow(/không cân/);
  });

  it('classifies costs by their nature', () => {
    expect(classifyCost('Điện lực TP.HCM tiền điện', 'TT99').account).toBe('642');
    expect(classifyCost('Vận chuyển giao hàng', 'TT99')).toMatchObject({ account: '641', variable: true });
    expect(classifyCost('Bao bì An Phát', 'TT133').account).toBe('152');
    expect(classifyCost('Lãi vay ngân hàng', 'TT99')).toMatchObject({ account: '635', interest: true });
    expect(classifyCost('Bảng lương tháng 10', 'TT99')).toMatchObject({ account: '642', credit: '334' });
    expect(classifyCost('Nguyen lieu Viet', 'TT99').account).toBe('152');
  });
});
