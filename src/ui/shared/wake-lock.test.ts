import { describe, expect, it, vi } from 'vitest';
import { keepAwake } from './wake-lock';

function fakeDoc() {
  const subs = new Set<() => void>();
  return {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_: string, f: () => void) => void subs.add(f),
    removeEventListener: (_: string, f: () => void) => void subs.delete(f),
    fire() {
      for (const f of subs) f();
    },
    subs,
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('keepAwake', () => {
  it('requests screen lock, re-requests when visible again, releases on stop', async () => {
    const release = vi.fn(async () => {});
    const request = vi.fn(async () => ({ release }));
    const doc = fakeDoc();
    const stop = keepAwake({ wakeLock: { request } }, doc as never);
    await flush();
    expect(request).toHaveBeenCalledWith('screen');
    doc.visibilityState = 'hidden';
    doc.fire();
    await flush();
    expect(request).toHaveBeenCalledTimes(1); // 숨김 중엔 요청 안 함
    doc.visibilityState = 'visible';
    doc.fire();
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    stop();
    expect(release).toHaveBeenCalled();
    expect(doc.subs.size).toBe(0);
  });

  it('ignores missing API and rejected requests', async () => {
    const doc = fakeDoc();
    expect(() => keepAwake({}, doc as never)()).not.toThrow();
    const stop = keepAwake({ wakeLock: { request: () => Promise.reject(new Error('NotAllowedError')) } }, doc as never);
    await flush();
    stop();
  });

  it('releases a lock that arrives after stop', async () => {
    const release = vi.fn(async () => {});
    let resolve!: (s: { release: typeof release }) => void;
    const stop = keepAwake({ wakeLock: { request: () => new Promise((r) => (resolve = r)) } }, fakeDoc() as never);
    stop();
    resolve({ release });
    await flush();
    expect(release).toHaveBeenCalled();
  });
});
