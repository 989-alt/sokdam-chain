import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLoopback } from './loopback';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function pair(opts = {}) {
  const net = createLoopback(opts);
  const a = await net.open('a');
  const b = await net.open('b');
  let bConn: any;
  b.onConnection((c) => (bConn = c));
  const p = a.connect('b');
  await vi.advanceTimersByTimeAsync(1000);
  return { net, a, b, aConn: await p, bConn };
}

describe('모의 전송', () => {
  it('같은 id 두 번 열면 unavailable-id, 없는 상대는 peer-unavailable', async () => {
    const net = createLoopback();
    const a = await net.open('a');
    await expect(net.open('a')).rejects.toThrow('unavailable-id');
    const p = a.connect('zz');
    const check = expect(p).rejects.toThrow('peer-unavailable');
    await vi.advanceTimersByTimeAsync(1);
    await check;
  });

  it('지연(ms)만큼 늦게, 순서대로, JSON 왕복으로 전달', async () => {
    const { aConn, bConn } = await pair({ latencyMs: 100 });
    const got: unknown[] = [];
    bConn.onData((m: unknown) => got.push(m));
    aConn.send({ n: 1, d: new Date(0) });
    aConn.send({ n: 2 });
    await vi.advanceTimersByTimeAsync(99);
    expect(got).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toEqual([{ n: 1, d: '1970-01-01T00:00:00.000Z' }, { n: 2 }]);
  });

  it('드롭 확률', async () => {
    let i = 0;
    const { aConn, bConn } = await pair({ dropRate: 0.5, rng: () => (i++ % 2 ? 0.9 : 0.1) });
    const got: unknown[] = [];
    bConn.onData((m: unknown) => got.push(m));
    for (let k = 0; k < 10; k++) aConn.send({ k });
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toHaveLength(5);
  });

  it('cut 은 양쪽 close, mute 는 close 없이 버림', async () => {
    const { net, aConn, bConn } = await pair();
    const got: unknown[] = [];
    const closed = vi.fn();
    bConn.onData((m: unknown) => got.push(m));
    bConn.onClose(closed);
    net.mute('a', true);
    aConn.send({ x: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toEqual([]);
    expect(closed).not.toHaveBeenCalled();
    net.mute('a', false);
    net.cut('a');
    await vi.advanceTimersByTimeAsync(1);
    expect(closed).toHaveBeenCalledOnce();
  });
});
