/**
 * Damages a clean page the way real invoices arrive: crumpled (wavy lines, creases with a dark
 * side), wet (blotches where the ink ran and faded, with a tide ring), faded, out of focus, grainy
 * and slightly crooked. Deterministic for a given seed, so tests and benchmarks repeat exactly.
 */
import type { GrayImage } from '../../src/restore';

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Damage {
  seed: number;
  /** 0 to 1: how crumpled (wave amplitude and number of creases). */
  crumple?: number;
  /** Number of water blotches. */
  wet?: number;
  /** 0 to 1: how much of the ink colour is gone everywhere. */
  fade?: number;
  /** Blur radius in pixels (out of focus or ink that ran). */
  blur?: number;
  /** Standard deviation of grain. */
  noise?: number;
  /** Rotation in degrees. */
  skew?: number;
  /** 0 to 1: uneven lighting (lamp on one side, hand shadow). */
  shade?: number;
}

function boxBlurU8(src: Uint8ClampedArray | Float32Array, w: number, h: number, r: number): Float32Array {
  const a = Float32Array.from(src);
  if (r < 1) return a;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += a[y * w + Math.min(w - 1, Math.max(0, k))]!;
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / n;
      s += a[y * w + Math.min(w - 1, x + r + 1)]! - a[y * w + Math.max(0, x - r)]!;
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

export function damage(src: GrayImage, d: Damage): GrayImage {
  const { width: w, height: h } = src;
  const rand = rng(d.seed);
  const crumple = d.crumple ?? 0;
  const scale = Math.min(w, h) / 1240;

  // Geometry: smooth waves plus creases (a step in height across each fold line).
  const waves = Array.from({ length: Math.round(2 + 4 * crumple) }, () => ({
    ax: (2 + 10 * rand()) * crumple * scale,
    ay: (3 + 12 * rand()) * crumple * scale,
    kx: (2 * Math.PI) / ((250 + 600 * rand()) * scale),
    ky: (2 * Math.PI) / ((250 + 600 * rand()) * scale),
    px: rand() * 6.3,
    py: rand() * 6.3,
  }));
  const creases = Array.from({ length: Math.round(5 * crumple) }, () => {
    const t = rand() * Math.PI;
    return {
      nx: Math.cos(t),
      ny: Math.sin(t),
      c: (rand() * w * 0.8 + w * 0.1) * Math.cos(t) + (rand() * h * 0.8 + h * 0.1) * Math.sin(t),
      step: (rand() - 0.5) * 14 * crumple * scale,
      width: (20 + 40 * rand()) * scale,
      shade: (0.08 + 0.17 * rand()) * crumple,
    };
  });
  const skew = ((d.skew ?? 0) * Math.PI) / 180;
  const cos = Math.cos(skew);
  const sin = Math.sin(skew);
  const geo = new Float32Array(w * h);
  const shading = new Float32Array(w * h).fill(1);
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let dx = 0;
      let dy = 0;
      let sh = 1;
      for (const v of waves) {
        dy += v.ay * Math.sin(x * v.kx + v.px) * Math.cos(y * v.ky * 0.5 + v.py);
        dx += v.ax * 0.3 * Math.sin(y * v.ky + v.py);
      }
      for (const c of creases) {
        const dist = x * c.nx + y * c.ny - c.c;
        dy += c.step * Math.tanh(dist / c.width) * c.ny;
        dx += c.step * Math.tanh(dist / c.width) * c.nx * 0.5;
        // One side of the fold faces away from the light; a thin bright ridge on the edge.
        sh *=
          1 -
          c.shade * (dist > 0 ? Math.exp(-dist / (c.width * 4)) : 0) +
          0.06 * Math.exp(-((dist / 3) ** 2));
      }
      // Rotation about the centre, then the warp.
      const rx = cos * (x - cx) - sin * (y - cy) + cx + dx;
      const ry = sin * (x - cx) + cos * (y - cy) + cy + dy;
      const x0 = Math.floor(rx);
      const y0 = Math.floor(ry);
      let v = 245;
      if (x0 >= 0 && y0 >= 0 && x0 < w - 1 && y0 < h - 1) {
        const tx = rx - x0;
        const ty = ry - y0;
        const i = y0 * w + x0;
        v =
          (src.data[i]! * (1 - tx) + src.data[i + 1]! * tx) * (1 - ty) +
          (src.data[i + w]! * (1 - tx) + src.data[i + w + 1]! * tx) * ty;
      }
      geo[y * w + x] = v;
      shading[y * w + x] = sh;
    }

  // Ink faded everywhere.
  const fade = d.fade ?? 0;
  for (let i = 0; i < geo.length; i++) geo[i] = 255 - (255 - geo[i]!) * (1 - fade);

  // Water: blotches where the ink ran (blurred, much paler) with a darker tide ring.
  const blotches = Array.from({ length: d.wet ?? 0 }, () => ({
    x: rand() * w,
    y: rand() * h,
    r: (90 + 160 * rand()) * scale,
    wob: rand() * 6.3,
  }));
  if (blotches.length) {
    const ran = boxBlurU8(geo, w, h, Math.max(2, Math.round(3 * scale)));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let inside = 0;
        let ring = 0;
        for (const b of blotches) {
          const a = Math.atan2(y - b.y, x - b.x);
          const r = b.r * (1 + 0.18 * Math.sin(3 * a + b.wob) + 0.08 * Math.sin(7 * a + 2 * b.wob));
          const dist = Math.hypot(x - b.x, y - b.y);
          if (dist < r) inside = Math.max(inside, Math.min(1, (r - dist) / (12 * scale)));
          ring = Math.max(ring, Math.exp(-(((dist - r) / (5 * scale)) ** 2)));
        }
        const i = y * w + x;
        if (inside > 0) {
          const ink = 255 - ran[i]!;
          geo[i] = geo[i]! * (1 - inside) + (255 - ink * 0.42) * 0.9 * inside;
        }
        geo[i] = geo[i]! * (1 - 0.18 * ring);
      }
  }

  // Uneven light: brighter on one side, a soft shadow across a corner.
  const shade = d.shade ?? 0;
  const lx = rand() > 0.5 ? 1 : -1;
  const sx = rand() * w;
  const sy = rand() * h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const lamp = 1 - shade * 0.35 * (lx > 0 ? x / w : 1 - x / w);
      const hand = 1 - shade * 0.3 * Math.exp(-((Math.hypot(x - sx, y - sy) / (0.35 * Math.min(w, h))) ** 2));
      geo[i] = geo[i]! * shading[i]! * lamp * hand;
    }

  let out: Float32Array = geo;
  if (d.blur) out = boxBlurU8(boxBlurU8(out, w, h, d.blur), w, h, Math.max(1, Math.round(d.blur / 2)));
  const noise = d.noise ?? 0;
  const data = new Uint8ClampedArray(w * h);
  for (let i = 0; i < data.length; i++) {
    // Box-Muller grain.
    const n = noise ? Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand()) * noise : 0;
    data[i] = out[i]! + n;
  }
  return { width: w, height: h, data };
}
