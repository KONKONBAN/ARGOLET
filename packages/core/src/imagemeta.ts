/**
 * Minimal EXIF reader for JPEG photos of documents: which camera took it, when, and which
 * software last wrote it (an editor such as Photoshop leaves its name in the "Software" tag).
 * Pure TypeScript, no dependency; unknown or malformed data yields an empty result.
 */
export interface ImageMeta {
  software?: string;
  make?: string;
  model?: string;
  takenAt?: string;
  modifiedAt?: string;
}

const TAGS: Record<number, keyof ImageMeta> = {
  0x0131: 'software',
  0x010f: 'make',
  0x0110: 'model',
  0x0132: 'modifiedAt',
  0x9003: 'takenAt',
};

export function readImageMeta(bytes: Uint8Array): ImageMeta {
  try {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return {};
    let p = 2;
    while (p + 4 < bytes.length && bytes[p] === 0xff) {
      const marker = bytes[p + 1]!;
      const len = (bytes[p + 2]! << 8) | bytes[p + 3]!;
      if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(p + 4, p + 8)) === 'Exif') {
        return readTiff(bytes.subarray(p + 10, p + 2 + len));
      }
      if (marker === 0xda) break; // start of image data: no EXIF before it
      p += 2 + len;
    }
  } catch {
    /* malformed: treat as no metadata */
  }
  return {};
}

function readTiff(t: Uint8Array): ImageMeta {
  const little = t[0] === 0x49 && t[1] === 0x49;
  const u16 = (o: number) => (little ? t[o]! | (t[o + 1]! << 8) : (t[o]! << 8) | t[o + 1]!);
  const u32 = (o: number) =>
    little
      ? (t[o]! | (t[o + 1]! << 8) | (t[o + 2]! << 16) | (t[o + 3]! << 24)) >>> 0
      : ((t[o]! << 24) | (t[o + 1]! << 16) | (t[o + 2]! << 8) | t[o + 3]!) >>> 0;
  const out: ImageMeta = {};
  const readIfd = (offset: number, depth: number) => {
    if (depth > 2 || offset + 2 > t.length) return;
    const n = u16(offset);
    for (let i = 0; i < n; i++) {
      const e = offset + 2 + i * 12;
      if (e + 12 > t.length) return;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      if (tag === 0x8769) readIfd(u32(e + 8), depth + 1); // Exif sub-IFD
      const key = TAGS[tag];
      if (key && type === 2 && count > 0) {
        const at = count <= 4 ? e + 8 : u32(e + 8);
        const raw = t.subarray(at, at + count);
        // Latin-1 by hand: TextDecoder('latin1') is not available on every runtime (Hermes).
        out[key] = String.fromCharCode(...raw)
          .replace(/\0.*$/, '')
          .trim();
      }
    }
  };
  readIfd(u32(4), 0);
  return out;
}

const EDITORS =
  /photoshop|gimp|canva|snapseed|picsart|lightroom|pixlr|fotor|meitu|affinity|paint\.net|photo ?editor|picmonkey|befunky|polarr|vsco/i;

/** The name of a photo-editing program found in the metadata, or null. */
export function editingSoftware(meta: ImageMeta | null | undefined): string | null {
  return meta?.software && EDITORS.test(meta.software) ? meta.software : null;
}
