/**
 * Document image processing in the browser, like the scanners of banking and productivity apps:
 * finds the sheet of paper in a picture, straightens it (perspective correction) and makes it
 * read like a scan (even white background, dark text) or black and white. Everything runs on the
 * device; nothing is sent anywhere.
 */

export interface Pt {
  x: number;
  y: number;
}
/** Corners of the sheet in source pixels: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];
export type ScanFilter = 'document' | 'original' | 'bw';

const MAX_SIDE = 320;

function smallGrey(source: CanvasImageSource, width: number, height: number) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.max(8, Math.round(width * scale));
  const h = Math.max(8, Math.round(height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    g[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  return { g, w, h, sx: width / w, sy: height / h };
}

function boxBlur(src: Float32Array, w: number, h: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          s += src[yy * w + xx]!;
          n++;
        }
      out[y * w + x] = s / n;
    }
  return out;
}

function otsu(g: Float32Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of g) hist[Math.max(0, Math.min(255, Math.round(v)))]!++;
  const total = g.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
function quadArea(q: Quad): number {
  let s = 0;
  for (let i = 0; i < 4; i++) s += q[i]!.x * q[(i + 1) % 4]!.y - q[(i + 1) % 4]!.x * q[i]!.y;
  return Math.abs(s) / 2;
}

/**
 * Finds the sheet of paper: the bright region around the centre of the picture, separated from
 * the background (Otsu), reduced to its four corners. Null when no clear sheet is found or the
 * sheet already fills the picture.
 */
export function detectQuad(source: CanvasImageSource, width: number, height: number): Quad | null {
  if (!width || !height) return null;
  const { g: raw, w, h, sx, sy } = smallGrey(source, width, height);
  const g = boxBlur(boxBlur(raw, w, h), w, h);
  const t = otsu(g);
  // The sheet is the side of the threshold the centre of the picture is on.
  let bright = 0;
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++)
      if (g[(Math.floor(h / 2) + dy) * w + Math.floor(w / 2) + dx]! > t) bright++;
  const fg = (i: number) => (bright >= 25 ? g[i]! > t : g[i]! <= t);
  // Flood-fill the region holding the centre.
  const seen = new Uint8Array(w * h);
  const start = Math.floor(h / 2) * w + Math.floor(w / 2);
  if (!fg(start)) return null;
  const stack = [start];
  seen[start] = 1;
  let area = 0;
  let tl = { x: 0, y: 0, s: Infinity };
  let br = { x: 0, y: 0, s: -Infinity };
  let tr = { x: 0, y: 0, s: -Infinity };
  let bl = { x: 0, y: 0, s: Infinity };
  while (stack.length) {
    const i = stack.pop()!;
    area++;
    const x = i % w;
    const y = (i - x) / w;
    if (x + y < tl.s) tl = { x, y, s: x + y };
    if (x + y > br.s) br = { x, y, s: x + y };
    if (x - y > tr.s) tr = { x, y, s: x - y };
    if (x - y < bl.s) bl = { x, y, s: x - y };
    const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const n of next) {
      if (n < 0 || seen[n]) continue;
      seen[n] = 1;
      if (fg(n)) stack.push(n);
    }
  }
  const frame = w * h;
  if (area < frame * 0.15 || area > frame * 0.94) return null;
  const q: Quad = [tl, tr, br, bl].map((p) => ({ x: p.x, y: p.y })) as Quad;
  // A sheet: convex, sides not tiny, its outline close to the region found.
  for (let i = 0; i < 4; i++) if (cross(q[i]!, q[(i + 1) % 4]!, q[(i + 2) % 4]!) <= 0) return null;
  const minSide = Math.min(w, h) * 0.2;
  for (let i = 0; i < 4; i++) if (dist(q[i]!, q[(i + 1) % 4]!) < minSide) return null;
  const fill = area / quadArea(q);
  if (fill < 0.85 || fill > 1.12) return null;
  return q.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Quad;
}

/** Solves the 8 parameters of the projective map taking the output rectangle to the sheet. */
function homography(dst: Pt[], src: Pt[]): number[] {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = dst[i]!;
    const { x, y } = src[i]!;
    a.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    a.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[p]![c]!)) p = r;
    [a[c], a[p]] = [a[p]!, a[c]!];
    [b[c], b[p]] = [b[p]!, b[c]!];
    for (let r = c + 1; r < 8; r++) {
      const f = a[r]![c]! / a[c]![c]!;
      for (let k = c; k < 8; k++) a[r]![k]! -= f * a[c]![k]!;
      b[r]! -= f * b[c]!;
    }
  }
  const h = new Array<number>(8).fill(0);
  for (let r = 7; r >= 0; r--) {
    let s = b[r]!;
    for (let k = r + 1; k < 8; k++) s -= a[r]![k]! * h[k]!;
    h[r] = s / a[r]![r]!;
  }
  return h;
}

/** Longest side of the sheet in the picture, in pixels: how much detail its text really has. */
export const quadDetail = (q: Quad) =>
  Math.max(dist(q[0], q[1]), dist(q[3], q[2]), dist(q[0], q[3]), dist(q[1], q[2]));

/**
 * Straightens the sheet: the quadrilateral becomes an upright rectangle of the same proportions,
 * at a document size (long side between `minSide` and `maxSide`, like a 150 to 200 dpi scan).
 */
export function warpQuad(src: HTMLCanvasElement, q: Quad, minSide = 1600, maxSide = 2200): HTMLCanvasElement {
  let W = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  let H = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const long = Math.max(W, H);
  const k = long < minSide ? minSide / long : Math.min(1, maxSide / long);
  W = Math.max(16, Math.round(W * k));
  H = Math.max(16, Math.round(H * k));
  const sw = src.width;
  const sh = src.height;
  const sdata = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(W, H);
  const d = img.data;
  const m = homography(
    [
      { x: 0, y: 0 },
      { x: W - 1, y: 0 },
      { x: W - 1, y: H - 1 },
      { x: 0, y: H - 1 },
    ],
    q,
  );
  for (let v = 0; v < H; v++)
    for (let u = 0; u < W; u++) {
      const den = m[6]! * u + m[7]! * v + 1;
      const x = (m[0]! * u + m[1]! * v + m[2]!) / den;
      const y = (m[3]! * u + m[4]! * v + m[5]!) / den;
      const x0 = Math.max(0, Math.min(sw - 2, Math.floor(x)));
      const y0 = Math.max(0, Math.min(sh - 2, Math.floor(y)));
      const fx = Math.max(0, Math.min(1, x - x0));
      const fy = Math.max(0, Math.min(1, y - y0));
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const o = (v * W + u) * 4;
      for (let c = 0; c < 3; c++) {
        const top = sdata[i00 + c]! * (1 - fx) + sdata[i10 + c]! * fx;
        const bottom = sdata[i01 + c]! * (1 - fx) + sdata[i11 + c]! * fx;
        d[o + c] = top * (1 - fy) + bottom * fy;
      }
      d[o + 3] = 255;
    }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Brightness of the paper around every point (median of blocks, smoothed): shadows and uneven light. */
function paperLevel(grey: Float32Array, W: number, H: number) {
  const b = Math.max(8, Math.round(Math.max(W, H) / 40));
  const gw = Math.ceil(W / b);
  const gh = Math.ceil(H / b);
  let grid: Float32Array = new Float32Array(gw * gh);
  const sample: number[] = [];
  for (let by = 0; by < gh; by++)
    for (let bx = 0; bx < gw; bx++) {
      sample.length = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const x = Math.min(W - 1, bx * b + Math.floor(((sx + 0.5) * b) / 4));
          const y = Math.min(H - 1, by * b + Math.floor(((sy + 0.5) * b) / 4));
          sample.push(grey[y * W + x]!);
        }
      sample.sort((p, q) => p - q);
      // Paper dominates a block: the upper half of its values is the paper's brightness.
      grid[by * gw + bx] = sample[11]!;
    }
  grid = boxBlur(boxBlur(grid, gw, gh), gw, gh);
  return (x: number, y: number) => {
    const fx = Math.min(gw - 1.001, Math.max(0, x / b - 0.5));
    const fy = Math.min(gh - 1.001, Math.max(0, y / b - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const ax = fx - x0;
    const ay = fy - y0;
    const x1 = Math.min(gw - 1, x0 + 1);
    const y1 = Math.min(gh - 1, y0 + 1);
    const top = grid[y0 * gw + x0]! * (1 - ax) + grid[y0 * gw + x1]! * ax;
    const bottom = grid[y1 * gw + x0]! * (1 - ax) + grid[y1 * gw + x1]! * ax;
    return top * (1 - ay) + bottom * ay;
  };
}

/**
 * "Tài liệu": even white paper and dark text, colours kept (stamps, logos). "Đen trắng": crisp
 * black on white. "Màu gốc": unchanged.
 */
export function applyFilter(src: HTMLCanvasElement, filter: ScanFilter): HTMLCanvasElement {
  if (filter === 'original') return src;
  const W = src.width;
  const H = src.height;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const img = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H);
  const d = img.data;
  const grey = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) grey[i] = 0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!;
  const paper = paperLevel(grey, W, H);
  const black = 40;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const k = 250 / Math.max(40, paper(x, y));
      if (filter === 'bw') {
        const v = grey[i]! * k < 165 ? 0 : 255;
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
      } else if (grey[i]! * k > 212) {
        // Paper, whatever its tint or the shadow on it: plain white.
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255;
      } else {
        for (let c = 0; c < 3; c++) {
          const v = (d[i * 4 + c]! * k - black) * (255 / (255 - black));
          d[i * 4 + c] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
    }
  out.getContext('2d')!.putImageData(img, 0, 0);
  return out;
}

/** Turns the page a quarter turn clockwise, `turns` times. */
export function rotate(src: HTMLCanvasElement, turns: number): HTMLCanvasElement {
  const t = ((turns % 4) + 4) % 4;
  if (!t) return src;
  const out = document.createElement('canvas');
  out.width = t % 2 ? src.height : src.width;
  out.height = t % 2 ? src.width : src.height;
  const ctx = out.getContext('2d')!;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((t * Math.PI) / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

/** The whole picture as a quadrilateral (no cropping). */
export const fullQuad = (w: number, h: number): Quad => [
  { x: 0, y: 0 },
  { x: w - 1, y: 0 },
  { x: w - 1, y: h - 1 },
  { x: 0, y: h - 1 },
];
