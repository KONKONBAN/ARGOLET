/**
 * What the application needs to talk to the outside world when it runs on the device itself
 * (phone app, browser): calls to partners' APIs and a box for their keys and AI keys.
 */
import { AppError, type HttpFetch, type SecretBox } from '@argolet/app';

/**
 * Partners' APIs through the device's own fetch. A phone calls them directly; a browser may be
 * blocked by the partner's CORS policy, which is then said plainly instead of a vague failure.
 */
export function deviceHttp(fetchImpl: typeof fetch, where: 'phone' | 'browser'): HttpFetch {
  return async (url, init) => {
    try {
      return await fetchImpl(url, init);
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') throw e;
      const host = new URL(url).host;
      throw new AppError(
        'VALIDATION',
        where === 'browser'
          ? `Trình duyệt không cho trang web gọi thẳng tới ${host}. Hãy kết nối trong ứng dụng ARGOLET trên điện thoại, hoặc trên máy chủ ARGOLET của tổ chức.`
          : `Không kết nối được tới ${host}. Kiểm tra mạng rồi thử lại.`,
      );
    }
  };
}

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | null): Promise<void>;
}

/**
 * Keeps each secret in the device's protected storage (iOS Keychain / Android Keystore, or the
 * browser tab's session storage); the application's data holds only a reference to it.
 */
export function keyStoreBox(store: KeyValueStore, randomId: () => string): SecretBox {
  const slot = (ref: string) => `argolet_secret_${ref.slice(3)}`;
  return {
    async seal(plaintext) {
      const ref = `kb:${randomId()
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, 32)}`;
      await store.set(slot(ref), plaintext);
      return ref;
    },
    async open(sealed) {
      if (!sealed.startsWith('kb:')) throw new AppError('VALIDATION', 'Khóa đã lưu không đọc được');
      const v = await store.get(slot(sealed));
      if (v === null)
        throw new AppError('VALIDATION', 'Khóa đã lưu không còn trên thiết bị này, hãy kết nối lại');
      return v;
    },
  };
}
