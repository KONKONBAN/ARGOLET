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

/**
 * Transport selection:
 *  1. a server URL saved in settings or EXPO_PUBLIC_API_URL / app.json extra.apiUrl → that API (Bearer token),
 *  2. otherwise → the full ARGOLET application runs on the device with demo data (offline).
 */
export async function createMobileBackend(): Promise<Backend> {
  const configured =
    (await getSavedServer()) ??
    process.env.EXPO_PUBLIC_API_URL ??
    ((Constants.expoConfig?.extra as { apiUrl?: string | null } | undefined)?.apiUrl || null);
  if (configured) {
    const info = await probeServer(configured, 4000);
    if (info) return new HttpBackend({ baseUrl: configured, info, auth: tokenStore });
  }
  const { createLocalBackend } = await import('@argolet/client/local');
  return createLocalBackend({
    clockStart: Date.now(),
    tokens: { get: async () => memory.local ?? null, set: async (t) => void (memory.local = t) },
    label: configured
      ? `Không kết nối được ${configured} · đang dùng dữ liệu mẫu trên thiết bị`
      : 'Dữ liệu mẫu chạy trên thiết bị',
    userAgent: `ARGOLET ${Platform.OS}`,
  });
}
