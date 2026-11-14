/**
 * Công cụ tính toán (mobile): lịch trả nợ vay và các chỉ số đòn bẩy, with the same engine and
 * definitions as the web app (Toán tài chính, TCDN, Thông tư 14/2017/TT-NHNN).
 */
import { useState } from 'react';
import { useQuery } from '@argolet/client';
import { View } from 'react-native';
import {
  capitalStructure,
  D,
  dupont,
  formatNumber,
  formatPercent,
  formatVnd,
  interestCoverage,
  leverageEffect,
  loanEffectiveCost,
  loanSchedule,
  totalLeverage,
  type RepaymentMethod,
} from '@argolet/core';
import { Text } from '../textScale';
import { C } from '../theme';
import { Button, Card, Gap, Input, KV, Notice, Screen, T, Title } from '../ui';
import { Choice, Money } from './modules';

const pct = (s: string): number | null => {
  const t = s.replace(/\s/g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) / 100 : null;
};
const vnd = (v: string) => formatVnd(D(v));
const whole = (v: string) => D(v).toDecimalPlaces(0).abs().toFixed();
const times = (v: string | null) => (v === null ? 'Không xác định' : `${formatNumber(D(v), 2)} lần`);
const percent = (v: string | null) => (v === null ? 'Không xác định' : formatPercent(v));
function attempt<T>(f: () => T): { value: T } | { error: string } {
  try {
    return { value: f() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Không tính được' };
  }
}

const METHODS: { value: RepaymentMethod; label: string }[] = [
  { value: 'ANNUITY', label: 'Trả góp đều' },
  { value: 'EQUAL_PRINCIPAL', label: 'Gốc đều, lãi giảm dần' },
  { value: 'BULLET', label: 'Gốc trả cuối kỳ' },
  { value: 'LUMP_SUM', label: 'Gốc + lãi một lần' },
];

function LoanTool() {
  const [f, setF] = useState({
    principal: '',
    rate: '',
    periods: '12',
    months: '1',
    method: 'ANNUITY' as RepaymentMethod,
    fees: '',
  });
  const rate = pct(f.rate);
  const ready = f.principal !== '' && rate !== null && Number(f.periods) > 0;
  const r = ready
    ? attempt(() => {
        const s = loanSchedule({
          principal: f.principal,
          annualRate: String(rate),
          periods: Number(f.periods),
          periodMonths: Number(f.months),
          method: f.method,
        });
        return {
          s,
          cost: loanEffectiveCost(s, f.principal, f.fees || '0', { periodMonths: Number(f.months) }),
        };
      })
    : null;
  return (
    <>
      <Card title="Khoản vay">
        <Money label="Số tiền vay" value={f.principal} onChange={(v) => setF({ ...f, principal: v })} />
        <Input
          label="Lãi suất (%/năm)"
          keyboardType="decimal-pad"
          value={f.rate}
          onChangeText={(v) => setF({ ...f, rate: v.replace(/[^\d.,]/g, '') })}
        />
        <Input
          label="Số kỳ trả nợ"
          keyboardType="number-pad"
          value={f.periods}
          onChangeText={(v) => setF({ ...f, periods: v.replace(/[^\d]/g, '') })}
        />
        <Choice
          label="Mỗi kỳ"
          value={f.months}
          options={[
            { value: '1', label: '1 tháng' },
            { value: '3', label: 'Quý' },
            { value: '6', label: '6 tháng' },
            { value: '12', label: 'Năm' },
          ]}
          onChange={(v) => setF({ ...f, months: v })}
        />
        <Choice
          label="Phương thức trả nợ"
          value={f.method}
          options={METHODS}
          onChange={(v) => setF({ ...f, method: v as RepaymentMethod })}
        />
        <Money
          label="Phí vay (để tính lãi suất thực)"
          value={f.fees}
          onChange={(v) => setF({ ...f, fees: v })}
        />
      </Card>
      {!r ? (
        <Text style={T.muted}>Nhập số tiền vay, lãi suất và số kỳ để lập lịch trả nợ.</Text>
      ) : 'error' in r ? (
        <Notice tone="danger">{r.error}</Notice>
      ) : (
        <>
          <Card title="Kết quả">
            <KV
              rows={[
                ...(r.value.s.instalment
                  ? [{ label: 'Trả đều mỗi kỳ', value: vnd(r.value.s.instalment) }]
                  : []),
                { label: 'Tổng tiền lãi', value: vnd(r.value.s.totalInterest) },
                { label: 'Tổng phải trả', value: vnd(r.value.s.totalPayment) },
                ...(r.value.cost
                  ? [{ label: 'Lãi suất thực / năm', value: formatPercent(r.value.cost.annual) }]
                  : []),
              ]}
            />
          </Card>
          <Card title="Lịch trả nợ" subtitle="Đơn vị: đồng">
            {r.value.s.rows.map((x) => (
              <View
                key={x.period}
                style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }}
              >
                <Text style={[T.body, T.strong]}>
                  Kỳ {x.period}, phải trả {formatNumber(D(x.payment))}
                </Text>
                <Text style={T.small}>
                  Gốc {formatNumber(D(x.principal))}, lãi {formatNumber(D(x.interest))}, còn nợ{' '}
                  {formatNumber(D(x.closing))}
                </Text>
              </View>
            ))}
          </Card>
        </>
      )}
    </>
  );
}

function LeverageTool() {
  const [f, setF] = useState({
    revenue: '',
    variable: '',
    fixed: '',
    interest: '',
    tax: '20',
    assets: '',
    equity: '',
  });
  const booksQuery = useQuery('ledger.overview', { months: '12' });
  const books = booksQuery.data?.applicable ? booksQuery.data.calculators : null;
  const t = pct(f.tax);
  const lev =
    f.revenue && f.variable && f.fixed
      ? attempt(() =>
          totalLeverage({
            revenue: f.revenue,
            variableCosts: f.variable,
            fixedCosts: f.fixed,
            interest: f.interest || '0',
            taxRate: String(t ?? 0),
          }),
        )
      : null;
  const ebit = lev && 'value' in lev ? lev.value.ebit : null;
  const bal =
    ebit !== null && f.assets && f.equity && t !== null
      ? attempt(() => {
          const interest = f.interest || '0';
          const netIncome = D(ebit)
            .minus(interest)
            .times(1 - t)
            .toFixed();
          return {
            s: capitalStructure({ totalAssets: f.assets, equity: f.equity }),
            d: dupont({ netIncome, revenue: f.revenue, totalAssets: f.assets, equity: f.equity }),
            mm: leverageEffect({
              ebit,
              interest,
              taxRate: String(t),
              totalAssets: f.assets,
              equity: f.equity,
            }),
            tie: interestCoverage(ebit, interest),
          };
        })
      : null;
  return (
    <>
      {books && (
        <Button
          title="Lấy từ sổ sách"
          onPress={() =>
            setF({
              revenue: whole(books.revenue),
              variable: whole(books.variableCosts),
              fixed: D(books.fixedCosts).isNegative() ? '0' : whole(books.fixedCosts),
              interest: whole(books.interest),
              tax: D(books.taxRate).times(100).toFixed(),
              assets: whole(books.totalAssets),
              equity: whole(books.equity),
            })
          }
        />
      )}
      <Gap />
      <Card title="Số liệu kỳ phân tích">
        <Money label="Doanh thu thuần" value={f.revenue} onChange={(v) => setF({ ...f, revenue: v })} />
        <Money label="Biến phí" value={f.variable} onChange={(v) => setF({ ...f, variable: v })} />
        <Money
          label="Định phí (không gồm lãi vay)"
          value={f.fixed}
          onChange={(v) => setF({ ...f, fixed: v })}
        />
        <Money label="Chi phí lãi vay" value={f.interest} onChange={(v) => setF({ ...f, interest: v })} />
        <Input
          label="Thuế suất TNDN (%)"
          keyboardType="decimal-pad"
          value={f.tax}
          onChangeText={(v) => setF({ ...f, tax: v.replace(/[^\d.,]/g, '') })}
        />
        <Money label="Tổng tài sản" value={f.assets} onChange={(v) => setF({ ...f, assets: v })} />
        <Money label="Vốn chủ sở hữu" value={f.equity} onChange={(v) => setF({ ...f, equity: v })} />
      </Card>
      {lev && 'error' in lev && <Notice tone="danger">{lev.error}</Notice>}
      {lev && 'value' in lev && (
        <Card title="Đòn bẩy">
          <KV
            rows={[
              { label: 'EBIT', value: vnd(lev.value.ebit) },
              { label: 'Đòn bẩy kinh doanh (DOL)', value: times(lev.value.dol) },
              { label: 'Đòn bẩy tài chính (DFL)', value: times(lev.value.dfl) },
              { label: 'Đòn bẩy tổng hợp (DTL)', value: times(lev.value.dtl) },
            ]}
          />
        </Card>
      )}
      {bal && 'error' in bal && <Notice tone="danger">{bal.error}</Notice>}
      {bal && 'value' in bal && (
        <Card title="Cơ cấu vốn và hiệu quả">
          <KV
            rows={[
              { label: 'Hệ số nợ', value: percent(bal.value.s.debtRatio) },
              { label: 'Hệ số nợ trên vốn chủ (LEV)', value: times(bal.value.s.debtToEquity) },
              { label: 'Khả năng trả lãi vay', value: times(bal.value.tie) },
              { label: 'ROA', value: percent(bal.value.d.roa) },
              { label: 'ROE', value: percent(bal.value.d.roe) },
              { label: 'Chi phí nợ sau thuế', value: percent(bal.value.mm.afterTaxCostOfDebt) },
            ]}
          />
          <Text style={[T.small, { marginTop: 6 }]}>
            {bal.value.mm.favourable
              ? `Vay nợ làm ROE tăng thêm ${formatPercent(bal.value.mm.leverageContribution)}`
              : `Vay nợ làm ROE giảm ${formatPercent(D(bal.value.mm.leverageContribution).abs())}`}
          </Text>
        </Card>
      )}
    </>
  );
}

export function FinanceToolsScreen() {
  const [tool, setTool] = useState('loan');
  return (
    <Screen>
      <Title title="Công cụ tính toán" subtitle="Vay vốn và đòn bẩy tài chính" />
      <Choice
        value={tool}
        options={[
          { value: 'loan', label: 'Vay vốn' },
          { value: 'leverage', label: 'Đòn bẩy & chỉ số' },
        ]}
        onChange={setTool}
      />
      {tool === 'loan' ? <LoanTool /> : <LeverageTool />}
    </Screen>
  );
}
