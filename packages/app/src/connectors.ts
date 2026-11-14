/**
 * Clients for partners' APIs that ARGOLET calls (server side). Each one tests the credentials and
 * fetches new data as a verbatim snapshot (core/connectors), built from the partner's official
 * documentation:
 *
 *  - SePay API v2 — developer.sepay.vn: Bearer token, 3 requests/second per IP, HTTP 429 with
 *    Retry-After; GET /v2/transactions (per_page ≤ 100, since_id for polling with
 *    transaction_date_sort=asc, meta.pagination.has_more), GET /v2/bank-accounts.
 *  - KiotViet Public API — kiotviet.vn (mục 2.1–2.2, 2.12.1): OAuth 2.0 client credentials at
 *    https://id.kiotviet.vn/connect/token (scopes=PublicApi.Access), then "Retailer" + Bearer
 *    headers; GET /invoices (pageSize ≤ 100, currentItem, fromPurchaseDate, total).
 */
import { SNAPSHOT_FORMAT, type ConnectorProvider, type ConnectorSnapshot } from '@argolet/core';
import { AppError } from './runtime';
import type { AppDeps, HttpFetch } from './runtime';

export interface ProviderField {
  key: string;
  label: string;
  secret: boolean;
  placeholder: string;
  help: string;
}

export interface ProviderInfo {
  provider: ConnectorProvider | 'IPOS';
  kind: 'BANK' | 'POS';
  name: string;
  description: string;
  /** Where the customer finds the credentials. */
  howTo: string;
  docsUrl: string;
  fields: ProviderField[];
  /** False when the partner has no public API yet (credentials and spec come from the partner). */
  available: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    provider: 'SEPAY',
    kind: 'BANK',
    name: 'Ngân hàng qua SePay',
    description:
      'Giao dịch tiền vào / ra của các tài khoản ngân hàng đã liên kết với SePay (ACB, BIDV, MB, VPBank, Vietcombank…)',
    howTo: 'my.sepay.vn → Cấu hình Công ty → API Access → + Thêm API, sao chép API Token.',
    docsUrl: 'https://developer.sepay.vn/vi/sepay-api/v2/giao-dich/danh-sach',
    fields: [
      {
        key: 'apiToken',
        label: 'API Token',
        secret: true,
        placeholder: 'Chuỗi 64 ký tự',
        help: 'Token có toàn quyền đọc giao dịch: ARGOLET mã hóa và chỉ dùng ở máy chủ.',
      },
    ],
    available: true,
  },
  {
    provider: 'KIOTVIET',
    kind: 'POS',
    name: 'Bán hàng qua KiotViet',
    description: 'Hóa đơn bán hàng đã hoàn thành, kèm hình thức thanh toán (tiền mặt, thẻ, chuyển khoản)',
    howTo:
      'KiotViet → Thiết lập cửa hàng → Thiết lập kết nối API → Tạo mã → Lưu; tên gian hàng nằm trong đường dẫn KiotViet.',
    docsUrl: 'https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-ket-noi-api/public-api/',
    fields: [
      {
        key: 'retailer',
        label: 'Tên gian hàng (Retailer)',
        secret: false,
        placeholder: 'vd: taphoaxyz',
        help: 'Phần tên trong đường dẫn taphoaxyz.kiotviet.vn',
      },
      { key: 'clientId', label: 'Client ID', secret: true, placeholder: '', help: '' },
      { key: 'clientSecret', label: 'Mã bảo mật (Client Secret)', secret: true, placeholder: '', help: '' },
    ],
    available: true,
  },
  {
    provider: 'IPOS',
    kind: 'POS',
    name: 'Máy POS iPOS (FABi)',
    description: 'Hóa đơn bán hàng nhà hàng / cafe từ iPOS',
    howTo:
      'iPOS cấp quyền kết nối cho từng đối tác (gói iPOS DW – PARTNERS hoặc iPOS HUB API: token, brand_id, store_id) kèm tài liệu kỹ thuật. Khi có tài liệu, ARGOLET bật kết nối này.',
    docsUrl: 'https://ipos.vn/',
    fields: [],
    available: false,
  },
];

export interface ProviderCredentials {
  [key: string]: string;
}

export interface FetchResult {
  snapshot: ConnectorSnapshot;
  /** Records received from the partner. */
  fetched: number;
  nextCursor: string | null;
  requests: number;
}

const TIMEOUT_MS = 20_000;
const MAX_PAGES = 50;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

function parseJson(body: string): unknown {
  try {
    return body ? (JSON.parse(body) as unknown) : null;
  } catch {
    return null;
  }
}

/** One HTTP call with timeout, 429 retries (Retry-After) and errors a person can act on. */
class PartnerHttp {
  requests = 0;
  constructor(
    private readonly http: HttpFetch,
    private readonly name: string,
    private readonly paceMs: number,
  ) {}

  private sleep(ms: number) {
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }

  async json(
    url: string,
    init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string },
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      if (this.requests > 0) await this.sleep(this.paceMs);
      this.requests++;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let res: Awaited<ReturnType<HttpFetch>>;
      let body: string;
      try {
        res = await this.http(url, { ...init, signal: ctrl.signal });
        body = await res.text();
      } catch {
        throw new AppError('VALIDATION', `Không kết nối được tới ${this.name} (${new URL(url).host})`);
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 429 && attempt < 3) {
        // Retry-After is in seconds (SePay); wait at most 10 s, never when pacing is off (tests).
        const wait = Number(res.headers.get('retry-after') ?? '1');
        const seconds = Math.min(10, Number.isFinite(wait) ? Math.max(wait, 1) : 1);
        await this.sleep(this.paceMs > 0 ? seconds * 1000 : 0);
        continue;
      }
      const data = parseJson(body);
      if (res.status === 401 || res.status === 403)
        throw new AppError('VALIDATION', `${this.name} từ chối thông tin xác thực (sai hoặc đã bị thu hồi)`);
      if (res.status === 429)
        throw new AppError(
          'VALIDATION',
          `${this.name} đang giới hạn tần suất truy cập, hãy thử lại sau ít phút`,
        );
      if (res.status < 200 || res.status >= 300) {
        const msg = isObj(data) && typeof data.message === 'string' ? `: ${data.message.slice(0, 160)}` : '';
        throw new AppError('VALIDATION', `${this.name} trả lỗi HTTP ${res.status}${msg}`);
      }
      if (data === null) throw new AppError('VALIDATION', `${this.name} trả dữ liệu không phải JSON`);
      return data;
    }
  }
}

function required(creds: ProviderCredentials, key: string, label: string): string {
  const v = (creds[key] ?? '').trim();
  if (!v) throw new AppError('VALIDATION', `Nhập ${label}`);
  if (v.length > 400) throw new AppError('VALIDATION', `${label} quá dài`);
  return v;
}

const mask = (account: string) => (account.length > 4 ? `…${account.slice(-4)}` : account);

// ───────── SePay ─────────

async function sepayTest(deps: AppDeps, http: PartnerHttp, creds: ProviderCredentials) {
  const base = deps.connectorEndpoints.SEPAY ?? 'https://userapi.sepay.vn';
  const token = required(creds, 'apiToken', 'API Token');
  const data = await http.json(`${base}/v2/bank-accounts?per_page=100`, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (!isObj(data) || data.status !== 'success' || !Array.isArray(data.data))
    throw new AppError('VALIDATION', 'Phản hồi SePay không đúng định dạng');
  const accounts = data.data
    .filter(isObj)
    .map((a) =>
      `${String(a.bank_short_name ?? a.bank_code ?? '')} ${mask(String(a.account_number ?? ''))}`.trim(),
    );
  return accounts.length
    ? `SePay xác nhận ${accounts.length} tài khoản: ${accounts.slice(0, 5).join(', ')}`
    : 'Kết nối được SePay nhưng chưa có tài khoản ngân hàng nào được liên kết';
}

async function sepayFetch(
  deps: AppDeps,
  http: PartnerHttp,
  creds: ProviderCredentials,
  cursor: string | null,
  since: string,
): Promise<Omit<FetchResult, 'requests'>> {
  const base = deps.connectorEndpoints.SEPAY ?? 'https://userapi.sepay.vn';
  const token = required(creds, 'apiToken', 'API Token');
  const query: Record<string, string> = { transaction_date_sort: 'asc', per_page: '100' };
  if (cursor) query.since_id = cursor;
  else query.transaction_date_from = `${since} 00:00:00`;
  const pages: unknown[] = [];
  let fetched = 0;
  let last: string | null = cursor;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const qs = new URLSearchParams({ ...query, page: String(page) }).toString();
    const data = await http.json(`${base}/v2/transactions?${qs}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (!isObj(data) || data.status !== 'success' || !Array.isArray(data.data))
      throw new AppError('VALIDATION', 'Phản hồi SePay không đúng định dạng');
    pages.push(data);
    fetched += data.data.length;
    const tail = data.data[data.data.length - 1];
    if (isObj(tail) && tail.id) last = String(tail.id);
    const pg = isObj(data.meta) && isObj(data.meta.pagination) ? data.meta.pagination : null;
    if (!pg || pg.has_more !== true || data.data.length === 0) break;
  }
  return {
    snapshot: {
      format: SNAPSHOT_FORMAT,
      provider: 'SEPAY',
      resource: 'transactions',
      fetchedAt: deps.clock().toISOString(),
      query,
      pages,
    },
    fetched,
    nextCursor: last,
  };
}

// ───────── KiotViet ─────────

async function kiotToken(deps: AppDeps, http: PartnerHttp, creds: ProviderCredentials): Promise<string> {
  const url = deps.connectorEndpoints.KIOTVIET_TOKEN ?? 'https://id.kiotviet.vn/connect/token';
  const body = new URLSearchParams({
    scopes: 'PublicApi.Access',
    grant_type: 'client_credentials',
    client_id: required(creds, 'clientId', 'Client ID'),
    client_secret: required(creds, 'clientSecret', 'Mã bảo mật'),
  }).toString();
  const data = await http.json(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  if (!isObj(data) || typeof data.access_token !== 'string' || !data.access_token)
    throw new AppError('VALIDATION', 'KiotViet không cấp access token');
  return data.access_token;
}

function kiotHeaders(creds: ProviderCredentials, token: string) {
  return {
    retailer: required(creds, 'retailer', 'Tên gian hàng'),
    authorization: `Bearer ${token}`,
    accept: 'application/json',
  };
}

async function kiotTest(deps: AppDeps, http: PartnerHttp, creds: ProviderCredentials) {
  const base = deps.connectorEndpoints.KIOTVIET ?? 'https://public.kiotapi.com';
  const token = await kiotToken(deps, http, creds);
  const data = await http.json(`${base}/invoices?pageSize=1`, {
    method: 'GET',
    headers: kiotHeaders(creds, token),
  });
  if (!isObj(data) || !Array.isArray(data.data))
    throw new AppError('VALIDATION', 'Phản hồi KiotViet không đúng định dạng');
  return `KiotViet xác nhận gian hàng "${creds.retailer}" · ${Number(data.total ?? data.data.length)} hóa đơn`;
}

async function kiotFetch(
  deps: AppDeps,
  http: PartnerHttp,
  creds: ProviderCredentials,
  cursor: string | null,
  since: string,
): Promise<Omit<FetchResult, 'requests'>> {
  const base = deps.connectorEndpoints.KIOTVIET ?? 'https://public.kiotapi.com';
  const token = await kiotToken(deps, http, creds);
  const query: Record<string, string> = {
    fromPurchaseDate: cursor ?? since,
    orderBy: 'purchaseDate',
    orderDirection: 'Asc',
    includePayment: 'true',
    pageSize: '100',
  };
  const pages: unknown[] = [];
  let fetched = 0;
  let last: string | null = cursor;
  for (let page = 0, current = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({ ...query, currentItem: String(current) }).toString();
    const data = await http.json(`${base}/invoices?${qs}`, {
      method: 'GET',
      headers: kiotHeaders(creds, token),
    });
    if (!isObj(data) || !Array.isArray(data.data))
      throw new AppError('VALIDATION', 'Phản hồi KiotViet không đúng định dạng');
    pages.push(data);
    fetched += data.data.length;
    current += data.data.length;
    const tail = data.data[data.data.length - 1];
    if (isObj(tail) && typeof tail.purchaseDate === 'string') last = tail.purchaseDate;
    if (data.data.length === 0 || current >= Number(data.total ?? 0)) break;
  }
  return {
    snapshot: {
      format: SNAPSHOT_FORMAT,
      provider: 'KIOTVIET',
      resource: 'invoices',
      fetchedAt: deps.clock().toISOString(),
      query,
      pages,
    },
    fetched,
    nextCursor: last,
  };
}

// ───────── entry points ─────────

function partner(deps: AppDeps, provider: ConnectorProvider): PartnerHttp {
  if (!deps.http || !deps.secrets)
    throw new AppError(
      'VALIDATION',
      'Kết nối đối tác chạy trên máy chủ ARGOLET (cần ARGOLET_SECRET_KEY); bản chạy trong trình duyệt không lưu khóa của đối tác',
    );
  return new PartnerHttp(deps.http, provider === 'SEPAY' ? 'SePay' : 'KiotViet', deps.connectorPaceMs);
}

export async function testProvider(deps: AppDeps, provider: ConnectorProvider, creds: ProviderCredentials) {
  const http = partner(deps, provider);
  const detail =
    provider === 'SEPAY' ? await sepayTest(deps, http, creds) : await kiotTest(deps, http, creds);
  return { detail, requests: http.requests };
}

export async function fetchProvider(
  deps: AppDeps,
  provider: ConnectorProvider,
  creds: ProviderCredentials,
  cursor: string | null,
  since: string,
): Promise<FetchResult> {
  const http = partner(deps, provider);
  const r =
    provider === 'SEPAY'
      ? await sepayFetch(deps, http, creds, cursor, since)
      : await kiotFetch(deps, http, creds, cursor, since);
  return { ...r, requests: http.requests };
}
