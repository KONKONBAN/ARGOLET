/**
 * Benchmark: how well invoice figures are read from damaged photos, before and after restoration.
 * Usage: pnpm --filter @argolet/api exec tsx scripts/bench-damaged.ts [outDir]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { fieldsFromOcrText, restoreGray, toGray, toRgba, type GrayImage } from '@argolet/core';
import { damage, type Damage } from '../../../packages/core/test/support/damage';
import { TesseractOcr } from '../src/ocr';

const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
const src = jpeg.decode(
  readFileSync(path.resolve(import.meta.dirname, '../../../e2e/fixtures/hoa-don-sua-xanh-0000777.jpg')),
  { useTArray: true },
);
const clean = toGray(src.data, src.width, src.height);
const truth = {
  total: '1650000',
  documentDate: '2026-10-29',
  taxCode: '0314222331',
  series: '1C26TSX',
  documentNo: '0000777',
};

const encode = (g: GrayImage) =>
  Buffer.from(jpeg.encode({ data: toRgba(g), width: g.width, height: g.height }, 92).data);

const cases: [string, Damage][] = [
  ['nhan-nhe', { seed: 1, crumple: 0.5, shade: 0.4, skew: 1.5 }],
  ['nhan-nang', { seed: 2, crumple: 1, shade: 0.6, skew: -2.5, noise: 6 }],
  ['uot', { seed: 3, wet: 3, fade: 0.2, shade: 0.3 }],
  ['uot-mo', { seed: 4, wet: 4, fade: 0.45, blur: 2, noise: 5 }],
  ['phai-mau', { seed: 5, fade: 0.7, noise: 8, shade: 0.5 }],
  ['nhoe', { seed: 6, blur: 3, noise: 4, crumple: 0.3 }],
  ['tat-ca', { seed: 7, crumple: 0.9, wet: 3, fade: 0.5, blur: 2, noise: 7, shade: 0.6, skew: 2 }],
];

const ocr = new TesseractOcr();
const score = (text: string) => {
  const f = fieldsFromOcrText(text) as unknown as Record<string, string | undefined>;
  return Object.entries(truth)
    .filter(([k, v]) => f[k]?.replace(/\D/g, '') === v.replace(/\D/g, '') || f[k] === v)
    .map(([k]) => k);
};
let before = 0;
let after = 0;
for (const [name, d] of cases) {
  const bad = damage(clean, d);
  const t0 = Date.now();
  const r = restoreGray(bad);
  const ms = Date.now() - t0;
  const a = await ocr.read(encode(bad), 60_000);
  const b = await ocr.read(encode(r.binary), 60_000);
  const c = await ocr.read(encode(r.enhanced), 60_000);
  const sa = score(a?.text ?? '');
  const sb = score(b?.text ?? '');
  const sc = score(c?.text ?? '');
  const best = sb.length >= sc.length ? sb : sc;
  before += sa.length;
  after += best.length;
  console.info(
    `${name.padEnd(10)} restore ${ms}ms skew ${r.skew} warp ${r.warp} scale ${r.scale} contrast ${r.contrast} | goc ${sa.length}/5 [${sa}] (${Math.round((a?.confidence ?? 0) * 100)}%) | den-trang ${sb.length}/5 [${sb}] (${Math.round((b?.confidence ?? 0) * 100)}%) | xam ${sc.length}/5 [${sc}] (${Math.round((c?.confidence ?? 0) * 100)}%)`,
  );
  if (out) {
    writeFileSync(path.join(out, `${name}-0-hong.jpg`), encode(bad));
    writeFileSync(path.join(out, `${name}-1-phuc-hoi.jpg`), encode(r.enhanced));
    writeFileSync(path.join(out, `${name}-2-den-trang.jpg`), encode(r.binary));
  }
}
console.info(`Truong doc dung: truoc ${before}/${cases.length * 5}, sau ${after}/${cases.length * 5}`);
await ocr.close();
