import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { HttpBackend, probeServer, type Backend, type TokenStore } from '@argolet/client';

const TOKEN_KEY = 'argolet_session';
const SERVER_KEY = 'argolet_server_url';

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
 * Transport selection:
 *  1. a server URL saved in settings, or the build's EXPO_PUBLIC_API_URL → that API (Bearer token);
 *  2. production: no server reachable → an error the start screen shows with "Thử lại";
 *  3. preview / development only: the full application on the device with labelled sample data.
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
  return createLocalBackend({
    clockStart: Date.now(),
    tokens: { get: async () => memory.local ?? null, set: async (t) => void (memory.local = t) },
    label: configured
      ? `Không kết nối được ${configured}, đang dùng dữ liệu mẫu trên thiết bị (bản thử nghiệm)`
      : 'Dữ liệu mẫu chạy trên thiết bị (bản thử nghiệm)',
    userAgent: `ARGOLET ${Platform.OS}`,
    // Try-out builds pass from one person to the next: signing out restores the sample data.
    freshAfterSignOut: true,
  });
}
