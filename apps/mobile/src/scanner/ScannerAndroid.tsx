import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView } from 'expo-camera';
import {
  Camera,
  CameraOff,
  Check,
  CircleAlert,
  CircleCheck,
  Images,
  Lock,
  QrCode,
  ScanLine,
  X,
  Zap,
  ZapOff,
} from 'lucide-react-native';
import { formatVnd } from '@argolet/core';
import { Text } from '../textScale';
import { font } from '../theme';
import { megapixels, useScanner, type ScannerProps } from './useScanner';

/** Material 3 dark scheme built from the ARGOLET green (#087452). */
const M = {
  bg: '#0F1512',
  surface: '#171D1A',
  container: '#1B211E',
  containerHigh: '#252B28',
  onSurface: '#DEE4DF',
  onSurfaceVariant: '#BFC9C2',
  outline: '#89938C',
  outlineVariant: '#3F4944',
  primary: '#83D7B0',
  onPrimary: '#003825',
  primaryContainer: '#005236',
  onPrimaryContainer: '#9FF4CB',
  secondaryContainer: '#344B40',
  onSecondaryContainer: '#CFE9DB',
  inverseSurface: '#DEE4DF',
  inverseOnSurface: '#2B322E',
  warning: '#F5C26B',
  scrim: 'rgba(15,21,18,0.62)',
};
const ripple = { color: 'rgba(222,228,223,0.16)', borderless: false };
const rippleRound = { color: 'rgba(222,228,223,0.2)', borderless: true, radius: 24 };

/**
 * Android: the scanner follows Material Design 3 — a small top app bar with the title on the left,
 * a filter chip for automatic capture, a large floating action button to take the picture, a
 * snackbar when a page is added and a modal bottom sheet to review it.
 */
export function ScannerAndroid(props: ScannerProps) {
  const { visible, onClose, onLibrary } = props;
  const sc = useScanner(props);
  const insets = useSafeAreaInsets();
  const library = () => {
    onClose();
    onLibrary();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[s.root, { paddingTop: insets.top }]}>
        {/* Small top app bar */}
        <View style={s.appBar}>
          <Pressable
            style={s.navIcon}
            onPress={onClose}
            android_ripple={rippleRound}
            accessibilityRole="button"
            accessibilityLabel="Đóng"
          >
            <X size={24} color={M.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Quét hóa đơn</Text>
            <Text style={s.subtitle}>
              {sc.pages.length
                ? `Đã thêm ${sc.pages.length} trang`
                : 'Hóa đơn, phiếu thu chi, phiếu giao hàng'}
            </Text>
          </View>
          {sc.granted && !sc.shot && (
            <Pressable
              style={[s.navIcon, sc.torch && { backgroundColor: M.secondaryContainer }]}
              onPress={sc.toggleTorch}
              android_ripple={rippleRound}
              accessibilityRole="button"
              accessibilityLabel={sc.torch ? 'Tắt đèn' : 'Bật đèn'}
            >
              {sc.torch ? (
                <Zap size={22} color={M.onSecondaryContainer} />
              ) : (
                <ZapOff size={22} color={M.onSurface} />
              )}
            </Pressable>
          )}
        </View>

        {!sc.permission ? (
          <View style={s.center}>
            <ActivityIndicator color={M.primary} />
          </View>
        ) : !sc.granted ? (
          <View style={s.center}>
            <View style={s.emptyIcon}>
              <CameraOff size={32} color={M.onPrimaryContainer} />
            </View>
            <Text style={s.emptyTitle}>Cho phép dùng camera</Text>
            <Text style={s.emptyBody}>
              {sc.permission.canAskAgain
                ? 'ARGOLET dùng camera để chụp chứng từ và đọc mã QR hóa đơn.'
                : 'Quyền camera đang tắt. Bật lại trong Cài đặt, mục Ứng dụng, ARGOLET, Quyền.'}
            </Text>
            {sc.permission.canAskAgain && (
              <Pressable style={s.filled} onPress={() => void sc.requestPermission()} android_ripple={ripple}>
                <Text style={s.filledText}>Cho phép</Text>
              </Pressable>
            )}
            <Pressable style={s.textBtn} onPress={library} android_ripple={ripple}>
              <Text style={s.textBtnText}>Chọn ảnh có sẵn</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {!sc.shot && (
              <View style={s.chips}>
                <Pressable
                  style={[s.chip, sc.auto && s.chipOn]}
                  onPress={() => sc.setAuto(!sc.auto)}
                  android_ripple={ripple}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: sc.auto }}
                  accessibilityLabel="Tự động chụp"
                >
                  {sc.auto && <Check size={18} color={M.onSecondaryContainer} />}
                  <Text style={[s.chipText, sc.auto && { color: M.onSecondaryContainer }]}>Tự động chụp</Text>
                </Pressable>
              </View>
            )}
            <View style={s.view}>
              {!sc.shot ? (
                <>
                  <CameraView
                    ref={sc.camRef}
                    style={StyleSheet.absoluteFill}
                    facing="back"
                    enableTorch={sc.torch}
                    onCameraReady={sc.onCameraReady}
                    barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                    onBarcodeScanned={sc.onBarcodeScanned}
                  />
                  <View style={s.overlay} pointerEvents="none">
                    <View style={s.scrim} />
                    <View style={s.frameRow}>
                      <View style={s.scrim} />
                      <View style={[s.frame, sc.qr && s.frameOn]} />
                      <View style={s.scrim} />
                    </View>
                    <View style={s.scrim} />
                  </View>
                  <View style={s.status} accessibilityLiveRegion="polite">
                    {sc.qr ? (
                      <CircleCheck size={18} color={M.primary} />
                    ) : (
                      <ScanLine size={18} color={M.onSurfaceVariant} />
                    )}
                    <Text style={s.statusText} numberOfLines={2}>
                      {!sc.ready
                        ? 'Đang mở camera'
                        : sc.qr
                          ? `Mã QR hóa đơn số ${sc.qr.documentNo}, ${formatVnd(sc.qr.total)}${sc.auto ? ', giữ yên' : ''}`
                          : 'Đặt cả bốn góc chứng từ trong khung'}
                    </Text>
                  </View>
                </>
              ) : (
                <Image
                  source={{ uri: sc.shot.uri }}
                  style={s.shot}
                  resizeMode="contain"
                  accessibilityLabel="Ảnh vừa chụp"
                />
              )}
              {!!sc.added && !sc.shot && (
                <View style={s.snackbar} accessibilityLiveRegion="polite">
                  <Text style={s.snackbarText}>{`Đã thêm trang ${sc.added}`}</Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* Bottom bar: library, large FAB, pages */}
        {sc.granted && !sc.shot && (
          <View style={[s.bottom, { paddingBottom: Math.max(16, insets.bottom + 8) }]}>
            <View style={s.bottomRow}>
              <Pressable
                style={s.side}
                onPress={library}
                accessibilityRole="button"
                accessibilityLabel="Thư viện"
              >
                <View style={s.tonalIcon}>
                  <Images size={22} color={M.onSecondaryContainer} />
                </View>
                <Text style={s.sideText}>Thư viện</Text>
              </Pressable>
              <Pressable
                style={[s.fab, (!sc.ready || sc.busy) && { opacity: 0.5 }]}
                disabled={!sc.ready || sc.busy}
                onPress={() => void sc.capture()}
                android_ripple={{ color: 'rgba(159,244,203,0.25)', borderless: false }}
                accessibilityRole="button"
                accessibilityLabel="Chụp"
              >
                {sc.busy ? (
                  <ActivityIndicator color={M.onPrimaryContainer} />
                ) : (
                  <Camera size={34} color={M.onPrimaryContainer} />
                )}
              </Pressable>
              {sc.pages.length ? (
                <Pressable
                  style={s.side}
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel={`Xong, ${sc.pages.length} trang`}
                >
                  <View>
                    <Image source={{ uri: sc.pages[sc.pages.length - 1] }} style={s.thumb} />
                    <View style={s.badge}>
                      <Text style={s.badgeText}>{sc.pages.length}</Text>
                    </View>
                  </View>
                  <Text style={s.sideText}>Xong</Text>
                </Pressable>
              ) : (
                <View style={s.side} />
              )}
            </View>
            <View style={s.trust}>
              <Lock size={12} color={M.outline} />
              <Text style={s.trustText}>Ảnh được mã hóa, chỉ dùng cho hồ sơ của bạn</Text>
            </View>
          </View>
        )}

        {/* Modal bottom sheet: review the page */}
        {sc.shot && (
          <View
            style={[s.sheet, { paddingBottom: Math.max(16, insets.bottom + 8) }]}
            accessibilityLabel="Kiểm tra ảnh vừa chụp"
          >
            <View style={s.handle} />
            <View style={s.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.sheetTitle}>{`Xem lại trang ${sc.pages.length + 1}`}</Text>
                <Text style={s.sheetSupport}>
                  {sc.lowRes ? 'Ảnh nhỏ, nên chụp gần hơn' : 'Ảnh đạt yêu cầu'}
                </Text>
              </View>
              <Pressable
                style={s.textBtn}
                onPress={sc.retake}
                android_ripple={ripple}
                accessibilityRole="button"
              >
                <Text style={s.textBtnText}>Chụp lại</Text>
              </Pressable>
            </View>
            <ListItem
              icon={sc.lowRes ? 'warn' : 'ok'}
              text={`Độ phân giải ${megapixels(sc.shot.width, sc.shot.height)}`}
            />
            <ListItem
              icon="qr"
              text={
                sc.shotQr
                  ? sc.shotQr.crcOk && !sc.shotQr.problems.length
                    ? `Đã đọc mã QR hóa đơn số ${sc.shotQr.documentNo}, ${formatVnd(sc.shotQr.total)}`
                    : `Mã QR hóa đơn bị lỗi: ${sc.shotQr.problems[0]}`
                  : 'Không thấy mã QR hóa đơn, nhập các trường khi kiểm tra'
              }
              muted={!sc.shotQr}
            />
            <View style={s.sheetActions}>
              <Pressable
                style={[s.outlined, { flex: 1 }]}
                onPress={() => sc.keep(true)}
                android_ripple={ripple}
                accessibilityRole="button"
              >
                <Text style={s.outlinedText}>Chụp trang tiếp</Text>
              </Pressable>
              <Pressable
                style={[s.filled, { flex: 1 }]}
                onPress={() => sc.keep(false)}
                android_ripple={ripple}
                accessibilityRole="button"
              >
                <Text style={s.filledText}>Dùng ảnh này</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

function ListItem({ icon, text, muted }: { icon: 'ok' | 'warn' | 'qr'; text: string; muted?: boolean }) {
  const color = icon === 'warn' ? M.warning : muted ? M.onSurfaceVariant : M.primary;
  return (
    <View style={s.item}>
      {icon === 'qr' ? (
        <QrCode size={22} color={color} />
      ) : icon === 'ok' ? (
        <CircleCheck size={22} color={color} />
      ) : (
        <CircleAlert size={22} color={color} />
      )}
      <Text style={[s.itemText, muted && { color: M.onSurfaceVariant }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: M.bg },
  appBar: { height: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, gap: 4 },
  navIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  title: { color: M.onSurface, fontFamily: font, fontSize: 22 },
  subtitle: { color: M.onSurfaceVariant, fontFamily: font, fontSize: 13, marginTop: 1 },
  chips: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  chip: {
    height: 32,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: M.outline,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  chipOn: { backgroundColor: M.secondaryContainer, borderColor: M.secondaryContainer, paddingLeft: 8 },
  chipText: { color: M.onSurfaceVariant, fontFamily: font, fontSize: 14, fontWeight: '500' },
  view: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  scrim: { flex: 1, backgroundColor: M.scrim },
  frameRow: { flexDirection: 'row', aspectRatio: 1 / (0.8 * 1.414) },
  frame: {
    width: '80%',
    height: '100%',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(222,228,223,0.75)',
  },
  frameOn: { borderColor: M.primary, borderWidth: 3 },
  status: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: M.containerHigh,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    elevation: 3,
  },
  statusText: { flex: 1, color: M.onSurface, fontFamily: font, fontSize: 14 },
  snackbar: {
    position: 'absolute',
    bottom: 80,
    left: 16,
    right: 16,
    minHeight: 48,
    borderRadius: 4,
    paddingHorizontal: 16,
    justifyContent: 'center',
    backgroundColor: M.inverseSurface,
    elevation: 6,
  },
  snackbarText: { color: M.inverseOnSurface, fontFamily: font, fontSize: 14 },
  shot: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: M.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { color: M.onSurface, fontFamily: font, fontSize: 22 },
  emptyBody: {
    color: M.onSurfaceVariant,
    fontFamily: font,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  bottom: { backgroundColor: M.container, paddingTop: 16, paddingHorizontal: 16, gap: 12 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  side: { width: 76, alignItems: 'center', gap: 4 },
  sideText: { color: M.onSurfaceVariant, fontFamily: font, fontSize: 12, fontWeight: '500' },
  tonalIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: M.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: M.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    overflow: 'hidden',
  },
  thumb: { width: 44, height: 56, borderRadius: 8, borderWidth: 2, borderColor: M.onSurface },
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: M.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: M.onPrimary, fontFamily: font, fontSize: 11, fontWeight: '700' },
  trust: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  trustText: { color: M.outline, fontFamily: font, fontSize: 12 },
  sheet: {
    backgroundColor: M.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    elevation: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: M.onSurfaceVariant,
    opacity: 0.4,
    marginBottom: 16,
  },
  sheetTitle: { color: M.onSurface, fontFamily: font, fontSize: 22 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  sheetSupport: { color: M.onSurfaceVariant, fontFamily: font, fontSize: 14, marginTop: 4 },
  item: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 16 },
  itemText: { flex: 1, color: M.onSurface, fontFamily: font, fontSize: 16 },
  sheetActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  filled: {
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 24,
    backgroundColor: M.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  filledText: { color: M.onPrimary, fontFamily: font, fontSize: 14, fontWeight: '500' },
  outlined: {
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: M.outline,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  outlinedText: { color: M.primary, fontFamily: font, fontSize: 14, fontWeight: '500' },
  textBtn: {
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  textBtnText: { color: M.primary, fontFamily: font, fontSize: 14, fontWeight: '500' },
});
