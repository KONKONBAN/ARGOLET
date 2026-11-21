/**
 * Larger text for older users. The phone's own font size setting is always respected (React
 * Native scales text with it); on top of that the app offers "Chữ lớn" / "Rất lớn" in its own
 * settings and on the sign-in screen, for people who never change the phone settings.
 */
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ComponentRef,
  type ReactNode,
  type Ref,
} from 'react';
import {
  Platform,
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  useWindowDimensions,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useScreenFit } from './fit';

export const TEXT_SIZES = [
  { value: 1, label: 'Thường' },
  { value: 1.15, label: 'Lớn' },
  { value: 1.3, label: 'Rất lớn' },
] as const;
const KEY = 'argolet_text_scale';

let scale = 1;
const listeners = new Set<() => void>();

async function load(): Promise<void> {
  try {
    const raw = Platform.OS === 'web' ? localStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    const v = Number(raw);
    if (TEXT_SIZES.some((s) => s.value === v) && v !== scale) {
      scale = v;
      listeners.forEach((l) => l());
    }
  } catch {
    /* no saved preference */
  }
}
void load();

export function setTextScale(v: number): void {
  if (!TEXT_SIZES.some((s) => s.value === v)) return;
  scale = v;
  listeners.forEach((l) => l());
  try {
    if (Platform.OS === 'web') localStorage.setItem(KEY, String(v));
    else void SecureStore.setItemAsync(KEY, String(v)).catch(() => undefined);
  } catch {
    /* kept for this session only */
  }
}

export function useTextScale(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => scale,
    () => scale,
  );
}

/**
 * True when text is large enough that side-by-side layouts should stack: the app's own setting
 * combined with the phone's font size.
 */
export function useLargeText(): boolean {
  const k = useTextScale();
  const { fontScale } = useWindowDimensions();
  return k * fontScale >= 1.25;
}

/** Font size and line height multiplied by the chosen scale (nested text inherits its parent's). */
function scaled(style: TextProps['style'], k: number, nested: boolean): TextStyle | undefined {
  if (k === 1) return undefined;
  const s = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  if (s.fontSize === undefined && nested) return undefined;
  return {
    fontSize: (s.fontSize ?? 14) * k,
    ...(typeof s.lineHeight === 'number' ? { lineHeight: s.lineHeight * k } : {}),
  };
}

const Nested = createContext(false);

/** The app's text size combined with the fit to this screen (larger on big phones and tablets). */
function useEffectiveScale(): number {
  return useTextScale() * useScreenFit().text;
}

/** Drop-in for React Native's Text that follows the app's text size and the screen. */
export function Text(props: TextProps & { children?: ReactNode }) {
  const k = useEffectiveScale();
  const nested = useContext(Nested);
  const extra = scaled(props.style, k, nested);
  return (
    <Nested.Provider value>
      <RNText {...props} style={extra ? [props.style, extra] : props.style} />
    </Nested.Provider>
  );
}

/** The instance a TextInput ref receives (focus, blur, clear). */
export type TextInputHandle = ComponentRef<typeof RNTextInput>;

/** Drop-in for React Native's TextInput that follows the app's text size and the screen. */
export function TextInput({ ref, ...props }: TextInputProps & { ref?: Ref<TextInputHandle> }) {
  const k = useEffectiveScale();
  const extra = scaled(props.style as TextProps['style'], k, false);
  return <RNTextInput ref={ref} {...props} style={extra ? [props.style, extra] : props.style} />;
}
