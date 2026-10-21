// PeerJS 없이 가짜 Peer 로 시그널링 재등록 백오프만 본다. reconnect() 실패는 PeerJS 처럼 disconnected 를 다시 낸다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ peers: [] as any[] }));
vi.mock('peerjs', () => {
  class FakePeer {
    destroyed = false;
    disconnected = false;
    reconnect = vi.fn(() => void (this.disconnected = false));
    private handlers = new Map<string, ((...a: any[]) => void)[]>();
    constructor() {
      fake.peers.push(this);
    }
    on(ev: string, cb: (...a: any[]) => void) {
      this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), cb]);
      return this;
    }
    emit(ev: string, ...a: any[]) {
      for (const cb of this.handlers.get(ev) ?? []) cb(...a);
    }
    /** PeerJS: 시그널링이 끊기면 error 뒤 disconnected. */
    drop(type = 'network') {
      this.disconnected = true;
      this.emit('error', { type });
      this.emit('disconnected', 'x');
    }
    destroy() {
      this.disconnected = true;
      this.emit('disconnected', 'x'); // destroy() 도 disconnected 를 낸다
      this.destroyed = true;
    }
  }
  return { default: FakePeer };
});

import { peerNetwork } from './peer-transport';

async function opened() {
  const p = peerNetwork.open('sokdam-000000');
  const peer = fake.peers.at(-1)!;
  peer.emit('open', 'sokdam-000000');
  return { ep: await p, peer };
}

beforeEach(() => {
  vi.useFakeTimers();
  fake.peers.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('방장 peer 시그널링 재등록', () => {
  it('실패할수록 1·2·4초로 늘고, 다시 열리면 1초로, destroy 뒤엔 멈춘다', async () => {
    const { ep, peer } = await opened();
    peer.drop();
    await vi.advanceTimersByTimeAsync(999);
    expect(peer.reconnect).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(peer.reconnect).toHaveBeenCalledTimes(1);
    peer.drop(); // reconnect 실패
    await vi.advanceTimersByTimeAsync(1999);
    expect(peer.reconnect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(peer.reconnect).toHaveBeenCalledTimes(2);
    peer.drop();
    await vi.advanceTimersByTimeAsync(3999);
    expect(peer.reconnect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(peer.reconnect).toHaveBeenCalledTimes(3);
    peer.emit('open', 'sokdam-000000'); // 성공 → 간격 초기화
    peer.drop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(peer.reconnect).toHaveBeenCalledTimes(4);
    peer.drop();
    ep.destroy();
    await vi.advanceTimersByTimeAsync(120000);
    expect(peer.reconnect).toHaveBeenCalledTimes(4);
    expect(peer.destroyed).toBe(true);
  });

  it('간격은 30초를 넘지 않는다', async () => {
    const { peer } = await opened();
    peer.drop();
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(30000);
      peer.drop();
    }
    const before = peer.reconnect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(peer.reconnect).toHaveBeenCalledTimes(before + 1);
  });

  it('ID-TAKEN(unavailable-id) 이면 더 돌지 않고 onSignalingLost 로 알린다', async () => {
    const { ep, peer } = await opened();
    const lost = vi.fn();
    ep.onSignalingLost!(lost);
    peer.drop('unavailable-id');
    await vi.advanceTimersByTimeAsync(120000);
    expect(peer.reconnect).not.toHaveBeenCalled();
    expect(lost).toHaveBeenCalledOnce();
  });
});
