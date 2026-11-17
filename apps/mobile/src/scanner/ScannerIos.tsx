import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView } from 'expo-camera';
import { Camera, CircleAlert, Images, QrCode, ScanLine, Zap, ZapOff } from 'lucide-react-native';
import { formatVnd } from '@argolet/core';
import { Text } from '../textScale';
import { megapixels, useScanner, type ScannerProps } from './useScanner';

/** iOS system colours (dark camera, light sheet) with the ARGOLET green as the tint. */
const I = {
  tint: '#087452',
  green: '#30D158',
  yellow: '#FFD60A',
  label: '#000000',
  secondaryLabel: 'rgba(60,60,67,0.6)',
  groupedBg: '#F2F2F7',
  cell: '#FFFFFF',
  separator: 'rgba(60,60,67,0.18)',
  fill: 'rgba(120,120,128,0.16)',
  orange: '#FF9500',
  blue: '#0A84FF',
};
const SF = 'System';

/**
 * iOS: the scanner follows the Human Interface Guidelines and the document scanner people know
 * from their iPhone — black camera screen, text buttons "Hủy" and "Lưu", the round white shutter,
 * "Tự động / Thủ công" in yellow, the document area tinted when the invoice is recognised, and a
 * light sheet with an inset grouped list to review each page.
 */
export function ScannerIos(props: ScannerProps) {
  const { visible, onClose, onLibrary } = props;
  const sc = useScanner(props);
  const insets = useSafeAreaInsets();
  const library = () => {
    onClose();
    onLibrary();
  };
  const hint = !sc.ready
    ? 'Đang mở camera'
    : sc.qr
      ? sc.auto
        ? 'Giữ yên, đang tự chụp'
        : 'Đã nhận ra hóa đơn, bấm chụp'
      : 'Đưa camera lên trên chứng từ';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.top}>
          {sc.granted && !sc.shot ? (
            <Pressable
              style={[s.round, sc.torch && { backgroundColor: I.yellow }]}
              onPress={sc.toggleTorch}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={sc.torch ? 'Tắt đèn' : 'Bật đèn'}
            >
              {sc.torch ? <Zap size={18} color="#000" /> : <ZapOff size={18} color="#fff" />}
            </Pressable>
          ) : (
            <View style={s.roundSpace} />
          )}
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={s.title}>Quét hóa đơn</Text>
            {sc.pages.length > 0 && <Text style={s.caption}>{`${sc.pages.length} trang đã lưu`}</Text>}
          </View>
          {sc.granted && !sc.shot ? (
            <Pressable
              onPress={() => sc.setAuto(!sc.auto)}
              hitSlop={10}
              style={s.modeBtn}
              accessibilityRole="switch"
              accessibilityState={{ checked: sc.auto }}
              accessibilityLabel="Tự động chụp"
            >
              <Text style={[s.mode, sc.auto && { color: I.yellow }]}>{sc.auto ? 'Tự động' : 'Thủ công'}</Text>
            </Pressable>
          ) : (
            <View style={s.modeBtn} />
          )}
        </View>

        {!sc.permission ? (
          <View style={s.center}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : !sc.granted ? (
          <View style={s.center}>
            <Camera size={44} color="rgba(235,235,245,0.6)" />
            <Text style={s.permTitle}>Cho phép truy cập camera</Text>
            <Text style={s.permBody}>
              {sc.permission.canAskAgain
                ? 'ARGOLET dùng camera để quét chứng từ và đọc mã QR trên hóa đơn.'
                : 'Mở Cài đặt, chọn ARGOLET và bật Camera, hoặc chọn ảnh có sẵn.'}
            </Text>
            {sc.permission.canAskAgain && (
              <Pressable
                style={s.bigTint}
                onPress={() => void sc.requestPermission()}
                accessibilityRole="button"
              >
                <Text style={s.bigTintText}>Tiếp tục</Text>
              </Pressable>
            )}
            <Pressable onPress={library} hitSlop={8} accessibilityRole="button">
              <Text style={s.plainDark}>Chọn ảnh có sẵn</Text>
            </Pressable>
          </View>
        ) : (
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
                <View style={s.docWrap} pointerEvents="none">
                  <View style={[s.docOuter, sc.qr && { borderColor: 'transparent' }]}>
                    <View style={[s.doc, sc.qr && s.docOn]}>
                      <View style={s.hint} accessibilityLiveRegion="polite">
                        <Text style={s.hintText}>{hint}</Text>
                      </View>
                    </View>
                  </View>
                </View>
                {sc.qr && (
                  <View style={s.found} pointerEvents="none">
                    <QrCode size={14} color="#fff" />
                    <Text style={s.foundText} numberOfLines={1}>
                      {`Hóa đơn số ${sc.qr.documentNo}, ${formatVnd(sc.qr.total)}`}
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <Image
                source={{ uri: sc.shot.uri }}
                style={s.shot}
                resizeMode="contain"
                accessibilityLabel="Ảnh vừa chụp"
              />
            )}
          </View>
        )}

        {sc.granted && !sc.shot && (
          <View style={[s.bottom, { paddingBottom: Math.max(20, insets.bottom + 6) }]}>
            <Pressable
              style={s.sideL}
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Hủy"
            >
              <Text style={s.barText}>Hủy</Text>
            </Pressable>
            <Pressable
              style={[s.shutter, (!sc.ready || sc.busy) && { opacity: 0.4 }]}
              disabled={!sc.ready || sc.busy}
              onPress={() => void sc.capture()}
              accessibilityRole="button"
              accessibilityLabel="Chụp"
            >
              {({ pressed }) => <View style={[s.shutterIn, pressed && { transform: [{ scale: 0.9 }] }]} />}
            </Pressable>
            {sc.pages.length ? (
              <Pressable
                style={s.sideR}
                onPress={onClose}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Xong, ${sc.pages.length} trang`}
              >
                <View style={s.stack}>
                  {sc.pages.length > 1 && <View style={[s.stackBack]} />}
                  <Image source={{ uri: sc.pages[sc.pages.length - 1] }} style={s.stackFront} />
                </View>
                <Text style={[s.barText, { fontWeight: '600' }]}>{`Lưu (${sc.pages.length})`}</Text>
              </Pressable>
            ) : (
              <Pressable
                style={s.sideR}
                onPress={library}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Thư viện"
              >
                <Images size={26} color="#fff" />
              </Pressable>
            )}
          </View>
        )}

        {sc.shot && (
          <View
            style={[s.sheet, { paddingBottom: Math.max(20, insets.bottom + 8) }]}
            accessibilityLabel="Kiểm tra ảnh vừa chụp"
          >
            <View style={s.grabber} />
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>{`Trang ${sc.pages.length + 1}`}</Text>
              <Text style={[s.sheetState, { color: sc.lowRes ? I.orange : I.tint }]}>
                {sc.lowRes ? 'Nên chụp gần hơn' : 'Đạt yêu cầu'}
              </Text>
            </View>
            <View style={s.group}>
              <Row
                color={sc.lowRes ? I.orange : I.green}
                icon={sc.lowRes ? 'warn' : 'scan'}
                label="Độ phân giải"
                value={megapixels(sc.shot.width, sc.shot.height)}
              />
              <View style={s.sep} />
              <Row
                color={
                  sc.shotQr
                    ? sc.shotQr.crcOk && !sc.shotQr.problems.length
                      ? I.blue
                      : I.orange
                    : 'rgba(120,120,128,0.6)'
                }
                icon="qr"
                label={
                  sc.shotQr
                    ? sc.shotQr.crcOk && !sc.shotQr.problems.length
                      ? `Đã đọc mã QR hóa đơn số ${sc.shotQr.documentNo}`
                      : `Mã QR hóa đơn bị lỗi: ${sc.shotQr.problems[0]}`
                    : 'Không thấy mã QR hóa đơn'
                }
                value={sc.shotQr && sc.shotQr.crcOk ? formatVnd(sc.shotQr.total) : undefined}
              />
            </View>
            <Pressable style={s.bigTint} onPress={() => sc.keep(false)} accessibilityRole="button">
              <Text style={s.bigTintText}>Dùng ảnh này</Text>
            </Pressable>
            <Pressable style={s.bigGray} onPress={() => sc.keep(true)} accessibilityRole="button">
              <Text style={s.bigGrayText}>Chụp trang tiếp</Text>
            </Pressable>
            <Pressable style={s.plainRow} onPress={sc.retake} hitSlop={6} accessibilityRole="button">
              <Text style={s.plain}>Chụp lại</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

function Row({
  color,
  icon,
  label,
  value,
}: {
  color: string;
  icon: 'scan' | 'warn' | 'qr';
  label: string;
  value?: string | undefined;
}) {
  return (
    <View style={s.row}>
      <View style={[s.rowIcon, { backgroundColor: color }]}>
        {icon === 'qr' ? (
          <QrCode size={17} color="#fff" />
        ) : icon === 'warn' ? (
          <CircleAlert size={17} color="#fff" />
        ) : (
          <ScanLine size={17} color="#fff" />
        )}
      </View>
      <Text style={s.rowLabel} numberOfLines={2}>
        {label}
      </Text>
      {value ? <Text style={s.rowValue}>{value}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  round: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(118,118,128,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundSpace: { width: 36, height: 36 },
  title: { color: '#fff', fontFamily: SF, fontSize: 17, fontWeight: '600' },
  caption: { color: 'rgba(235,235,245,0.6)', fontFamily: SF, fontSize: 12, marginTop: 1 },
  modeBtn: { minWidth: 76, alignItems: 'flex-end' },
  mode: { color: '#fff', fontFamily: SF, fontSize: 17 },
  view: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  docWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docOuter: {
    width: '84%',
    aspectRatio: 1 / 1.414,
    maxHeight: '92%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.35)',
  },
  doc: {
    flex: 1,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  docOn: { borderWidth: 2, borderColor: I.green, backgroundColor: 'rgba(48,209,88,0.18)' },
  hint: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.55)' },
  hintText: { color: '#fff', fontFamily: SF, fontSize: 15, fontWeight: '500' },
  found: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(48,209,88,0.85)',
  },
  foundText: { color: '#fff', fontFamily: SF, fontSize: 13, fontWeight: '600' },
  shot: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  permTitle: {
    color: '#fff',
    fontFamily: SF,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 8,
  },
  permBody: {
    color: 'rgba(235,235,245,0.6)',
    fontFamily: SF,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 20,
  },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 18,
    paddingHorizontal: 24,
    backgroundColor: '#000',
  },
  sideL: { width: 88 },
  sideR: { width: 88, alignItems: 'flex-end', gap: 6 },
  barText: { color: '#fff', fontFamily: SF, fontSize: 17 },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterIn: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  stack: { width: 40, height: 50 },
  stackBack: {
    position: 'absolute',
    top: -3,
    left: 4,
    width: 36,
    height: 48,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.55)',
    transform: [{ rotate: '6deg' }],
  },
  stackFront: { width: 36, height: 48, borderRadius: 4, borderWidth: 1, borderColor: '#fff' },
  sheet: {
    backgroundColor: I.groupedBg,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingHorizontal: 16,
    paddingTop: 6,
    gap: 10,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#C7C7CC',
    marginBottom: 6,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  sheetTitle: { color: I.label, fontFamily: SF, fontSize: 22, fontWeight: '700' },
  sheetState: { fontFamily: SF, fontSize: 15, fontWeight: '600' },
  group: { backgroundColor: I.cell, borderRadius: 10, overflow: 'hidden' },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  rowIcon: { width: 29, height: 29, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, color: I.label, fontFamily: SF, fontSize: 16 },
  rowValue: { color: I.secondaryLabel, fontFamily: SF, fontSize: 16 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: I.separator, marginLeft: 55 },
  bigTint: {
    height: 50,
    borderRadius: 12,
    backgroundColor: I.tint,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  bigTintText: { color: '#fff', fontFamily: SF, fontSize: 17, fontWeight: '600' },
  bigGray: {
    height: 50,
    borderRadius: 12,
    backgroundColor: I.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigGrayText: { color: I.tint, fontFamily: SF, fontSize: 17, fontWeight: '600' },
  plainRow: { alignItems: 'center', paddingVertical: 6 },
  plain: { color: I.tint, fontFamily: SF, fontSize: 17 },
  plainDark: { color: I.green, fontFamily: SF, fontSize: 17 },
});
