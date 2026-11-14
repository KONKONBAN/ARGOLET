import { Linking, Pressable, View } from 'react-native';
import { Text } from './textScale';
import { CircleCheck, CircleX, ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react-native';
import type { AuthenticityResult, CheckStatus } from '@argolet/core';
import { C } from './theme';
import { Card, Chip, T } from './ui';

const ORDER: Record<CheckStatus, number> = { FAIL: 0, WARN: 1, PASS: 2, NA: 3 };
const TONE = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'success' } as const;
const ICON_COLOR = { PASS: C.action, WARN: C.warning, FAIL: C.danger, NA: C.muted } as const;

/** "Kiểm tra chứng từ giả" — the same checks as on the web, problems first; a person decides. */
export function AuthenticityCard({ result }: { result: AuthenticityResult }) {
  const shown = result.checks
    .filter((c) => c.status !== 'NA')
    .sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const skipped = result.checks.length - shown.length;
  const Shield = result.level === 'LOW' ? ShieldCheck : ShieldAlert;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Shield
          size={20}
          color={result.level === 'LOW' ? C.action : result.level === 'HIGH' ? C.danger : C.warning}
        />
        <Text style={[T.body, T.strong]}>Kiểm tra chứng từ giả</Text>
        <Chip tone={TONE[result.level]}>{result.levelLabel}</Chip>
      </View>
      {shown.map((c) => {
        const Icon = c.status === 'PASS' ? CircleCheck : c.status === 'WARN' ? TriangleAlert : CircleX;
        return (
          <View key={c.code} style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Icon size={16} color={ICON_COLOR[c.status]} style={{ marginTop: 2 }} />
            <Text style={[T.small, { flex: 1 }]}>
              <Text style={[T.strong, { color: C.text }]}>{c.label}</Text>
              {`: ${c.detail}`}
            </Text>
          </View>
        );
      })}
      {skipped > 0 && (
        <Text
          style={[T.small, { marginTop: 10 }]}
        >{`${skipped} mục không áp dụng cho loại chứng từ này.`}</Text>
      )}
      {result.lookupUrl && (
        <Pressable
          accessibilityRole="link"
          onPress={() => void Linking.openURL(result.lookupUrl!).catch(() => undefined)}
          style={{ marginTop: 10 }}
        >
          <Text style={[T.small, { color: C.action, fontWeight: '600' }]}>
            Tra cứu trạng thái hủy / thay thế trên cổng hóa đơn điện tử ›
          </Text>
        </Pressable>
      )}
    </Card>
  );
}
