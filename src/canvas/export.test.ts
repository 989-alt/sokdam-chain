import { describe, expect, it } from 'vitest';
import { type Encode, MAX_BYTES, encodeWithPolicy } from './export';

type Call = [number, number, string, number | undefined];

// sizes: returns the byte size for a call, or null for a null blob; `webp` false = browser falls back to PNG
function fake(size: (c: Call) => number | null, webp = true) {
  const calls: Call[] = [];
  const encode: Encode = async (w, h, mime, q) => {
    const c: Call = [w, h, mime, q];
    calls.push(c);
    const n = size(c);
    if (n === null) return null;
    return new Blob([new Uint8Array(n)], { type: webp ? mime : 'image/png' });
  };
  return { encode, calls };
}

const big = MAX_BYTES + 1;

describe('encodeWithPolicy', () => {
  it('WebP 0.8 under the limit: one call', async () => {
    const f = fake(() => 1000);
    const b = await encodeWithPolicy(f.encode);
    expect(b.type).toBe('image/webp');
    expect(f.calls).toEqual([[800, 600, 'image/webp', 0.8]]);
  });

  it('WebP over the limit steps 0.6 then 0.4', async () => {
    const f = fake(([, , , q]) => (q === 0.4 ? 1000 : big));
    const b = await encodeWithPolicy(f.encode);
    expect(b.size).toBe(1000);
    expect(f.calls.map((c) => c[3])).toEqual([0.8, 0.6, 0.4]);
  });

  it('WebP still over at 0.4 downsizes to 600×450', async () => {
    const f = fake(([w]) => (w === 600 ? 1000 : big));
    const b = await encodeWithPolicy(f.encode);
    expect(b.size).toBe(1000);
    expect(f.calls.at(-1)).toEqual([600, 450, 'image/webp', 0.4]);
    expect(f.calls).toHaveLength(4);
  });

  it('no WebP support (PNG returned) retries as PNG', async () => {
    const f = fake(() => 1000, false);
    const b = await encodeWithPolicy(f.encode);
    expect(b.type).toBe('image/png');
    expect(f.calls[1]).toEqual([800, 600, 'image/png', undefined]);
  });

  it('null WebP blob retries as PNG', async () => {
    const f = fake(([, , m]) => (m === 'image/webp' ? null : 1000));
    const b = await encodeWithPolicy(f.encode);
    expect(b.type).toBe('image/png');
  });

  it('PNG over the limit only downsizes (no quality steps)', async () => {
    const f = fake(([w]) => (w === 600 ? 1000 : big), false);
    const b = await encodeWithPolicy(f.encode);
    expect(b.size).toBe(1000);
    expect(f.calls.slice(1)).toEqual([
      [800, 600, 'image/png', undefined],
      [600, 450, 'image/png', undefined],
    ]);
  });

  it('PNG encode failure throws', async () => {
    const f = fake(() => null);
    await expect(encodeWithPolicy(f.encode)).rejects.toThrow();
  });
});
