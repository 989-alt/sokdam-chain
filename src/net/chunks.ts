// 이미지 분할 전송(PRD §7.5). PeerJS 내장 분할에 기대지 않고 base64 조각을 직접 나눈다.
import { MAX_IMG_BYTES, type Chunk } from './protocol';

export const CHUNK_CHARS = 12000; // base64 글자 수. 머리를 붙여도 메시지 한 개 ≤ 12KB
export const ASSEMBLE_MS = 10000;
const MAX_TOTAL = Math.ceil((MAX_IMG_BYTES * 4) / 3 / CHUNK_CHARS);

export function split(imgId: string, data: string): Chunk[] {
  const total = Math.max(1, Math.ceil(data.length / CHUNK_CHARS));
  return Array.from({ length: total }, (_, idx) => ({ imgId, idx, total, data: data.slice(idx * CHUNK_CHARS, (idx + 1) * CHUNK_CHARS) }));
}

/** base64 머리로 판정한 그림 형식. PNG·WebP 가 아니면 null(신뢰 경계). */
export const sniffMime = (b64: string): 'image/png' | 'image/webp' | null =>
  b64.startsWith('iVBOR') ? 'image/png' : b64.startsWith('UklGR') ? 'image/webp' : null;

export async function blobToBase64(blob: Blob): Promise<string> {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBlob(b64: string): Blob {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Blob([u8], { type: sniffMime(b64) ?? 'application/octet-stream' });
}

/**
 * 조각 재조립. idx 순서 무관, 중복 idx 무시, total 개가 모이면 완성.
 * 첫 조각부터 timeoutMs 안에 못 모으면 버리고 onExpire.
 */
export class Assembler {
  private parts = new Map<string, { total: number; got: Map<number, string>; timer: ReturnType<typeof setTimeout> }>();
  constructor(
    private onDone: (imgId: string, b64: string) => void,
    private onExpire: (imgId: string) => void = () => {},
    private timeoutMs = ASSEMBLE_MS,
  ) {}

  add(c: unknown): void {
    if (!isChunk(c)) return;
    let p = this.parts.get(c.imgId);
    if (!p) {
      const timer = setTimeout(() => {
        this.parts.delete(c.imgId);
        this.onExpire(c.imgId);
      }, this.timeoutMs);
      p = { total: c.total, got: new Map(), timer };
      this.parts.set(c.imgId, p);
    }
    if (c.total !== p.total || p.got.has(c.idx)) return;
    p.got.set(c.idx, c.data);
    if (p.got.size < p.total) return;
    clearTimeout(p.timer);
    this.parts.delete(c.imgId);
    this.onDone(c.imgId, Array.from({ length: p.total }, (_, i) => p.got.get(i)!).join(''));
  }

  /** 조립 하나를 버린다(재접속·교체). */
  drop(imgId: string): void {
    clearTimeout(this.parts.get(imgId)?.timer);
    this.parts.delete(imgId);
  }

  /** 진행 중인 조립을 모두 버린다(한 판 더·종료). */
  clear(): void {
    for (const p of this.parts.values()) clearTimeout(p.timer);
    this.parts.clear();
  }
}

const isChunk = (c: unknown): c is Chunk => {
  const x = c as Chunk;
  return (
    typeof x?.imgId === 'string' &&
    x.imgId.length > 0 &&
    x.imgId.length <= 64 &&
    Number.isInteger(x.total) &&
    x.total >= 1 &&
    x.total <= MAX_TOTAL &&
    Number.isInteger(x.idx) &&
    x.idx >= 0 &&
    x.idx < x.total &&
    typeof x.data === 'string' &&
    x.data.length <= CHUNK_CHARS &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(x.data)
  );
};
