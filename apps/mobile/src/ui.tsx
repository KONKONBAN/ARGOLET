import {
  Children,
  cloneElement,
  isValidElement,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import {
  Text,
  TextInput,
  TEXT_SIZES,
  setTextScale,
  useLargeText,
  useTextScale,
  type TextInputHandle,
} from './textScale';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRefreshing } from '@argolet/client';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Eye,
  EyeOff,
  Info,
  TriangleAlert,
  X,
} from 'lucide-react-native';
import { C, G, R, font } from './theme';

/** A note such as "Tại quầy 248,6 triệu, nền tảng 180 triệu" wraps only between its parts. */
const keepPhrases = (note: string) =>
  note
    .split(', ')
    .map((part) => part.replace(/ /g, '\u00a0'))
    .join(', ');

/** Money figures stay on one line: with large text they shrink to fit rather than wrap mid-number. */
const FIT = { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.5 } as const;

export const T = StyleSheet.create({
  eyebrow: { fontSize: 12, fontWeight: '700', color: C.muted, textTransform: 'uppercase', fontFamily: font },
  title: { fontSize: 26, fontWeight: '700', color: C.text, fontFamily: font, letterSpacing: -0.2 },
  h2: { fontSize: 16, fontWeight: '700', color: C.text, fontFamily: font },
  body: { fontSize: 14, color: C.text, fontFamily: font },
  muted: { fontSize: 13, color: C.muted, fontFamily: font },
  small: { fontSize: 12, color: C.muted, fontFamily: font },
  strong: { fontWeight: '700' },
});

export function Screen({
  children,
  footer,
  scroll = true,
}: {
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  // While data on screen is reloaded after a change, it is dimmed and not tappable.
  const refreshing = useRefreshing();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }} aria-busy={refreshing || undefined}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: footer ? 110 : 32 }}
          keyboardShouldPersistTaps="handled"
          style={refreshing ? { opacity: 0.55, pointerEvents: 'none' } : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, padding: 16 }}>{children}</View>
      )}
      {footer && (
        <View style={[st.footer, { paddingBottom: 12 + (insets.bottom > 0 ? 0 : 0) }]}>{footer}</View>
      )}
    </View>
  );
}

export function Title({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      {eyebrow && <Text style={T.eyebrow}>{eyebrow}</Text>}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          marginTop: eyebrow ? 6 : 0,
        }}
      >
        <Text style={[T.title, { flex: 1 }]} accessibilityRole="header">
          {title}
        </Text>
        {right}
      </View>
      {subtitle && <Text style={[T.muted, { marginTop: 8 }]}>{subtitle}</Text>}
    </View>
  );
}

export function Card({
  children,
  title,
  subtitle,
  style,
  right,
}: {
  children?: ReactNode;
  title?: string;
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
  right?: ReactNode;
}) {
  return (
    <View style={[st.card, style]}>
      {(title || right) && (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 10,
            gap: 8,
          }}
        >
          <View style={{ flex: 1 }}>
            {title && <Text style={T.h2}>{title}</Text>}
            {subtitle && <Text style={[T.small, { marginTop: 4 }]}>{subtitle}</Text>}
          </View>
          {right}
        </View>
      )}
      {markLastRow(children)}
    </View>
  );
}

/** Drops the divider under the final Row of a card so cards don't end on a stray line. */
function markLastRow(children: ReactNode): ReactNode {
  const items = Children.toArray(children);
  const last = items[items.length - 1];
  if (!isValidElement(last) || last.type !== Row) return items.length ? items : children;
  return [...items.slice(0, -1), cloneElement(last as ReactElement<RowProps>, { last: true })];
}

export function Hero({
  label,
  value,
  note,
  children,
}: {
  label: string;
  value: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <LinearGradient colors={G.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.hero}>
      {/* The headline figure is centred above the split figures, a size larger. */}
      <View style={{ alignItems: 'center' }}>
        <Text style={{ color: C.heroMuted, fontSize: 13, fontFamily: font, textAlign: 'center' }}>
          {label}
        </Text>
        <Text
          {...FIT}
          style={{
            color: C.heroStrong,
            fontSize: 34,
            fontWeight: '700',
            marginTop: 6,
            fontFamily: font,
            textAlign: 'center',
          }}
        >
          {value}
        </Text>
        {note && (
          <Text
            style={{ color: C.heroMuted, fontSize: 12, marginTop: 6, fontFamily: font, textAlign: 'center' }}
          >
            {note}
          </Text>
        )}
      </View>
      {children}
    </LinearGradient>
  );
}

/**
 * Two equal columns under a hero figure (e.g. revenue | expense), separated by hairlines. With
 * large text (the app's setting or the phone's), they stack so each figure keeps its full size.
 */
export function HeroSplit({ items }: { items: { label: string; value: string; note?: string }[] }) {
  const stacked = useLargeText();
  return (
    <View
      style={{
        flexDirection: stacked ? 'column' : 'row',
        marginTop: 14,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: 'rgba(213,232,231,0.25)',
      }}
    >
      {items.map((x, i) => (
        <View
          key={x.label}
          style={
            stacked
              ? {
                  alignItems: 'center',
                  paddingTop: i ? 12 : 0,
                  marginTop: i ? 12 : 0,
                  borderTopWidth: i ? 1 : 0,
                  borderTopColor: 'rgba(213,232,231,0.25)',
                }
              : {
                  flex: 1,
                  alignItems: 'center',
                  paddingHorizontal: 6,
                  marginLeft: i ? 6 : 0,
                  borderLeftWidth: i ? 1 : 0,
                  borderLeftColor: 'rgba(213,232,231,0.25)',
                }
          }
        >
          <Text style={{ color: C.heroMuted, fontSize: 12, fontFamily: font, textAlign: 'center' }}>
            {x.label}
          </Text>
          <Text
            {...FIT}
            style={{
              color: '#fff',
              textAlign: 'center',
              fontSize: stacked ? 22 : 17,
              fontWeight: '700',
              marginTop: 4,
              fontFamily: font,
            }}
          >
            {x.value}
          </Text>
          {x.note ? (
            <Text
              style={{
                color: C.heroMuted,
                fontSize: 12,
                marginTop: 4,
                fontFamily: font,
                textAlign: 'center',
              }}
            >
              {keepPhrases(x.note)}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function Kpi({
  label,
  value,
  note,
  highlight,
}: {
  label: string;
  value: string | number;
  note?: string | undefined;
  highlight?: boolean | undefined;
}) {
  const content = (
    <>
      <Text style={{ fontSize: 12, color: highlight ? C.heroMuted : C.muted, fontFamily: font }}>
        {label}
      </Text>
      <Text
        {...FIT}
        style={{
          fontSize: 22,
          fontWeight: '700',
          color: highlight ? '#fff' : C.brand,
          marginTop: 4,
          fontFamily: font,
        }}
      >
        {value}
      </Text>
      {note && (
        <Text
          style={{
            fontSize: 12,
            color: highlight ? C.heroMuted : C.muted,
            marginTop: 4,
            fontFamily: font,
            textAlign: 'center',
          }}
        >
          {note}
        </Text>
      )}
    </>
  );
  return highlight ? (
    <LinearGradient
      colors={G.hero}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[st.kpi, { borderColor: 'transparent' }]}
    >
      {content}
    </LinearGradient>
  ) : (
    <View style={st.kpi}>{content}</View>
  );
}

export function KpiGrid({
  items,
}: {
  items: {
    label: string;
    value: string | number;
    note?: string | undefined;
    highlight?: boolean | undefined;
  }[];
}) {
  return (
    <View style={{ gap: 10, marginBottom: 14 }}>
      {items.map((k) => (
        <Kpi key={k.label} {...k} />
      ))}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'default',
  loading,
  disabled,
  icon,
  small,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'default' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  small?: boolean;
}) {
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      {loading ? <ActivityIndicator color={variant === 'primary' ? '#fff' : C.action} /> : icon}
      <Text
        style={{
          color: variant === 'primary' ? '#fff' : variant === 'danger' ? C.danger : C.brand,
          fontWeight: '700',
          fontSize: small ? 13 : 15,
          fontFamily: font,
        }}
      >
        {title}
      </Text>
    </View>
  );
  const height = small ? 38 : 48;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled || !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: disabled ? 0.5 : pressed ? 0.85 : 1 })}
    >
      {variant === 'primary' ? (
        <LinearGradient
          colors={G.action}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[st.btn, { height }]}
        >
          {inner}
        </LinearGradient>
      ) : (
        <View style={[st.btn, st.btnDefault, { height }]}>{inner}</View>
      )}
    </Pressable>
  );
}

export function Input({
  label,
  error,
  hint,
  secure,
  ...rest
}: TextInputProps & { label: string; error?: string | undefined; hint?: string; secure?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[T.body, { marginBottom: 8 }]}>{label}</Text>
      <View>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor="#8EA2AE"
          style={[st.input, error ? { borderColor: '#E3A29B' } : null, secure ? { paddingRight: 48 } : null]}
          secureTextEntry={secure && !show}
          autoCapitalize="none"
          {...rest}
        />
        {secure && (
          <Pressable
            onPress={() => setShow((s) => !s)}
            style={st.eye}
            accessibilityLabel={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          >
            {show ? <Eye size={20} color={C.muted} /> : <EyeOff size={20} color={C.muted} />}
          </Pressable>
        )}
      </View>
      {error ? (
        <Text style={{ color: C.danger, fontSize: 12, marginTop: 6 }}>{error}</Text>
      ) : hint ? (
        <Text style={[T.small, { marginTop: 6 }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function OtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<TextInputHandle>(null);
  return (
    <Pressable onPress={() => ref.current?.focus()} accessibilityLabel="Mã xác minh 6 số">
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <View key={i} style={[st.otpBox, value.length === i ? { borderColor: C.action } : null]}>
            <Text style={{ fontSize: 20, fontWeight: '600', color: C.text }}>{value[i] ?? ''}</Text>
          </View>
        ))}
      </View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        style={{ position: 'absolute', opacity: 0.01, width: 1, height: 1 }}
        autoFocus
        textContentType="oneTimeCode"
        accessibilityLabel="Nhập mã"
      />
    </Pressable>
  );
}

export type Tone = 'success' | 'warning' | 'neutral' | 'danger' | 'info' | string;
export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  const bg =
    tone === 'success'
      ? C.successBg
      : tone === 'warning'
        ? C.warningBg
        : tone === 'danger'
          ? C.dangerBg
          : tone === 'info'
            ? '#EAF1F7'
            : C.soft;
  const fg =
    tone === 'success'
      ? C.action
      : tone === 'warning'
        ? C.warning
        : tone === 'danger'
          ? C.danger
          : tone === 'info'
            ? C.info
            : C.muted;
  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: R.sm,
        paddingHorizontal: 8,
        paddingVertical: 4,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: fg, fontSize: 12, fontFamily: font }}>{children}</Text>
    </View>
  );
}

type RowProps = {
  title: string;
  subtitle?: string | undefined;
  right?: ReactNode;
  icon?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  last?: boolean;
};
export function Row({ title, subtitle, right, icon, onPress, chevron, last }: RowProps) {
  const content = (
    <View style={[st.row, last ? { borderBottomWidth: 0 } : null]}>
      {icon && <View style={st.iconTile}>{icon}</View>}
      <View style={{ flex: 1 }}>
        <Text style={[T.body, T.strong]}>{title}</Text>
        {subtitle && <Text style={[T.small, { marginTop: 4 }]}>{subtitle}</Text>}
      </View>
      {right}
      {chevron && <ChevronRight size={18} color={C.muted} />}
    </View>
  );
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
  ) : (
    content
  );
}

/** Page controls for long lists: previous · "Trang x/y" · next, with the visible range. */
export function Pager({
  page,
  pageCount,
  total,
  pageSize,
  onPage,
  unit = 'bản ghi',
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  unit?: string;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn = (dir: -1 | 1) => {
    const disabled = dir < 0 ? page <= 1 : page >= pageCount;
    const Icon = dir < 0 ? ChevronLeft : ChevronRight;
    return (
      <Pressable
        onPress={() => !disabled && onPage(page + dir)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={dir < 0 ? 'Trang trước' : 'Trang sau'}
        accessibilityState={{ disabled }}
        style={[st.pagerBtn, disabled ? { opacity: 0.35 } : null]}
        hitSlop={6}
      >
        <Icon size={20} color={C.text} />
      </Pressable>
    );
  };
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 6,
        marginBottom: 14,
      }}
    >
      {btn(-1)}
      <View style={{ alignItems: 'center' }}>
        <Text style={[T.body, T.strong]}>{`Trang ${page} / ${pageCount}`}</Text>
        <Text style={[T.small, { marginTop: 2 }]}>{`${from} đến ${to} trên ${total} ${unit}`}</Text>
      </View>
      {btn(1)}
    </View>
  );
}

export function KV({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <View>
      {rows.map((r) => (
        <View key={r.label} style={st.kv}>
          <Text style={[T.muted, { flex: 1 }]}>{r.label}</Text>
          <Text style={[T.body, { flex: 1.3, textAlign: 'right' }]}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function Steps({ items }: { items: { title: string; sub?: string; done?: boolean }[] }) {
  return (
    <View>
      {items.map((it, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 12, paddingBottom: 18 }}>
          <View style={[st.stepNum, it.done ? { backgroundColor: C.action } : null]}>
            {it.done ? (
              <Check size={13} color="#fff" />
            ) : (
              <Text style={{ color: C.action, fontSize: 12, fontWeight: '700' }}>{i + 1}</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[T.body, T.strong, { fontSize: 13 }]}>{it.title}</Text>
            {it.sub && <Text style={[T.small, { marginTop: 4 }]}>{it.sub}</Text>}
          </View>
        </View>
      ))}
    </View>
  );
}

export function Notice({
  children,
  tone = 'warning',
}: {
  children: ReactNode;
  tone?: 'warning' | 'info' | 'success' | 'danger';
}) {
  const Icon =
    tone === 'success' ? Check : tone === 'info' ? Info : tone === 'danger' ? CircleAlert : TriangleAlert;
  const bg =
    tone === 'success'
      ? C.successBg
      : tone === 'info'
        ? '#EEF5FA'
        : tone === 'danger'
          ? C.dangerBg
          : C.warningBg;
  const fg =
    tone === 'success' ? C.action : tone === 'info' ? '#2F5F80' : tone === 'danger' ? C.danger : C.warning;
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 10,
        backgroundColor: bg,
        borderRadius: R.md,
        padding: 12,
        marginVertical: 8,
      }}
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
    >
      <Icon size={16} color={fg} />
      <Text style={{ color: fg, fontSize: 12, flex: 1, lineHeight: 18 }}>{children}</Text>
    </View>
  );
}

export function Loading() {
  return (
    <View
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: 24 }}
    >
      <ActivityIndicator color={C.action} />
      <Text style={[T.small, { marginTop: 10 }]}>Đang tải</Text>
    </View>
  );
}

export function ErrorView({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: C.bg }}>
      <Notice tone="danger">{error.message}</Notice>
      {onRetry && <Button title="Thử lại" onPress={onRetry} />}
    </View>
  );
}

export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(11,28,40,0.45)' }}
        onPress={onClose}
        accessibilityLabel="Đóng"
      />
      <View style={st.sheet}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <Text style={[T.h2, { fontSize: 18 }]}>{title}</Text>
          <Pressable onPress={onClose} accessibilityLabel="Đóng" hitSlop={12}>
            <X size={22} color={C.muted} />
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </Modal>
  );
}

export function Gap({ h = 12 }: { h?: number }) {
  return <View style={{ height: h }} />;
}

const st = StyleSheet.create({
  sizeRow: { flexDirection: 'row', gap: 8 },
  sizeBtn: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: '#fff',
    paddingVertical: 6,
  },
  sizeBtnOn: { backgroundColor: C.action, borderColor: C.action },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    padding: 16,
    marginBottom: 14,
  },
  hero: { borderRadius: R.lg, padding: 18, marginBottom: 14 },
  kpi: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  btn: { borderRadius: R.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnDefault: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: C.inputLine,
    borderRadius: R.md,
    paddingHorizontal: 14,
    fontSize: 15,
    color: C.text,
    backgroundColor: '#fff',
    fontFamily: font,
  },
  eye: { position: 'absolute', right: 10, top: 12 },
  otpBox: {
    width: 44,
    height: 50,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.inputLine,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  pagerBtn: {
    width: 44,
    height: 44,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: R.md,
    backgroundColor: C.successBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.successBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 12,
    backgroundColor: 'rgba(245,247,248,0.96)',
    borderTopWidth: 1,
    borderTopColor: C.line,
    gap: 8,
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 18,
    maxHeight: '85%',
  },
});

/** "Cỡ chữ" picker: big targets, the current choice marked, text grows as soon as it is tapped. */
export function TextSizePicker() {
  const k = useTextScale();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Cỡ chữ" style={st.sizeRow}>
      {TEXT_SIZES.map((s) => {
        const on = s.value === k;
        return (
          <Pressable
            key={s.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => setTextScale(s.value)}
            style={[st.sizeBtn, on ? st.sizeBtnOn : null]}
          >
            <Text style={{ fontSize: 13 * s.value, fontWeight: '700', color: on ? '#fff' : C.text }}>Aa</Text>
            <Text style={{ fontSize: 12, color: on ? '#fff' : C.muted, marginTop: 2 }}>{s.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
