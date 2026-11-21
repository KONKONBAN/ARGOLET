/**
 * Restoring a photographed document before it is read. Real invoices arrive crumpled, folded,
 * damp or faded, photographed under a lamp: the characters are all there, but shading, stains and
 * wavy lines hide them from character recognition. Each step undoes one kind of damage:
 *
 *  1. Paper level: the brightness of bare paper is estimated across the page (a high percentile in
 *     each small cell, spread over cells covered by print) and divided out. Shadows of the hand,
 *     the darker side of every crease and the brown ring of a water stain vanish; the print stays.
 *  2. Speckle from wet or grainy paper is removed (3 x 3 median).
 *  3. Faded ink: the darkest print is stretched back to near black, bare paper to white.
 *  4. Skew: the angle at which the text lines are straightest (projection profile) is undone.
 *  5. Wavy lines from wrinkles: the page is cut into vertical strips; the text-line profile of each
 *     strip is matched against its neighbour band by band (normalised cross-correlation, limited to
 *     less than half a line so a line cannot jump to the next), and every strip is shifted back.
 *  6. Small print is enlarged to the size character recognition reads best (about 48 px per line).
 *  7. Black-and-white for character recognition: Sauvola's local threshold, which keeps faint
 *     strokes next to dark ones and does not turn left-over stains into blots.
 *
 * Everything works on plain arrays (no canvas, no native code): the same code runs on the server,
 * in the browser and in tests.
 */

export interface GrayImage {
  width: number;
  height: number;
  /** One byte per pixel, 0 = black, 255 = white, row by row. */
  data: Uint8ClampedArray;
}

export interface Restored {
  /** Flattened, contrast-restored, straightened grey page (for people and vision models). */
  enhanced: GrayImage;
  /** Black-and-white page for character recognition. */
  binary: GrayImage;
  /** Skew corrected, in degrees (positive: the text rose to the right). */
  skew: number;
  /** Largest vertical displacement of a text line straightened, in pixels of the result. */
  warp: number;
  /** Enlargement applied for small print (1 when none). */
  scale: number;
  /** Separation between print and paper before restoration (0 to 255): low means faded or blurred. */
  contrast: number;
  /** Distance between text lines in the result, in pixels (0 when no lines were found). */
  linePitch: number;
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function grayImage(width: number, height: number, fill = 255): GrayImage {
  return { width, height, data: new Uint8ClampedArray(width * height).fill(fill) };
}

/**
 * Grey from RGBA (4 bytes per pixel). Weighted towards red: black and blue ink stay dark, while red
 * stamps and yellow-brown water stains (which absorb blue light) move closer to the paper.
 */
export function toGray(rgba: ArrayLike<number>, width: number, height: number): GrayImage {
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4)
    out[i] = 0.5 * rgba[j]! + 0.4 * rgba[j + 1]! + 0.1 * rgba[j + 2]!;
  return { width, height, data: out };
}

/** RGBA (opaque) from grey, for encoders that expect four channels. */
export function toRgba(g: GrayImage): Uint8ClampedArray {
  const out = new Uint8ClampedArray(g.width * g.height * 4);
  for (let i = 0, j = 0; i < g.data.length; i++, j += 4) {
    const v = g.data[i]!;
    out[j] = v;
    out[j + 1] = v;
    out[j + 2] = v;
    out[j + 3] = 255;
  }
  return out;
}

/** Bilinear resize. */
export function resize(g: GrayImage, width: number, height: number): GrayImage {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const out = new Uint8ClampedArray(w * h);
  const sx = g.width / w;
  const sy = g.height / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(g.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(g.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(g.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(g.width - 1, x0 + 1);
      const tx = fx - x0;
      const a = g.data[y0 * g.width + x0]!;
      const b = g.data[y0 * g.width + x1]!;
      const c = g.data[y1 * g.width + x0]!;
      const d = g.data[y1 * g.width + x1]!;
      out[y * w + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return { width: w, height: h, data: out };
}

/** Area-average reduction, for large photos (avoids the aliasing of bilinear sampling). */
export function shrink(g: GrayImage, factor: number): GrayImage {
  const f = Math.max(1, Math.floor(factor));
  if (f === 1) return g;
  const w = Math.max(1, Math.floor(g.width / f));
  const h = Math.max(1, Math.floor(g.height / f));
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * g.width + x * f;
        for (let dx = 0; dx < f; dx++) s += g.data[row + dx]!;
      }
      out[y * w + x] = s / (f * f);
    }
  return { width: w, height: h, data: out };
}

/** Separable box blur with running sums (edges clamp). */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src.slice();
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[row + Math.min(w - 1, Math.max(0, k))]!;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / n;
      s += src[row + Math.min(w - 1, x + r + 1)]! - src[row + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
  return out;
}

const floats = (g: GrayImage) => Float32Array.from(g.data);

interface PaperGrid {
  gw: number;
  gh: number;
  cell: number;
  v: Float32Array;
}

/** Brightness of bare paper on a coarse grid (see step 1 above). */
export function paperGrid(g: GrayImage): PaperGrid {
  const { width: w, height: h } = g;
  const cell = Math.max(8, Math.round(Math.min(w, h) / 90));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  let v = new Float32Array(gw * gh);
  const hist = new Uint32Array(256);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      hist.fill(0);
      const x0 = gx * cell;
      const y0 = gy * cell;
      const x1 = Math.min(w, x0 + cell);
      const y1 = Math.min(h, y0 + cell);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[g.data[y * w + x]!]!++;
      // The 85th percentile: above the print (rarely more than 40 % of a cell), below glints.
      const target = Math.floor((x1 - x0) * (y1 - y0) * 0.85);
      let acc = 0;
      let level = 255;
      for (let i = 0; i < 256; i++) {
        acc += hist[i]!;
        if (acc > target) {
          level = i;
          break;
        }
      }
      v[gy * gw + gx] = level;
    }
  // Closing (largest, then smallest, of the neighbours, twice each): cells fully covered by print
  // (bold headings, filled boxes, QR codes) take the paper of their neighbours, while the sharp
  // edge between the lit and the shaded side of a crease stays where it is.
  const morph = (src: Float32Array, pick: (a: number, b: number) => number) => {
    const next = new Float32Array(src.length);
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        let m = src[gy * gw + gx]!;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const yy = gy + dy;
            const xx = gx + dx;
            if (yy >= 0 && xx >= 0 && yy < gh && xx < gw) m = pick(m, src[yy * gw + xx]!);
          }
        next[gy * gw + gx] = m;
      }
    return next;
  };
  v = morph(morph(v, Math.max), Math.max);
  v = morph(morph(v, Math.min), Math.min);
  return { gw, gh, cell, v };
}

/** Divides out the paper level: shading, creases and stain rings disappear, print stays. */
export function flatten(g: GrayImage, grid: PaperGrid = paperGrid(g)): GrayImage {
  const { width: w, height: h } = g;
  const { gw, gh, cell, v } = grid;
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cell - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = fx - x0;
      const bg =
        (v[y0 * gw + x0]! * (1 - tx) + v[y0 * gw + x1]! * tx) * (1 - ty) +
        (v[y1 * gw + x0]! * (1 - tx) + v[y1 * gw + x1]! * tx) * ty;
      out[y * w + x] = (g.data[y * w + x]! * 255) / Math.max(24, bg);
    }
  }
  return { width: w, height: h, data: out };
}

/** 3 x 3 median: removes speckle from wet or grainy paper, keeps strokes 2 px and wider. */
export function median3(g: GrayImage): GrayImage {
  const { width: w, height: h } = g;
  const out = new Uint8ClampedArray(g.data);
  const p = new Array<number>(9);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const row = (y + dy) * w + x;
        p[k++] = g.data[row - 1]!;
        p[k++] = g.data[row]!;
        p[k++] = g.data[row + 1]!;
      }
      p.sort((a, b) => a - b);
      out[y * w + x] = p[4]!;
    }
  return { width: w, height: h, data: out };
}

function percentile(g: GrayImage, q: number): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.data.length; i++) hist[g.data[i]!]!++;
  const target = Math.floor(g.data.length * q);
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i]!;
    if (acc > target) return i;
  }
  return 255;
}

/**
 * Brings faded print back to near black and paper to white. The darkest print is measured cell by
 * cell, so a pale patch (where water ran or a thermal print faded) is stretched more than crisp
 * print elsewhere; never by more than twice the page's own contrast, so bare paper and stain rings
 * do not turn into blots. Returns the separation found between print and paper (0 to 255) as a
 * measure of how readable the page was.
 */
export function stretchInk(g: GrayImage): { image: GrayImage; contrast: number } {
  const { width: w, height: h } = g;
  const globalInk = percentile(g, 0.015);
  const paper = percentile(g, 0.6);
  const contrast = paper - globalInk;
  if (contrast < 12) return { image: g, contrast };
  const cell = Math.max(12, Math.round(Math.min(w, h) / 45));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const ink = new Float32Array(gw * gh);
  const has = new Float32Array(gw * gh);
  const hist = new Uint32Array(256);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      hist.fill(0);
      const x0 = gx * cell;
      const y0 = gy * cell;
      const x1 = Math.min(w, x0 + cell);
      const y1 = Math.min(h, y0 + cell);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[g.data[y * w + x]!]!++;
      const target = Math.floor((x1 - x0) * (y1 - y0) * 0.03);
      let acc = 0;
      let level = 255;
      for (let i = 0; i < 256; i++) {
        acc += hist[i]!;
        if (acc > target) {
          level = i;
          break;
        }
      }
      // A cell holds print when its darkest pixels stand clearly apart from the paper.
      if (paper - level > 0.25 * contrast) {
        ink[gy * gw + gx] = level;
        has[gy * gw + gx] = 1;
      }
    }
  // Spread the ink level of printed cells over their surroundings (normalised averaging).
  let num: Float32Array = new Float32Array(gw * gh);
  let den: Float32Array = new Float32Array(gw * gh);
  for (let i = 0; i < num.length; i++) {
    num[i] = ink[i]! * has[i]!;
    den[i] = has[i]!;
  }
  for (let pass = 0; pass < 3; pass++) {
    num = boxBlur(num, gw, gh, 1);
    den = boxBlur(den, gw, gh, 1);
  }
  const local = new Float32Array(gw * gh);
  const maxSpan = contrast;
  const minSpan = Math.max(20, 0.5 * contrast);
  for (let i = 0; i < local.length; i++) {
    const level = den[i]! > 1e-3 ? num[i]! / den[i]! : globalInk;
    local[i] = Math.min(maxSpan, Math.max(minSpan, paper - level));
  }
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cell - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = fx - x0;
      const span =
        (local[y0 * gw + x0]! * (1 - tx) + local[y0 * gw + x1]! * tx) * (1 - ty) +
        (local[y1 * gw + x0]! * (1 - tx) + local[y1 * gw + x1]! * tx) * ty;
      out[y * w + x] = ((g.data[y * w + x]! - (paper - span)) / span) * 255;
    }
  }
  return { image: { width: w, height: h, data: out }, contrast };
}

/** Unsharp mask: brings back the edges of slightly blurred strokes. */
export function sharpen(g: GrayImage, amount = 0.8, radius = 1): GrayImage {
  const f = floats(g);
  const b = boxBlur(f, g.width, g.height, radius);
  const out = new Uint8ClampedArray(f.length);
  for (let i = 0; i < f.length; i++) out[i] = clamp255(f[i]! + amount * (f[i]! - b[i]!));
  return { width: g.width, height: g.height, data: out };
}

/**
 * Sauvola's adaptive threshold: a pixel is print when darker than m * (1 + k (s / 128 - 1)), where
 * m and s are the mean and standard deviation around it. Print is 0, paper 255.
 */
export function sauvola(g: GrayImage, radius?: number, k = 0.3): GrayImage {
  const { width: w, height: h } = g;
  const r = radius ?? Math.max(10, Math.round(Math.min(w, h) / 50));
  const f = floats(g);
  const sq = new Float32Array(f.length);
  for (let i = 0; i < f.length; i++) sq[i] = f[i]! * f[i]!;
  const mean = boxBlur(f, w, h, r);
  const meanSq = boxBlur(sq, w, h, r);
  const out = new Uint8ClampedArray(f.length);
  for (let i = 0; i < f.length; i++) {
    const m = mean[i]!;
    const s = Math.sqrt(Math.max(0, meanSq[i]! - m * m));
    out[i] = f[i]! < m * (1 + k * (s / 128 - 1)) ? 0 : 255;
  }
  return { width: w, height: h, data: out };
}

/** Print pixels (value < 128) as coordinates, on a reduced copy for speed. */
function inkPoints(bin: GrayImage, maxWidth: number): { xs: Float32Array; ys: Float32Array; s: number } {
  const s = Math.max(1, Math.ceil(bin.width / maxWidth));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < bin.height; y += s)
    for (let x = 0; x < bin.width; x += s)
      if (bin.data[y * bin.width + x]! < 128) {
        xs.push(x);
        ys.push(y);
      }
  return { xs: Float32Array.from(xs), ys: Float32Array.from(ys), s };
}

/** Angle (degrees) at which the text lines are straightest: maximum variance of the row profile. */
export function skewAngle(bin: GrayImage, maxDegrees = 8): number {
  const { xs, ys, s } = inkPoints(bin, 700);
  if (xs.length < 200) return 0;
  const rows = Math.ceil(Math.hypot(bin.width, bin.height) / s) + 2;
  const hist = new Float32Array(rows);
  const score = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    hist.fill(0);
    const off = rows / 2;
    for (let i = 0; i < xs.length; i++) {
      const r = Math.round((ys[i]! * cos - xs[i]! * sin) / s + off - bin.height / (2 * s));
      if (r >= 0 && r < rows) hist[r]!++;
    }
    let t = 0;
    for (let i = 0; i < rows; i++) t += hist[i]! * hist[i]!;
    return t;
  };
  let best = 0;
  let bestScore = score(0);
  for (let d = -maxDegrees; d <= maxDegrees + 1e-9; d += 0.5) {
    const v = score(d);
    if (v > bestScore) [best, bestScore] = [d, v];
  }
  const coarse = best;
  for (let d = coarse - 0.5; d <= coarse + 0.5 + 1e-9; d += 0.05) {
    const v = score(d);
    if (v > bestScore) [best, bestScore] = [d, v];
  }
  return Math.round(best * 100) / 100;
}

/** Rotates by `degrees` (counter-clockwise for positive values) about the centre; fills with paper. */
export function rotate(g: GrayImage, degrees: number): GrayImage {
  const { width: w, height: h } = g;
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // Inverse mapping: where in the source this output pixel comes from.
      const dx = x - cx;
      const dy = y - cy;
      const sx = cos * dx - sin * dy + cx;
      const sy = sin * dx + cos * dy + cy;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) {
        out[y * w + x] = 255;
        continue;
      }
      const tx = sx - x0;
      const ty = sy - y0;
      const i = y0 * w + x0;
      out[y * w + x] =
        (g.data[i]! * (1 - tx) + g.data[i + 1]! * tx) * (1 - ty) +
        (g.data[i + w]! * (1 - tx) + g.data[i + w + 1]! * tx) * ty;
    }
  return { width: w, height: h, data: out };
}

/** Ink per row of a black-and-white page. */
function rowProfile(bin: GrayImage, x0 = 0, x1 = bin.width): Float32Array {
  const p = new Float32Array(bin.height);
  for (let y = 0; y < bin.height; y++) {
    let n = 0;
    const row = y * bin.width;
    for (let x = x0; x < x1; x++) if (bin.data[row + x]! < 128) n++;
    p[y] = n;
  }
  return p;
}

/**
 * Distance between text lines (pixels) from the autocorrelation of the row profile, or 0 when the
 * page shows no regular lines.
 */
export function linePitch(bin: GrayImage): number {
  const p = rowProfile(bin);
  const n = p.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += p[i]!;
  mean /= n;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = p[i]! - mean;
  const ac = (lag: number) => {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += c[i]! * c[i + lag]!;
    return s / (n - lag);
  };
  const zero = ac(0);
  if (zero <= 0) return 0;
  const minLag = Math.max(6, Math.round(n / 400));
  const maxLag = Math.min(Math.round(n / 4), 400);
  let best = 0;
  const minPeak = 0.12 * zero;
  let prev = ac(minLag - 1);
  let cur = ac(minLag);
  for (let lag = minLag; lag < maxLag; lag++) {
    const next = ac(lag + 1);
    // The first clear peak is the line spacing (later peaks are its multiples).
    if (cur > prev && cur >= next && cur > minPeak) {
      best = lag;
      break;
    }
    prev = cur;
    cur = next;
  }
  return best;
}

export interface LineWarp {
  strips: number;
  bands: number;
  stripWidth: number;
  bandStep: number;
  bandStart: number;
  /** Vertical displacement (pixels) per strip and band, strip-major. */
  shift: Float32Array;
  max: number;
}

function ncc(a: Float32Array, b: Float32Array, y0: number, y1: number, lag: number): number {
  let sa = 0;
  let sb = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    const yb = y + lag;
    if (yb < 0 || yb >= b.length) continue;
    sa += a[y]!;
    sb += b[yb]!;
    n++;
  }
  if (n < 4) return 0;
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let y = y0; y < y1; y++) {
    const yb = y + lag;
    if (yb < 0 || yb >= b.length) continue;
    const u = a[y]! - ma;
    const v = b[yb]! - mb;
    num += u * v;
    da += u * u;
    db += v * v;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

function smooth1(p: Float32Array, r: number): Float32Array {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) {
    let s = 0;
    let n = 0;
    for (let k = -r; k <= r; k++) {
      const j = i + k;
      if (j >= 0 && j < p.length) {
        s += p[j]!;
        n++;
      }
    }
    out[i] = s / n;
  }
  return out;
}

/** Measures how far each part of every text line drifted up or down (see step 5 above). */
export function measureLineWarp(bin: GrayImage, pitch = linePitch(bin)): LineWarp | null {
  if (pitch < 8) return null;
  const { width: w, height: h } = bin;
  const strips = Math.min(24, Math.max(4, Math.round(w / (3 * pitch))));
  const stripWidth = w / strips;
  const profiles: Float32Array[] = [];
  for (let s = 0; s < strips; s++)
    profiles.push(
      smooth1(
        rowProfile(bin, Math.round(s * stripWidth), Math.round((s + 1) * stripWidth)),
        Math.max(1, Math.round(pitch / 10)),
      ),
    );
  const bandStep = Math.max(8, Math.round(1.5 * pitch));
  const half = Math.round(1.5 * pitch);
  const bandStart = Math.round(bandStep / 2);
  const bands = Math.max(1, Math.ceil((h - bandStart) / bandStep));
  const maxLag = Math.max(2, Math.floor(0.4 * pitch));
  // delta[s][b]: displacement of strip s+1 relative to strip s in band b (NaN when unknown).
  const delta = new Float32Array((strips - 1) * bands).fill(Number.NaN);
  for (let s = 0; s + 1 < strips; s++) {
    const a = profiles[s]!;
    const b = profiles[s + 1]!;
    for (let k = 0; k < bands; k++) {
      const yc = bandStart + k * bandStep;
      const y0 = Math.max(0, yc - half);
      const y1 = Math.min(h, yc + half);
      let inkA = 0;
      let inkB = 0;
      for (let y = y0; y < y1; y++) {
        inkA += a[y]!;
        inkB += b[y]!;
      }
      // Bare paper in either strip: nothing to match.
      if (inkA < (y1 - y0) * stripWidth * 0.01 || inkB < (y1 - y0) * stripWidth * 0.01) continue;
      // Very different amounts of print (a QR code or stamp beside text): not the same lines.
      if (Math.max(inkA, inkB) > 3 * Math.min(inkA, inkB)) continue;
      // A small preference for no shift: neighbouring strips that print different words on the
      // same lines must not be "straightened" into each other.
      let best = 0;
      let bestV = -1;
      let bestScore = -Infinity;
      for (let lag = -maxLag; lag <= maxLag; lag++) {
        const v = ncc(a, b, y0, y1, lag);
        const score = v - (0.1 * Math.abs(lag)) / maxLag;
        if (score > bestScore) [best, bestV, bestScore] = [lag, v, score];
      }
      if (bestV < 0.6) continue;
      // A real displacement matches closely, or clearly better than none; strips printing
      // different things (a QR code beside text) do neither.
      if (best !== 0 && bestV < 0.85 && bestV - ncc(a, b, y0, y1, 0) < 0.08) continue;
      // Sub-pixel peak (parabola through the neighbours).
      const vm = ncc(a, b, y0, y1, best - 1);
      const vp = ncc(a, b, y0, y1, best + 1);
      const den = vm - 2 * bestV + vp;
      const sub = den < 0 ? (0.5 * (vm - vp)) / den : 0;
      delta[s * bands + k] = best + Math.max(-0.5, Math.min(0.5, sub));
    }
  }
  // Integrate outwards from the strip with the most print.
  let ref = 0;
  let refInk = -1;
  for (let s = 0; s < strips; s++) {
    let t = 0;
    for (let y = 0; y < h; y++) t += profiles[s]![y]!;
    if (t > refInk) [ref, refInk] = [s, t];
  }
  const shift = new Float32Array(strips * bands);
  for (let k = 0; k < bands; k++) {
    for (let s = ref + 1; s < strips; s++) {
      const d = delta[(s - 1) * bands + k]!;
      shift[s * bands + k] = shift[(s - 1) * bands + k]! + (Number.isNaN(d) ? 0 : d);
    }
    for (let s = ref - 1; s >= 0; s--) {
      const d = delta[s * bands + k]!;
      shift[s * bands + k] = shift[(s + 1) * bands + k]! - (Number.isNaN(d) ? 0 : d);
    }
  }
  // Smooth along the bands (wrinkles bend lines gradually) and remove the mean (no global move).
  const out = new Float32Array(shift.length);
  for (let s = 0; s < strips; s++) {
    const col = new Float32Array(bands);
    for (let k = 0; k < bands; k++) col[k] = shift[s * bands + k]!;
    const sm = smooth1(col, 1);
    for (let k = 0; k < bands; k++) out[s * bands + k] = sm[k]!;
  }
  let mean = 0;
  for (let i = 0; i < out.length; i++) mean += out[i]!;
  mean /= out.length;
  // Displacements smaller than about a sixteenth of a line are measurement noise.
  const dead = 0.06 * pitch;
  let max = 0;
  for (let i = 0; i < out.length; i++) {
    const v = out[i]! - mean;
    out[i] = Math.abs(v) < dead ? 0 : v;
    max = Math.max(max, Math.abs(out[i]!));
  }
  return { strips, bands, stripWidth, bandStep, bandStart, shift: out, max };
}

/** Shifts every part of the page back so the text lines run straight. */
export function applyLineWarp(g: GrayImage, warp: LineWarp): GrayImage {
  const { width: w, height: h } = g;
  const { strips, bands, stripWidth, bandStep, bandStart, shift } = warp;
  const out = new Uint8ClampedArray(w * h);
  const at = (s: number, k: number) => shift[s * bands + k]!;
  for (let x = 0; x < w; x++) {
    const fs = Math.min(strips - 1, Math.max(0, (x + 0.5) / stripWidth - 0.5));
    const s0 = Math.floor(fs);
    const s1 = Math.min(strips - 1, s0 + 1);
    const ts = fs - s0;
    for (let y = 0; y < h; y++) {
      const fk = Math.min(bands - 1, Math.max(0, (y - bandStart) / bandStep));
      const k0 = Math.floor(fk);
      const k1 = Math.min(bands - 1, k0 + 1);
      const tk = fk - k0;
      const d =
        (at(s0, k0) * (1 - ts) + at(s1, k0) * ts) * (1 - tk) + (at(s0, k1) * (1 - ts) + at(s1, k1) * ts) * tk;
      const sy = y + d;
      const y0 = Math.floor(sy);
      if (y0 < 0 || y0 >= h - 1) {
        out[y * w + x] = 255;
        continue;
      }
      const t = sy - y0;
      out[y * w + x] = g.data[y0 * w + x]! * (1 - t) + g.data[(y0 + 1) * w + x]! * t;
    }
  }
  return { width: w, height: h, data: out };
}

/** Text lines are read best around this spacing (capital letters about 25 to 30 px tall). */
const IDEAL_PITCH = 48;

/**
 * The whole restoration (steps 1 to 7). `maxSide` caps the working size of very large photos;
 * small print is still enlarged afterwards when needed.
 */
export function restoreForReading(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  opts: { maxSide?: number } = {},
): Restored {
  return restoreGray(toGray(rgba, width, height), opts);
}

export function restoreGray(source: GrayImage, opts: { maxSide?: number } = {}): Restored {
  const maxSide = opts.maxSide ?? 3200;
  let g = source;
  const long = Math.max(g.width, g.height);
  if (long > maxSide) g = shrink(g, Math.ceil(long / maxSide));

  const flat = median3(flatten(g));
  const { image: stretched, contrast } = stretchInk(flat);
  let page = stretched;

  let bin = sauvola(page);
  const skew = skewAngle(bin);
  if (Math.abs(skew) >= 0.15) {
    page = rotate(page, skew);
    bin = sauvola(page);
  }

  let pitch = linePitch(bin);
  let warp = 0;
  // A strip can only be matched to less than half a line away from its neighbour, so strong
  // waves are straightened in a few passes.
  for (let pass = 0; pass < 3 && pitch > 0; pass++) {
    const lw = measureLineWarp(bin, pitch);
    if (!lw || lw.max < 1.5) break;
    page = applyLineWarp(page, lw);
    bin = sauvola(page);
    warp += lw.max;
  }

  let scale = 1;
  if (pitch > 0 && pitch < IDEAL_PITCH * 0.75) {
    scale = Math.min(2, IDEAL_PITCH / pitch);
    // Never beyond what a vision model or OCR can use (about 4000 px on the long side).
    scale = Math.min(scale, 4000 / Math.max(page.width, page.height));
    if (scale > 1.1) {
      page = resize(page, page.width * scale, page.height * scale);
      pitch = Math.round(pitch * scale);
      warp *= scale;
    } else scale = 1;
  }

  const enhanced = sharpen(page, 0.6, 1);
  const binary = sauvola(enhanced);
  return {
    enhanced,
    binary,
    skew,
    warp: Math.round(warp * 10) / 10,
    scale: Math.round(scale * 100) / 100,
    contrast,
    linePitch: pitch,
  };
}
