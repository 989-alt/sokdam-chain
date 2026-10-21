import { afterEach, describe, expect, it, vi } from 'vitest';
import { Assembler, base64ToBlob, blobToBase64, CHUNK_CHARS, split } from './chunks';
import { V } from './protocol';

const data = 'iVBOR' + 'x'.repeat(CHUNK_CHARS * 3 + 17);

afterEach(() => vi.useRealTimers());

describe('분할·재조립', () => {
  it('조각 메시지는 12KB 이하', () => {
    const cs = split('img1', data);
    expect(cs).toHaveLength(4);
    for (const c of cs) expect(new TextEncoder().encode(JSON.stringify({ t: 'chunk', v: V, ...c })).length).toBeLessThanOrEqual(12 * 1024);
  });

  it('순서 뒤섞기·중복 idx 에도 한 번 완성', () => {
    const done = vi.fn();
    const a = new Assembler(done);
    const cs = split('img1', data);
    for (const c of [cs[2], cs[0], cs[2], cs[3], cs[0], cs[1]]) a.add(c);
    expect(done).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledWith('img1', data);
    a.add(cs[1]); // 완성 뒤 늦은 중복은 새 조립을 시작할 뿐 완성되지 않는다
    expect(done).toHaveBeenCalledOnce();
    a.clear();
  });

  it('10초 안에 다 못 모으면 버린다', () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const expire = vi.fn();
    const a = new Assembler(done, expire);
    const cs = split('img1', data);
    a.add(cs[0]);
    a.add(cs[1]);
    a.add(cs[3]);
    vi.advanceTimersByTime(10000);
    expect(expire).toHaveBeenCalledWith('img1');
    a.add(cs[2]); // 버린 뒤 도착한 조각으로는 완성되지 않는다
    expect(done).not.toHaveBeenCalled();
    a.clear();
  });

  it('잘못된 조각은 무시', () => {
    const done = vi.fn();
    const a = new Assembler(done);
    for (const c of [null, { imgId: 'x', idx: 1, total: 1, data: 'a' }, { imgId: 'x', idx: 0, total: 999, data: 'a' }, { imgId: 'x', idx: 0, total: 1, data: 'a'.repeat(CHUNK_CHARS + 1) }, { imgId: 'x', idx: 0, total: 1, data: '<script>' }])
      a.add(c);
    expect(done).not.toHaveBeenCalled();
    a.clear();
  });

  it('Blob ↔ base64 왕복, 형식은 머리로 판정', async () => {
    const u8 = new Uint8Array(70000).map((_, i) => i % 251);
    u8.set([0x52, 0x49, 0x46, 0x46]); // RIFF
    const b64 = await blobToBase64(new Blob([u8]));
    expect(b64.startsWith('UklGR')).toBe(true);
    const back = base64ToBlob(b64);
    expect(back.type).toBe('image/webp');
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(u8);
  });
});
