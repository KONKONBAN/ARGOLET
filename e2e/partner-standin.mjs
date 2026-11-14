// Stand-in for SePay API v2 during end-to-end tests (shapes from developer.sepay.vn).
import { createServer } from 'node:http';

const PORT = Number(process.env.PARTNER_PORT ?? 4360);
export const TOKEN = 'e2e-sepay-token-0000000000000000000000000000000000000000000000AB12';
const transactions = [
  {
    id: 'e2e-tx-1',
    transaction_date: '2026-10-30 14:15:00',
    account_number: '19028745631',
    transfer_type: 'in',
    amount_in: 2350000,
    amount_out: 0,
    transaction_content: 'GRAB CHUYEN TIEN TT-3010',
    reference_number: 'FT26303E2E1',
    bank_brand_name: 'VCB',
  },
  {
    id: 'e2e-tx-2',
    transaction_date: '2026-10-31 08:05:00',
    account_number: '19028745631',
    transfer_type: 'in',
    amount_in: 845000,
    amount_out: 0,
    transaction_content: 'SHOPEEFOOD S3110',
    reference_number: 'FT26304E2E2',
    bank_brand_name: 'VCB',
  },
];

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/health') return res.end('{"ok":true}');
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.statusCode = 401;
    return res.end(
      JSON.stringify({ status: 'error', message: 'Invalid API key', error_code: 'unauthorized' }),
    );
  }
  const pagination = (n) => ({ total: n, per_page: 100, current_page: 1, last_page: 1, has_more: false });
  if (url.pathname === '/v2/bank-accounts')
    return res.end(
      JSON.stringify({
        status: 'success',
        data: [{ id: 'ba', account_number: '19028745631', bank_short_name: 'VCB' }],
        meta: { pagination: pagination(1) },
      }),
    );
  if (url.pathname === '/v2/transactions') {
    const since = url.searchParams.get('since_id');
    const list = since ? transactions.slice(transactions.findIndex((t) => t.id === since) + 1) : transactions;
    return res.end(
      JSON.stringify({ status: 'success', data: list, meta: { pagination: pagination(list.length) } }),
    );
  }
  res.statusCode = 404;
  res.end('{}');
}).listen(PORT, '127.0.0.1');
