import type { Drawing, Stroke } from './model';
import { MODEL_H, MODEL_W } from './palette';
import { paint } from './render';

export const MAX_BYTES = 200 * 1024;
const SMALL_W = 600;
const SMALL_H = 450;

export type Encode = (w: number, h: number, mime: string, quality?: number) => Promise<Blob | null>;

/**
 * PRD §7.5: WebP 0.8; if the browser can't make WebP (null or another mime), PNG.
 * Over 200KB: WebP 0.6 → 0.4 → 600×450 @0.4; PNG only downsizes to 600×450.
 * The last attempt is returned even if still over the limit.
 */
export async function encodeWithPolicy(encode: Encode): Promise<Blob> {
  let b = await encode(MODEL_W, MODEL_H, 'image/webp', 0.8);
  if (b && b.type === 'image/webp') {
    for (const q of [0.6, 0.4]) {
      if (b.size <= MAX_BYTES) return b;
      b = (await encode(MODEL_W, MODEL_H, 'image/webp', q)) ?? b;
    }
    if (b.size <= MAX_BYTES) return b;
    return (await encode(SMALL_W, SMALL_H, 'image/webp', 0.4)) ?? b;
  }
  b = await encode(MODEL_W, MODEL_H, 'image/png');
  if (!b) throw new Error('canvas export failed');
  if (b.size <= MAX_BYTES) return b;
  return (await encode(SMALL_W, SMALL_H, 'image/png')) ?? b;
}

export function canvasEncoder(strokes: Stroke[]): Encode {
  return (w, h, mime, quality) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    paint(c.getContext('2d')!, strokes, w / MODEL_W);
    return new Promise((resolve) => c.toBlob(resolve, mime, quality));
  };
}

/** Closes any in-progress stroke first, so a deadline mid-stroke still includes it. */
export function exportDrawing(d: Drawing): Promise<Blob> {
  d.finish();
  return encodeWithPolicy(canvasEncoder(d.visible()));
}
