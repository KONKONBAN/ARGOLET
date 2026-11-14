import { ApiError, HttpBackend, probeServer, type Backend } from '@argolet/client';

export { ApiError, type Backend };

/**
 * Choose the transport at start-up:
 *  1. VITE_API_URL set at build time → that API,
 *  2. the page is served by the ARGOLET API (same origin /v1/meta) → server mode,
 *  3. otherwise (static hosting, or a VITE_STATIC_DEMO=1 build) → the full application runs in the
 *     browser with demo data.
 */
export async function detectBackend(): Promise<Backend> {
  const configured = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');
  // Static hosting build (GitHub Pages): no ARGOLET server behind the page, so no probe at all.
  if (!configured && import.meta.env.VITE_STATIC_DEMO === '1') {
    const { createBrowserBackend } = await import('./browserBackend');
    return createBrowserBackend();
  }
  const base = configured ?? '';
  const info = await probeServer(base);
  if (info) return new HttpBackend({ baseUrl: base, info, auth: 'cookie' });
  if (configured) throw new ApiError('NETWORK', `Không kết nối được API tại ${configured}`, 0);
  const { createBrowserBackend } = await import('./browserBackend');
  return createBrowserBackend();
}
