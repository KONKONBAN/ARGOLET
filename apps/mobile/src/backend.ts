import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { HttpBackend, probeServer, type Backend, type TokenStore } from '@argolet/client';
import { deviceHttp, keyStoreBox } from '@argolet/client/device';
import { createAiKeys } from '@argolet/app/llm';

const TOKEN_KEY = 'argolet_session';
const SERVER_KEY = 'argolet_server_url';
const MODE_KEY = 'argolet_mode';
const DATA_FILE = 'argolet-du-lieu.json';

/** Session token kept in the device keychain / keystore (board 02: "token trong kho bảo mật của thiết bị"). */
const memory: Record<string, string | null> = {};
async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return memory[key] ?? null;
    }
  }
  return SecureStore.getItemAsync(key);
}
async function secureSet(key: string, value: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    } catch {
      memory[key] = value;
    }
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}

const tokenStore: TokenStore = { get: () => secureGet(TOKEN_KEY), set: (t) => secureSet(TOKEN_KEY, t) };

export async function getSavedServer(): Promise<string | null> {
  return secureGet(SERVER_KEY);
}
export async function saveServer(url: string | null): Promise<void> {
  await secureSet(SERVER_KEY, url ? url.replace(/\/$/, '') : null);
}

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: unknown; appEnv?: unknown };
/** The build's server address, only when it is a real string (manifests can carry {} for "none"). */
const BUILD_API_URL = typeof extra.apiUrl === 'string' && extra.apiUrl.trim() ? extra.apiUrl.trim() : null;

/** Store builds (APP_ENV=production) only ever talk to an ARGOLET server — never to sample data. */
export const IS_PRODUCTION = extra.appEnv === 'production';

/**
 * On the device the app runs either on the organisation's own data (kept on this phone, starting
 * empty, real dates) or, when someone asks to try it, on the sample company (nothing kept).
 */
export type DeviceMode = 'own' | 'sample';
export async function getDeviceMode(): Promise<DeviceMode> {
  return (await secureGet(MODE_KEY)) === 'sample' ? 'sample' : 'own';
}
export async function setDeviceMode(mode: DeviceMode): Promise<void> {
  await secureSet(MODE_KEY, mode === 'sample' ? 'sample' : null);
}

/** The organisation's data on this phone: one file in the app's private documents folder. */
const dataFile = () => new File(Paths.document, DATA_FILE);
function loadOwnData(): Record<string, Record<string, unknown>> | undefined {
  try {
    if (Platform.OS === 'web') {
      const raw = localStorage.getItem(DATA_FILE);
      return raw ? (JSON.parse(raw) as Record<string, Record<string, unknown>>) : undefined;
    }
    const f = dataFile();
    return f.exists ? (JSON.parse(f.textSync()) as Record<string, Record<string, unknown>>) : undefined;
  } catch {
    return undefined;
  }
}
function saveOwnData(dump: Record<string, Record<string, unknown>>): void {
  const text = JSON.stringify(dump);
  try {
    if (Platform.OS === 'web') return localStorage.setItem(DATA_FILE, text);
    const f = dataFile();
    if (!f.exists) f.create();
    f.write(text).catch((e: unknown) => console.error('Không lưu được dữ liệu trên thiết bị', e));
  } catch (e) {
    console.error('Không lưu được dữ liệu trên thiết bị', e);
  }
}

/** Partner APIs, the key box and Claude / ChatGPT, for the application running on the phone. */
function deviceServices() {
  return {
    http: deviceHttp(fetch, Platform.OS === 'web' ? 'browser' : 'phone'),
    secrets: keyStoreBox({ get: secureGet, set: secureSet }, () => Crypto.randomUUID()),
    aiKeys: createAiKeys({ browser: Platform.OS === 'web' }),
  };
}

/**
 * Transport selection:
 *  1. a server URL saved in settings, or the build's EXPO_PUBLIC_API_URL → that API (Bearer token);
 *  2. production: no server reachable → an error the start screen shows with "Thử lại";
 *  3. otherwise the full application on the phone: the organisation's own data kept on the device
 *     (partner connections and AI included), or the sample company when someone tries it out.
 */
export async function createMobileBackend(): Promise<Backend> {
  const configured = (await getSavedServer()) ?? (process.env.EXPO_PUBLIC_API_URL || BUILD_API_URL);
  if (configured) {
    if (IS_PRODUCTION && !configured.startsWith('https://'))
      throw new Error('Máy chủ ARGOLET phải dùng kết nối bảo mật (https://)');
    const info = await probeServer(configured, 8000);
    if (info) return new HttpBackend({ baseUrl: configured, info, auth: tokenStore });
  }
  if (IS_PRODUCTION)
    throw new Error(
      configured
        ? `Chưa kết nối được máy chủ ARGOLET (${configured.replace(/^https?:\/\//, '')}). Kiểm tra mạng rồi thử lại.`
        : 'Bản cài đặt chưa có địa chỉ máy chủ ARGOLET.',
    );
  const { createLocalBackend } = await import('@argolet/client/local');
  const userAgent = `ARGOLET ${Platform.OS}`;
  if ((await getDeviceMode()) === 'sample')
    return createLocalBackend({
      clockStart: Date.now(),
      tokens: { get: async () => memory.sample ?? null, set: async (t) => void (memory.sample = t) },
      label: 'Dữ liệu mẫu',
      userAgent,
      freshAfterSignOut: true,
      ...deviceServices(),
    });
  return createLocalBackend({
    seed: false,
    realClock: true,
    initial: loadOwnData(),
    persist: saveOwnData,
    clockStart: Date.now(),
    tokens: tokenStore,
    label: 'Dữ liệu lưu trên điện thoại này',
    userAgent,
    ...deviceServices(),
  });
}
