import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, scanFromURLAsync, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import {
  CameraOff,
  CircleAlert,
  CircleCheck,
  Images,
  Lock,
  QrCode,
  RotateCcw,
  X,
  Zap,
  ZapOff,
} from 'lucide-react-native';
import { formatVnd, readQrContent } from '@argolet/core';
import { Text } from './textScale';
import { C, font } from './theme';

export interface ScannedPage {
  name: string;
  mime: string;
  base64: string;
  uri: string;
  width: number;
  height: number;
  /** The e-invoice QR seen in the viewfinder when the page was taken (checked again on the server). */
  qr: string | null;
}

const DARK = '#04111B';
const READY = '#34D399';
const MIN_SIDE = 1000;
/** The e-invoice QR must stay in view this long before an automatic capture. */
const AUTO_MS = 1000;

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** "1,9 MP": the picture size in megapixels. */
export const megapixels = (w: number, h: number) => `${((w * h) / 1e6).toFixed(1).replace('.', ',')} MP`;

function invoiceQr(raw: string | null) {
  if (!raw) return null;
  const c = readQrContent(raw);
  return c.kind === 'INVOICE' ? c.qr : null;
}

/**
 * In-app document scanner, designed like the ID scanners of banking and securities apps: a
 * full-screen viewfinder with a document frame, the e-invoice QR detected live, manual or
 * automatic capture, the torch, a review sheet with the checks, page after page.
 */
export function DocumentScanner({
  visible,
  onClose,
  onCapture,
  onLibrary,
}: {
  visible: boolean;
  onClose: () => void;
  onCapture: (page: ScannedPage) => void;
  onLibrary: () => void;
}) {
  const insets = useSafeAreaInsets();
  const camRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seenQr, setSeenQr] = useState<string | null>(null);
  const seenAt = useRef<{ raw: string; since: number; last: number } | null>(null);
  const [shot, setShot] = useState<ScannedPage | null>(null);
  const [pages, setPages] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    setShot(null);
    setPages([]);
    setReady(false);
    setTorch(false);
    setSeenQr(null);
    seenAt.current = null;
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // The QR leaves the view: forget it after a moment.
  useEffect(() => {
    if (!visible || shot) return;
    const id = setInterval(() => {
      const s = seenAt.current;
      if (s && Date.now() - s.last > 1200) {
        seenAt.current = null;
        setSeenQr(null);
      }
    }, 400);
    return () => clearInterval(id);
  }, [visible, shot]);

  const capture = async () => {
    if (!camRef.current || !ready || busy) return;
    setBusy(true);
    try {
      const p = await camRef.current.takePictureAsync({ base64: true, quality: 0.8 });
      if (!p) return;
      setShot({
        name: `chung-tu-${stamp()}-${pages.length + 1}.jpg`,
        mime: 'image/jpeg',
        base64: (p.base64 ?? '').replace(/^data:image\/\w+;base64,/, ''),
        uri: p.uri,
        width: p.width,
        height: p.height,
        qr: seenAt.current?.raw ?? null,
      });
      // No QR caught live: read it from the picture itself.
      if (!seenAt.current) {
        const uri = p.uri;
        void scanFromURLAsync(uri, ['qr'])
          .then((r) => r.map((x) => x.data.trim()).find((v) => invoiceQr(v)) ?? null)
          .catch(() => null)
          .then((qr) => qr && setShot((cur) => (cur && cur.uri === uri ? { ...cur, qr } : cur)));
      }
    } finally {
      setBusy(false);
    }
  };

  const onBarcode = (r: BarcodeScanningResult) => {
    const raw = r.data?.trim();
    if (!raw || !invoiceQr(raw)) return;
    const now = Date.now();
    const s = seenAt.current;
    seenAt.current = s && s.raw === raw ? { ...s, last: now } : { raw, since: now, last: now };
    if (seenQr !== raw) setSeenQr(raw);
    if (auto && !shot && !busy && now - seenAt.current.since >= AUTO_MS) {
      seenAt.current = { raw, since: now + 60_000, last: now };
      void capture();
    }
  };

  const keep = (more: boolean) => {
    if (!shot) return;
    onCapture(shot);
    setPages((list) => [...list, shot.uri]);
    setShot(null);
    if (!more) onClose();
  };

  const qr = invoiceQr(seenQr);
  const granted = permission?.granted;
  const lowRes = shot ? Math.max(shot.width, shot.height) < MIN_SIDE : false;
  const shotQr = invoiceQr(shot?.qr ?? null);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.top}>
          <Pressable style={s.icon} onPress={onClose} accessibilityRole="button" accessibilityLabel="Đóng">
            <X size={22} color="#fff" />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={s.title}>Chụp chứng từ</Text>
            <Text style={s.subtitle}>
              {pages.length ? `Đã thêm ${pages.length} trang` : 'Hóa đơn, phiếu thu chi, phiếu giao hàng'}
            </Text>
          </View>
          {granted && !shot ? (
            <Pressable
              style={[s.icon, torch && { backgroundColor: '#FFD84D' }]}
              onPress={() => setTorch((t) => !t)}
              accessibilityRole="button"
              accessibilityLabel={torch ? 'Tắt đèn' : 'Bật đèn'}
            >
              {torch ? <Zap size={20} color="#1B1500" /> : <ZapOff size={20} color="#fff" />}
            </Pressable>
          ) : (
            <View style={s.icon} />
          )}
        </View>

        {!permission ? (
          <View style={s.center}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : !granted ? (
          <View style={s.center}>
            <View style={s.errIcon}>
              <CameraOff size={28} color="#FBBF24" />
            </View>
            <Text style={s.errText}>
              {permission.canAskAgain
                ? 'ARGOLET cần quyền dùng camera để chụp chứng từ.'
                : 'Quyền camera đang tắt. Bật lại trong Cài đặt của điện thoại, hoặc chọn ảnh có sẵn.'}
            </Text>
            {permission.canAskAgain && (
              <Pressable
                style={s.primary}
                onPress={() => void requestPermission()}
                accessibilityRole="button"
              >
                <Text style={s.primaryText}>Cho phép dùng camera</Text>
              </Pressable>
            )}
            <Pressable
              style={s.secondaryDark}
              onPress={() => {
                onClose();
                onLibrary();
              }}
              accessibilityRole="button"
            >
              <Text style={s.secondaryDarkText}>Chọn ảnh có sẵn</Text>
            </Pressable>
          </View>
        ) : (
          <View style={s.view}>
            {!shot ? (
              <>
                <CameraView
                  ref={camRef}
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  enableTorch={torch}
                  onCameraReady={() => setReady(true)}
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={onBarcode}
                />
                <View style={s.maskWrap} pointerEvents="none">
                  <View style={s.mask} />
                  <View style={s.maskRow}>
                    <View style={s.mask} />
                    <View style={s.frame}>
                      {(['tl', 'tr', 'bl', 'br'] as const).map((k) => (
                        <View key={k} style={[s.corner, s[k], qr && { borderColor: READY }]} />
                      ))}
                    </View>
                    <View style={s.mask} />
                  </View>
                  <View style={s.mask} />
                </View>
                <View style={[s.guide, qr && s.guideReady]} accessibilityLiveRegion="polite">
                  {qr ? <CircleCheck size={16} color="#fff" /> : <QrCode size={16} color="#fff" />}
                  <Text style={s.guideText} numberOfLines={1}>
                    {!ready
                      ? 'Đang mở camera'
                      : qr
                        ? auto
                          ? 'Đã thấy mã QR hóa đơn, giữ yên'
                          : 'Đã thấy mã QR hóa đơn, bấm nút chụp'
                        : 'Đặt chứng từ nằm trọn trong khung'}
                  </Text>
                </View>
                {qr && (
                  <View style={s.qrChip}>
                    <Text style={s.qrChipText} numberOfLines={1}>
                      {`Số ${qr.documentNo}, ${formatVnd(qr.total)}`}
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <Image
                source={{ uri: shot.uri }}
                style={s.shot}
                resizeMode="contain"
                accessibilityLabel="Ảnh vừa chụp"
              />
            )}
          </View>
        )}

        {granted && !shot && (
          <View style={[s.bottom, { paddingBottom: Math.max(14, insets.bottom) }]}>
            <View style={s.modes} accessibilityRole="radiogroup">
              {[
                { on: !auto, label: 'Chụp tay', set: false },
                { on: auto, label: 'Tự động chụp', set: true },
              ].map((m) => (
                <Pressable
                  key={m.label}
                  style={[s.mode, m.on && s.modeOn]}
                  onPress={() => setAuto(m.set)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: m.on }}
                >
                  <Text style={[s.modeText, m.on && { color: DARK }]}>{m.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={s.controls}>
              <Pressable
                style={s.side}
                onPress={() => {
                  onClose();
                  onLibrary();
                }}
                accessibilityRole="button"
                accessibilityLabel="Thư viện"
              >
                <Images size={24} color="#fff" />
                <Text style={s.sideText}>Thư viện</Text>
              </Pressable>
              <Pressable
                style={[s.shutter, qr && { borderColor: READY }, (!ready || busy) && { opacity: 0.45 }]}
                disabled={!ready || busy}
                onPress={() => void capture()}
                accessibilityRole="button"
                accessibilityLabel="Chụp"
              >
                {busy ? <ActivityIndicator color={DARK} /> : <View style={s.shutterIn} />}
              </Pressable>
              {pages.length ? (
                <Pressable
                  style={s.side}
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel={`Xong, ${pages.length} trang`}
                >
                  <View style={s.thumb}>
                    <Image source={{ uri: pages[pages.length - 1] }} style={s.thumbImg} />
                    <View style={s.badge}>
                      <Text style={s.badgeText}>{pages.length}</Text>
                    </View>
                  </View>
                  <Text style={s.sideText}>Xong</Text>
                </Pressable>
              ) : (
                <View style={s.side} />
              )}
            </View>
            <View style={s.trust}>
              <Lock size={12} color="rgba(255,255,255,0.56)" />
              <Text style={s.trustText}>
                {auto
                  ? 'Tự động chụp khi thấy mã QR hóa đơn'
                  : 'Ảnh được mã hóa khi gửi, chỉ dùng cho hồ sơ của bạn'}
              </Text>
            </View>
          </View>
        )}

        {shot && (
          <View
            style={[s.sheet, { paddingBottom: Math.max(18, insets.bottom) }]}
            accessibilityLabel="Kiểm tra ảnh vừa chụp"
          >
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>{lowRes ? 'Ảnh nhỏ, nên chụp gần hơn' : 'Ảnh đạt yêu cầu'}</Text>
              <View style={[s.pageBadge, lowRes && { backgroundColor: C.warningBg }]}>
                <Text
                  style={[s.pageBadgeText, lowRes && { color: C.warning }]}
                >{`Trang ${pages.length + 1}`}</Text>
              </View>
            </View>
            <Check ok={!lowRes} label={`Độ phân giải ${megapixels(shot.width, shot.height)}`} />
            {shotQr ? (
              <Check
                ok={shotQr.crcOk && !shotQr.problems.length}
                label={
                  shotQr.crcOk && !shotQr.problems.length
                    ? `Đã đọc mã QR hóa đơn số ${shotQr.documentNo}, ${formatVnd(shotQr.total)}`
                    : `Mã QR hóa đơn bị lỗi: ${shotQr.problems[0]}`
                }
                icon="qr"
              />
            ) : (
              <Check ok label="Không thấy mã QR hóa đơn, nhập các trường khi kiểm tra" muted icon="qr" />
            )}
            <View style={s.sheetActions}>
              <Pressable style={s.secondary} onPress={() => keep(true)} accessibilityRole="button">
                <Text style={s.secondaryText}>Chụp trang tiếp</Text>
              </Pressable>
              <Pressable style={s.primary} onPress={() => keep(false)} accessibilityRole="button">
                <Text style={s.primaryText}>Dùng ảnh này</Text>
              </Pressable>
            </View>
            <Pressable
              style={[s.secondary, { marginTop: 10 }]}
              onPress={() => setShot(null)}
              accessibilityRole="button"
            >
              <RotateCcw size={16} color={C.text} />
              <Text style={s.secondaryText}>Chụp lại</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

function Check({ ok, label, icon, muted }: { ok: boolean; label: string; icon?: 'qr'; muted?: boolean }) {
  const color = muted ? C.muted : ok ? C.action : C.warning;
  return (
    <View style={s.check}>
      {icon === 'qr' ? (
        <QrCode size={16} color={color} />
      ) : ok ? (
        <CircleCheck size={16} color={color} />
      ) : (
        <CircleAlert size={16} color={color} />
      )}
      <Text style={[s.checkText, muted && { color: C.muted }]}>{label}</Text>
    </View>
  );
}

const FRAME_W = '78%';
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: DARK },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  title: { color: '#fff', fontFamily: font, fontSize: 16, fontWeight: '600' },
  subtitle: { color: 'rgba(255,255,255,0.66)', fontFamily: font, fontSize: 12, marginTop: 2 },
  view: { flex: 1, overflow: 'hidden', backgroundColor: DARK },
  maskWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  mask: { flex: 1, backgroundColor: 'rgba(4,17,27,0.58)' },
  maskRow: { flexDirection: 'row', aspectRatio: 1 / (0.78 * 1.414) },
  frame: {
    width: FRAME_W,
    height: '100%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 14,
  },
  corner: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderColor: '#fff',
    borderStyle: 'solid',
    borderWidth: 0,
  },
  tl: { top: -7, left: -7, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 20 },
  tr: { top: -7, right: -7, borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: 20 },
  bl: { bottom: -7, left: -7, borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: 20 },
  br: { bottom: -7, right: -7, borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: 20 },
  guide: {
    position: 'absolute',
    top: 14,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '92%',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(4,17,27,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  guideReady: { backgroundColor: C.action, borderColor: READY },
  guideText: { color: '#fff', fontFamily: font, fontSize: 14, fontWeight: '500' },
  qrChip: {
    position: 'absolute',
    bottom: 14,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(4,17,27,0.78)',
    borderWidth: 1,
    borderColor: READY,
  },
  qrChipText: { color: '#fff', fontFamily: font, fontSize: 13 },
  shot: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  errIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(251,191,36,0.16)',
  },
  errText: {
    color: 'rgba(255,255,255,0.86)',
    fontFamily: font,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  bottom: { paddingTop: 14, paddingHorizontal: 20, alignItems: 'center', gap: 14, backgroundColor: DARK },
  modes: { flexDirection: 'row', padding: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)' },
  mode: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999 },
  modeOn: { backgroundColor: '#fff' },
  modeText: { color: 'rgba(255,255,255,0.74)', fontFamily: font, fontSize: 13, fontWeight: '500' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: 420,
  },
  side: { width: 72, alignItems: 'center', gap: 4 },
  sideText: { color: 'rgba(255,255,255,0.86)', fontFamily: font, fontSize: 12 },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 6,
    borderColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterIn: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  thumb: { width: 40, height: 52, borderRadius: 8, borderWidth: 2, borderColor: '#fff' },
  thumbImg: { width: '100%', height: '100%', borderRadius: 6 },
  badge: {
    position: 'absolute',
    top: -8,
    right: -10,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: READY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: DARK, fontFamily: font, fontSize: 12, fontWeight: '700' },
  trust: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trustText: { color: 'rgba(255,255,255,0.56)', fontFamily: font, fontSize: 12 },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 18,
    paddingHorizontal: 20,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sheetTitle: { color: C.text, fontFamily: font, fontSize: 16, fontWeight: '600', flex: 1 },
  pageBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: C.successBg },
  pageBadgeText: { color: C.action, fontFamily: font, fontSize: 12, fontWeight: '600' },
  check: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  checkText: { color: C.text, fontFamily: font, fontSize: 14, flex: 1 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  primary: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: C.action,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryText: { color: '#fff', fontFamily: font, fontSize: 15, fontWeight: '600' },
  secondary: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
  },
  secondaryText: { color: C.text, fontFamily: font, fontSize: 15, fontWeight: '600' },
  secondaryDark: {
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  secondaryDarkText: { color: '#fff', fontFamily: font, fontSize: 15, fontWeight: '600' },
});
