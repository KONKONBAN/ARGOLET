/**
 * Sổ sách & chỉ số (mobile): the books the Finance Engine keeps from confirmed documents — ratios,
 * income statement and financial position — with the Excel workbook to share.
 */
import { useState } from 'react';
import { Alert } from 'react-native';
import { useBackend, useQuery } from '@argolet/client';
import { D, formatNumber, formatPercent } from '@argolet/core';
import { shareFile } from '../share';
import { Button, Card, ErrorView, KV, Loading, Notice, Screen, Title } from '../ui';
import { Choice } from './modules';

type Unit = 'TIMES' | 'PERCENT' | 'DAYS';
export const ratioText = (r: { value: string | null; unit: Unit }) =>
  r.value === null
    ? 'Không xác định'
    : r.unit === 'PERCENT'
      ? formatPercent(r.value, 2)
      : r.unit === 'DAYS'
        ? `${formatNumber(D(r.value), 1)} ngày`
        : `${formatNumber(D(r.value), 2)} lần`;
const money = (v: string) => formatNumber(D(v));

export function FinanceBooksScreen() {
  const [view, setView] = useState('ratios');
  const q = useQuery('ledger.overview', { months: '12' });
  const { backend } = useBackend();
  const [exporting, setExporting] = useState(false);
  if (!q.data) return q.error ? <ErrorView error={q.error} /> : <Loading />;
  const b = q.data;
  if (!b.applicable)
    return (
      <Screen>
        <Title title="Sổ sách & chỉ số" />
        <Notice tone="info">
          Hộ kinh doanh ghi sổ theo mẫu của Thông tư 152/2025/TT-BTC trong Sổ sách & thuế.
        </Notice>
      </Screen>
    );
  const split = b.balance.end.lines.findIndex((l) => l.code === 'C');
  return (
    <Screen
      footer={
        b.canExport ? (
          <Button
            title="Xuất sổ kế toán (Excel)"
            variant="primary"
            loading={exporting}
            onPress={async () => {
              setExporting(true);
              try {
                const f = await backend.call('ledger.export', { months: '12' });
                await shareFile(f.filename, f.contentBase64, f.mime);
              } catch (e) {
                Alert.alert('Không xuất được sổ', e instanceof Error ? e.message : 'Thử lại sau');
              } finally {
                setExporting(false);
              }
            }}
          />
        ) : undefined
      }
    >
      <Title title="Sổ sách & chỉ số" subtitle={b.rangeLabel} />
      {(!b.hasOpening || b.warnings.length > 0) && (
        <Notice tone="warning">
          {[...(!b.hasOpening ? ['Chưa nhập số dư đầu kỳ.'] : []), ...b.warnings].join(' ')}
        </Notice>
      )}
      <Choice
        value={view}
        options={[
          { value: 'ratios', label: 'Chỉ số' },
          { value: 'income', label: 'Kết quả kinh doanh' },
          { value: 'position', label: 'Tình hình tài chính' },
        ]}
        onChange={setView}
      />
      {view === 'ratios' &&
        b.ratios.map((g) => (
          <Card key={g.key} title={g.label}>
            <KV rows={g.items.map((r) => ({ label: r.label, value: ratioText(r) }))} />
          </Card>
        ))}
      {view === 'income' && (
        <Card title={b.regime === 'TT99' ? 'B02-DN' : 'B02-DNN'} subtitle="Đơn vị: đồng">
          <KV rows={b.income.lines.map((l) => ({ label: `${l.code} ${l.label}`, value: money(l.value) }))} />
        </Card>
      )}
      {view === 'position' && (
        <>
          <Card title="Tài sản" subtitle="Cuối kỳ (đồng)">
            <KV
              rows={b.balance.end.lines
                .slice(0, split)
                .map((l) => ({ label: l.label, value: money(l.value) }))}
            />
          </Card>
          <Card title="Nguồn vốn" subtitle="Cuối kỳ (đồng)">
            <KV
              rows={b.balance.end.lines.slice(split).map((l) => ({ label: l.label, value: money(l.value) }))}
            />
          </Card>
        </>
      )}
    </Screen>
  );
}
