import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../engine';
import { joinRoom, resumeRoom } from '../net/client-session';
import { createHost } from '../net/host-session';
import { createLoopback } from '../net/loopback';
import { clearSession, KEY, loadSession, saveSession, TTL_MS } from './session';

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const S = { roomCode: '012345', pid: 'p'.repeat(20), hostPeerId: 'sokdam-012345' };

describe('세션 키', () => {
  it("키 'sokdam.session' 하나에 {roomCode, pid, hostPeerId, savedAt}", () => {
    saveSession(S, 1000);
    expect([...mem.keys()]).toEqual([KEY]);
    expect(JSON.parse(mem.get(KEY)!)).toEqual({ ...S, savedAt: 1000 });
    expect(loadSession(2000)).toEqual({ ...S, savedAt: 1000 });
  });

  it('3시간 지나면 무효·삭제, 깨진 값도 삭제', () => {
    saveSession(S, 0);
    expect(loadSession(TTL_MS - 1)).not.toBeNull();
    expect(loadSession(TTL_MS)).toBeNull();
    expect(mem.has(KEY)).toBe(false);
    mem.set(KEY, '{깨짐');
    expect(loadSession()).toBeNull();
    expect(mem.has(KEY)).toBe(false);
    clearSession();
  });

  it('localStorage 가 throw 해도 게임은 계속(저장만 실패)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => saveSession(S)).not.toThrow();
    expect(loadSession()).toBeNull();
  });
});

describe('세션 키 수명 — 학생만 저장, ended·leave 에 삭제', () => {
  const words = Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, text: `t${i}`, meaning: `m${i}`, example: `e${i}` }));
  const settings = { level: null, mode: 'A', drawSeconds: 60, review: 'manual', reviewSeconds: 5, sound: true, listSource: 'default' } as const;

  async function setup() {
    vi.useFakeTimers();
    const net = createLoopback();
    const hp = createHost({ network: net, settings, pool: words, hostName: '방장', rng: mulberry32(1) });
    await vi.advanceTimersByTimeAsync(5);
    const h = await hp;
    if (!h.ok) throw new Error(h.reason);
    expect(mem.has(KEY)).toBe(false); // 방장 기기는 저장 안 함
    const jp = joinRoom({ network: net, code: h.host.code, name: '학생' });
    await vi.advanceTimersByTimeAsync(5);
    const j = await jp;
    if (!j.ok) throw new Error(j.reason);
    expect(loadSession()).toMatchObject({ roomCode: h.host.code, pid: j.client.pid, hostPeerId: `sokdam-${h.host.code}` });
    return { net, host: h.host, client: j.client };
  }

  it('방장 ended 수신 시 삭제', async () => {
    const { host } = await setup();
    host.leave();
    await vi.advanceTimersByTimeAsync(5);
    expect(mem.has(KEY)).toBe(false);
  });

  it('이어하기 — 끊긴 뒤 저장된 키로 같은 자리 복원', async () => {
    const { net, host, client } = await setup();
    (client as any).o.redial = undefined; // 탭 닫힘 — 스스로 다시 붙지 않음
    net.cut((client as any).conn.local);
    await vi.advanceTimersByTimeAsync(5);
    expect(client.view.ended).toBe('lost');
    expect(mem.has(KEY)).toBe(true); // 본인 끊김일 수 있으니 남긴다
    const rp = resumeRoom({ network: net });
    await vi.advanceTimersByTimeAsync(5);
    const r = await rp;
    expect(r.ok && r.client.view.slot).toBe(1);
    expect(r.ok && r.client.pid).toBe(client.pid);
    const saved = loadSession()!;
    host.leave();
    await vi.advanceTimersByTimeAsync(300);
    expect(mem.has(KEY)).toBe(false); // ended 수신으로 삭제
    saveSession(saved); // 방이 사라진 뒤 남은 키
    const gone = resumeRoom({ network: net });
    await vi.advanceTimersByTimeAsync(5);
    expect(await gone).toEqual({ ok: false, reason: 'no-room' });
    expect(mem.has(KEY)).toBe(false);
  });

  it('방장이 말없이 사라지면 다시 붙어 보고 host-left + 삭제', async () => {
    const { net, host, client } = await setup();
    net.vanish(`sokdam-${host.code}`);
    clearInterval((host as any).ping);
    await vi.advanceTimersByTimeAsync(8000);
    expect(client.view.ended).toBe('host-left');
    expect(mem.has(KEY)).toBe(false);
  });

  it('방장 망 끊김(등록은 남고 P2P 두 번 안 열림) → host-left 지만 추정이라 키는 남는다', async () => {
    const { net, host, client } = await setup();
    net.freeze(`sokdam-${host.code}`);
    clearInterval((host as any).ping);
    await vi.advanceTimersByTimeAsync(28000);
    expect(client.view.ended).toBe('host-left');
    expect(mem.has(KEY)).toBe(true);
  });

  it('와이파이가 꺼진 채 이어하기를 눌러도(network) 키는 남는다', async () => {
    const { host } = await setup();
    const down = { open: () => Promise.reject(new Error('timeout')) };
    const r = await resumeRoom({ network: down });
    expect(r).toEqual({ ok: false, reason: 'network' });
    expect(mem.has(KEY)).toBe(true);
    host.leave();
  });

  it('학생 leave 시 삭제', async () => {
    const { host, client } = await setup();
    client.leave();
    expect(mem.has(KEY)).toBe(false);
    await vi.advanceTimersByTimeAsync(5);
    expect(host.view.players).toHaveLength(1);
    host.leave();
  });
});
