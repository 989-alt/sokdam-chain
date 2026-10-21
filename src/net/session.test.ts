import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mulberry32, type Word } from '../engine';
import { ClientSession, joinRoom } from './client-session';
import { createHost, type HostSession } from './host-session';
import { createLoopback, type Loopback } from './loopback';
import { hostPeerId, randomId } from './peer-id';
import { V, type Settings } from './protocol';
import type { Conn, Network } from './transport';

const WORDS: Word[] = Array.from({ length: 30 }, (_, i) => ({
  id: `w${i}`,
  text: `원문${i}호`,
  meaning: `뜻풀이${i}호`,
  example: `예문${i}`,
  level: 'e34',
}));
const BASE: Settings = { level: null, mode: 'A', drawSeconds: 60, review: 'manual', reviewSeconds: 5, sound: true, listSource: 'default' };
// PNG 머리 바이트를 가진 작은 그림
const png = (size = 64) => {
  const u8 = new Uint8Array(size);
  u8.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Blob([u8], { type: 'image/png' });
};

const flush = (ms = 5) => vi.advanceTimersByTimeAsync(ms);

type Room = { net: Loopback; host: HostSession; all: ClientSession[]; got: Map<ClientSession, any[]> };

/** 받은 메시지 기록(테스트 전용으로 비공개 apply 를 감싼다). */
function record(c: ClientSession, got: Map<ClientSession, any[]>) {
  const list: any[] = [];
  got.set(c, list);
  const anyc = c as any;
  const orig = anyc.apply.bind(c);
  anyc.apply = (m: any) => {
    list.push(m);
    orig(m);
  };
}

async function room(n: number, settings: Partial<Settings> = {}, now?: () => number, net: Loopback = createLoopback()): Promise<Room> {
  const p = createHost({ network: net, settings: { ...BASE, ...settings }, pool: WORDS, hostName: '방장', rng: mulberry32(7), now });
  await flush();
  const r = await p;
  if (!r.ok) throw new Error(r.reason);
  const got = new Map<ClientSession, any[]>();
  record(r.me, got);
  const all = [r.me];
  for (let i = 1; i < n; i++) {
    const j = joinRoom({ network: net, code: r.host.code, name: `학생${i}` });
    await flush();
    const jr = await j;
    if (!jr.ok) throw new Error(jr.reason);
    record(jr.client, got);
    all.push(jr.client);
  }
  return { net, host: r.host, all, got };
}

/** 프로토콜을 직접 말하는 가짜 학생. */
async function raw(net: Network, code: string) {
  const ep = await net.open(randomId());
  const p = ep.connect(hostPeerId(code));
  await flush();
  const conn: Conn = await p;
  const got: any[] = [];
  let closed = false;
  conn.onData((m) => got.push(m));
  conn.onClose(() => (closed = true));
  return { ep, conn, got, send: (m: object) => conn.send({ v: V, ...m }), closed: () => closed };
}

/** 탭 닫힘 흉내 — 스스로 다시 붙지 못하게 하고 연결을 끊는다. */
function closeTab(net: Loopback, c: ClientSession) {
  (c as any).o.redial = undefined;
  net.cut((c as any).conn.local);
}

/** 같은 pid 로 다시 붙는 학생(이어하기). */
async function reconnect(net: Network, code: string, pid: string) {
  const ep = await net.open(randomId());
  const p = ep.connect(hostPeerId(code));
  await flush();
  const c = new ClientSession(await p, { pid });
  const r = c.rejoin();
  await flush();
  return { c, r: await r };
}

async function submitAll(cs: ClientSession[], skip: ClientSession[] = []) {
  for (const c of cs) {
    if (skip.includes(c) || !c.view.cell || c.view.submitted || c.view.ended) continue;
    if (c.view.cell.kind === 'draw') await c.submitDrawing(png());
    else c.submitGuess('답이에요');
  }
  await flush(20);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('방 만들기', () => {
  it('unavailable-id 두 번 뒤 세 번째 코드로 등록', async () => {
    const net = createLoopback();
    const ids: string[] = [];
    const flaky: Network = {
      open: (id) => {
        ids.push(id);
        return ids.length <= 2 ? Promise.reject(new Error('unavailable-id')) : net.open(id);
      },
    };
    const p = createHost({ network: flaky, settings: BASE, pool: WORDS, hostName: '방장' });
    await flush();
    const r = await p;
    expect(r.ok).toBe(true);
    expect(ids).toHaveLength(3);
    for (const id of ids) expect(id).toMatch(/^sokdam-\d{6}$/);
    if (r.ok) expect(hostPeerId(r.host.code)).toBe(ids[2]);
  });

  it('다섯 번 모두 실패하면 ok:false', async () => {
    let n = 0;
    const bad: Network = { open: () => (n++, Promise.reject(new Error('unavailable-id'))) };
    const r = await createHost({ network: bad, settings: BASE, pool: WORDS, hostName: '방장' });
    expect(r).toEqual({ ok: false, reason: 'unavailable-id' });
    expect(n).toBe(5);
  });
});

describe('입장', () => {
  it('7번째 join 은 full', async () => {
    const { net, host } = await room(6);
    const s = await raw(net, host.code);
    s.send({ t: 'join', pid: randomId(), name: '일곱' });
    await flush();
    expect(s.got.at(-1)).toMatchObject({ t: 'rejected', reason: 'full' });
    host.leave();
  });

  it('시작한 뒤 모르는 pid 의 join 은 started', async () => {
    const { net, host } = await room(4);
    expect(host.start().ok).toBe(true);
    const s = await raw(net, host.code);
    s.send({ t: 'join', pid: randomId(), name: '늦둥이' });
    await flush();
    expect(s.got.at(-1)).toMatchObject({ t: 'rejected', reason: 'started' });
    host.leave();
  });

  it('v 불일치는 version', async () => {
    const { net, host } = await room(2);
    const s = await raw(net, host.code);
    s.conn.send({ t: 'join', v: 2, pid: randomId(), name: '옛버전' });
    await flush();
    expect(s.got.at(-1)).toMatchObject({ t: 'rejected', reason: 'version' });
    host.leave();
  });

  it('같은 이름은 (2), (3)', async () => {
    const { net, host } = await room(1);
    for (let i = 0; i < 3; i++) {
      const j = joinRoom({ network: net, code: host.code, name: '민수' });
      await flush();
      await j;
    }
    expect(host.view.players.map((p) => p.name)).toEqual(['방장', '민수', '민수 (2)', '민수 (3)']);
    host.leave();
  });

  it('이름 금지어는 방장이 가려서 lobby 로 보낸다', async () => {
    const { net, host, all, got } = await room(1);
    const s = await raw(net, host.code);
    s.send({ t: 'join', pid: randomId(), name: '바보민수' });
    await flush();
    const lobby = got.get(all[0]!)!.filter((m) => m.t === 'lobby').at(-1);
    expect(lobby.players[1].name).toBe('●●민수');
    expect(JSON.stringify(s.got)).not.toContain('바보');
    host.leave();
  });

  it('학생 peer ID 와 pid 는 무작위 16자 이상, 방 코드 없음', () => {
    const id = randomId();
    expect(id).toMatch(/^[a-z0-9]{16,}$/);
  });
});

describe('재접속', () => {
  it('아는 pid 면 slot 복원 + sync(현재 차례·기한)', async () => {
    const { net, host, all } = await room(4);
    host.start();
    await flush();
    const c = all[2]!;
    const before = c.view.cell!;
    closeTab(net, c);
    await flush();
    expect(host.view.players[2]!.connected).toBe(false);
    const { c: back, r } = await reconnect(net, host.code, c.pid);
    expect(r.ok).toBe(true);
    expect(back.view.slot).toBe(2);
    expect(back.view.phase).toBe('play');
    expect(back.view.cell).toEqual(before);
    expect(host.view.players[2]!.connected).toBe(true);
    host.leave();
  });

  it('모르는 pid 는 unknown', async () => {
    const { net, host } = await room(2);
    const { r } = await reconnect(net, host.code, randomId());
    expect(r).toEqual({ ok: false, reason: 'unknown' });
    host.leave();
  });

  it('ended 면 ended', async () => {
    const { net, host, all } = await room(2);
    const pid = all[1]!.pid;
    host.leave();
    const s = await raw(net, host.code); // 방장 정리(200ms) 전
    s.send({ t: 'rejoin', pid });
    await flush();
    expect(s.got.at(-1)).toMatchObject({ t: 'rejected', reason: 'ended' });
  });

  it('같은 pid 연결이 둘이면 새 연결 채택, 옛 연결 닫음', async () => {
    const { net, host, all } = await room(3);
    const old = all[1]!;
    const { c: fresh, r } = await reconnect(net, host.code, old.pid);
    expect(r.ok).toBe(true);
    await flush();
    expect(old.view.phase).toBe('ended'); // 옛 연결은 replaced 를 받고 닫혔다 — 다시 붙어 자리를 뺏지 않는다
    expect(old.view.reconnecting).toBe(false);
    expect(host.view.players).toHaveLength(3);
    expect(host.view.players[1]!.connected).toBe(true);
    await flush(7000);
    expect(host.view.players[1]!.connected).toBe(true); // 새 연결이 pong 한다
    expect(fresh.view.ended).toBe(null);
    host.leave();
  });
});

describe('끊김 감지', () => {
  it('방장: pong 5초 무응답이면 connected:false 로 lobby 송출', async () => {
    const { net, host, all, got } = await room(3);
    net.mute((all[1] as any).conn.local, true);
    await flush(4000);
    expect(host.view.players[1]!.connected).toBe(true);
    await flush(2500);
    expect(host.view.players[1]!.connected).toBe(false);
    expect(got.get(all[0]!)!.filter((m) => m.t === 'lobby').at(-1).players[1].connected).toBe(false);
    net.mute((all[1] as any).conn.local, false);
    await flush(1500);
    expect(host.view.players[1]!.connected).toBe(true);
    host.leave();
  });

  it('학생: ping 10초 무수신 → 다시 붙기, 방장이 계속 말없으면(멈춘 탭) 시도 3번 뒤 lost', async () => {
    const { net, host, all } = await room(2);
    const lost = vi.fn();
    all[1]!.onHostLost = lost;
    net.mute(hostPeerId(host.code), true);
    await flush(9000);
    expect(all[1]!.view.reconnecting).toBe(false);
    await flush(2500);
    expect(lost).not.toHaveBeenCalled(); // 2초 확인: 방장 peer 는 있다 → 10초 규칙. 붙기는 되지만 답이 없다
    await flush(40000);
    expect(lost).toHaveBeenCalledOnce();
    expect(all[1]!.view.ended).toBe('lost');
    host.leave();
  });

  it('학생: 연결만 끊기고 방장이 살아 있으면 스스로 다시 붙어 같은 자리로', async () => {
    const { net, host, all } = await room(4);
    host.start();
    await flush();
    const c = all[1]!;
    const lost = vi.fn();
    c.onHostLost = lost;
    const cell = c.view.cell;
    net.cut((c as any).conn.local);
    await flush(20);
    expect(lost).not.toHaveBeenCalled();
    expect(c.view.ended).toBe(null);
    expect(c.view.reconnecting).toBe(false);
    expect(c.view.cell).toEqual(cell);
    expect(host.view.players[1]!.connected).toBe(true);
    await c.submitDrawing(png());
    await flush(20);
    expect(host.view.submitted).toBe(1);
    host.leave();
  });

  it('방장 망 끊김·잠듦(등록은 남고 응답 없음) → 확인·다시 붙기 두 번 unreachable 이면 18초 안에 host-left', async () => {
    for (const offset of [0, 500, 999]) {
      const { net, host, all } = await room(3);
      await flush(offset);
      net.freeze(hostPeerId(host.code));
      clearInterval((host as any).ping);
      await flush(15000);
      expect(all[1]!.view.phase).not.toBe('ended');
      await flush(3000);
      expect(all.slice(1).map((c) => c.view.ended)).toEqual(['host-left', 'host-left']);
      vi.clearAllTimers();
    }
  });

  it('다시 붙는 중 leave 는 닫힌 연결로 보내지 않고 끝내며, 더 붙지 않는다', async () => {
    const { net, host, all } = await room(3);
    const c = all[1]!;
    net.freeze(hostPeerId(host.code));
    await flush(11500);
    expect(c.view.reconnecting).toBe(true);
    const sent = vi.spyOn((c as any).conn, 'send');
    c.leave();
    expect(sent).not.toHaveBeenCalled();
    expect(c.view.ended).toBe('left');
    await flush(30000);
    expect(c.view.ended).toBe('left');
    vi.clearAllTimers();
  });

  it('PeerServer 처럼 없는 peer 답이 6초 걸려도 방장 증발 뒤 9.5초 안에 host-left', async () => {
    for (const offset of [0, 300, 999]) {
      const net = createLoopback({ unavailableMs: 6000 });
      const { host, all } = await room(3, {}, undefined, net);
      await flush(offset);
      net.vanish(hostPeerId(host.code));
      clearInterval((host as any).ping);
      await flush(6900);
      expect(all[1]!.view.phase).not.toBe('ended');
      await flush(2600);
      expect(all.slice(1).map((c) => c.view.ended)).toEqual(['host-left', 'host-left']);
      vi.clearAllTimers();
    }
  });

  it('방장이 말없이 사라지면(종료 이벤트 없음) 2초 침묵 뒤 확인해 host-left', async () => {
    const { net, host, all } = await room(3);
    const lost = vi.fn();
    all[1]!.onHostLost = lost;
    await flush(700); // ping 주기 어디서든
    net.vanish(hostPeerId(host.code));
    clearInterval((host as any).ping);
    await flush(1000);
    expect(all[1]!.view.phase).not.toBe('ended');
    await flush(3200);
    expect(all.slice(1).map((c) => c.view.ended)).toEqual(['host-left', 'host-left']);
    expect(lost).toHaveBeenCalledOnce();
  });

  it('내 망이 끊기면(시그널링 안 됨) 다시 붙기 실패 → lost 유지, 망이 돌아오면 그 전에 붙는다', async () => {
    const net = createLoopback();
    let down = false;
    const mine: Network = { open: (id) => (down ? Promise.reject(new Error('network')) : net.open(id)) };
    const r = await room(2, {}, undefined, net);
    const jp = joinRoom({ network: mine, code: r.host.code, name: '와이파이' });
    await flush();
    const j = await jp;
    if (!j.ok) throw new Error(j.reason);
    const c = j.client;
    down = true;
    net.mute((c as any).conn.local, true);
    await flush(11000);
    expect(c.view.reconnecting).toBe(true);
    await flush(1000);
    down = false; // 두 번째 시도(3초 뒤) 전에 망 복귀
    net.mute((c as any).conn.local, false);
    await flush(3000);
    expect(c.view.reconnecting).toBe(false);
    expect(c.view.ended).toBe(null);
    expect(r.host.view.players[2]!.connected).toBe(true);
    down = true;
    net.mute((c as any).conn.local, true);
    await flush(11000 + 3000 * 3);
    expect(c.view.ended).toBe('lost');
    r.host.leave();
  });

  it('첫 연결이 열리기 전에 실패해도(connect-failed) 한 번 더 시도해 입장', async () => {
    const net = createLoopback();
    const r = await room(1, {}, undefined, net);
    let n = 0;
    const flaky: Network = {
      open: async (id) => {
        const ep = await net.open(id);
        return { ...ep, id: ep.id, onConnection: ep.onConnection, destroy: ep.destroy, connect: (peer) => (n++ ? ep.connect(peer) : Promise.reject(new Error('connect-failed'))) };
      },
    };
    const jp = joinRoom({ network: flaky, code: r.host.code, name: '두번' });
    await flush(20);
    expect((await jp).ok).toBe(true);
    expect(n).toBe(2);
    r.host.leave();
  });

  it('입장 중 채널이 한 번 끊겨도 join 을 다시 보내 그대로 입장', async () => {
    const net = createLoopback();
    const r = await room(1, {}, undefined, net);
    let first = true;
    const flaky: Network = {
      open: async (id) => {
        const ep = await net.open(id);
        return {
          ...ep,
          id: ep.id,
          onConnection: ep.onConnection,
          destroy: ep.destroy,
          connect: async (peer) => {
            const c = await ep.connect(peer);
            if (!first) return c;
            first = false;
            setTimeout(() => c.close(), 5); // 핸드셰이크 직후 닫힘, join 은 닿지 않음
            return { ...c, peer: c.peer, close: () => c.close(), onData: (f) => c.onData(f), onClose: (f) => c.onClose(f), send: () => {} };
          },
        };
      },
    };
    const jp = joinRoom({ network: flaky, code: r.host.code, name: '재시도' });
    await flush(50);
    const j = await jp;
    expect(j.ok).toBe(true);
    expect(r.host.view.players.map((p) => p.name)).toEqual(['방장', '재시도']);
    expect(j.ok && j.client.view.phase).toBe('lobby');
    r.host.leave();
  });
});

describe('그리기 기한', () => {
  it('기한+1초 도착분은 done, 기한+3초에 나머지는 missing', async () => {
    const { host, all } = await room(4, { drawSeconds: 30 });
    host.start();
    await flush();
    const auto = vi.fn();
    all[1]!.onAutoSubmit = auto;
    await flush(30000);
    expect(auto).toHaveBeenCalledOnce(); // 학생 기기 기한 콜백
    await flush(1000);
    await all[1]!.submitDrawing(png());
    await flush(20);
    expect(host.view.submitted).toBe(1);
    expect(host.view.step).toBe(0);
    await flush(2100);
    expect(host.view.step).toBe(1);
    const g = (host as any).game;
    const s0 = g.chains.map((c: any) => c.entries[0]);
    expect(s0.filter((e: any) => e.status === 'done').map((e: any) => e.bySlot)).toEqual([1]);
    expect(s0.filter((e: any) => e.status === 'missing')).toHaveLength(3);
    host.leave();
  });

  it('모두 일찍 제출하면 즉시 다음 단계, step 은 자기 몫만', async () => {
    const { host, all, got } = await room(4, { mode: 'A' });
    host.start();
    await flush();
    await submitAll(all);
    expect(host.view.step).toBe(1);
    const g = (host as any).game;
    all.forEach((c, slot) => {
      const msgs = JSON.stringify(got.get(c));
      const own = g.chains.find((ch: any) => ch.startSlot === slot).word;
      expect(msgs).toContain(own.text);
      for (const w of WORDS) if (w.id !== own.id) expect(msgs).not.toContain(w.text);
      expect(msgs).not.toContain('뜻풀이');
      const steps = got.get(c)!.filter((m) => m.t === 'step');
      expect(steps.every((m) => Object.keys(m).sort().join() === 'chainIdx,deadlineAt,hostNow,input,kind,step,t,v')).toBe(true);
    });
    host.leave();
  });
});

describe('끊긴 학생 60초', () => {
  async function toGuessStep() {
    const r = await room(4);
    r.host.start();
    await flush();
    await submitAll(r.all);
    expect(r.host.view.step).toBe(1);
    return r;
  }
  const local = (c: ClientSession) => (c as any).conn.local as string;

  it('끊김 → 60초 뒤 답 없음', async () => {
    const { net, host, all } = await toGuessStep();
    await submitAll(all, [all[2]!]);
    closeTab(net, all[2]!);
    await flush(59000);
    expect(host.view.step).toBe(1);
    await flush(1100);
    expect(host.view.step).toBe(2);
    expect((host as any).game.chains.flatMap((c: any) => c.entries).filter((e: any) => e.status === 'missing')).toHaveLength(1);
    host.leave();
  });

  it('끊김 → 50초에 복귀하면 타이머 취소', async () => {
    const { net, host, all } = await toGuessStep();
    await submitAll(all, [all[2]!]);
    const pid = all[2]!.pid;
    closeTab(net, all[2]!);
    await flush(50000);
    const { c } = await reconnect(net, host.code, pid);
    await flush(20000);
    expect(host.view.step).toBe(1);
    c.submitGuess('늦은 답');
    await flush(20);
    expect(host.view.step).toBe(2);
    host.leave();
  });

  it('단계 전부터 끊겼으면 단계 시작부터 60초', async () => {
    const { net, host, all } = await room(4, { drawSeconds: 30 });
    host.start();
    await flush();
    closeTab(net, all[3]!);
    await submitAll(all, [all[3]!]);
    await flush(33100); // 그리기 기한+3초 → 1단계 시작
    expect(host.view.step).toBe(1);
    await submitAll(all, [all[3]!]);
    await flush(58000);
    expect(host.view.step).toBe(1);
    await flush(2100);
    expect(host.view.step).toBe(2);
    host.leave();
  });
});

describe('시계 보정', () => {
  it('방장 시계가 3초 빨라도 남은 시간은 기한 기준', async () => {
    const { host, all } = await room(4, { drawSeconds: 60 }, () => Date.now() + 3000);
    await flush(5000); // ping 몇 개로 offset 추정
    host.start();
    await flush();
    const c = all[1]!;
    expect((c as any).offsets.length).toBeGreaterThanOrEqual(5);
    expect(Math.abs(c.remainingMs()! - 60000)).toBeLessThan(50);
    await flush(10000);
    expect(Math.abs(c.remainingMs()! - 50000)).toBeLessThan(50);
    host.leave();
  });
});

describe('그림 제출', () => {
  it('256KB 초과는 too-large', async () => {
    const { host, all } = await room(4);
    host.start();
    await flush();
    await all[1]!.submitDrawing(png(257 * 1024));
    await flush(50);
    expect(all[1]!.view.submitError).toBe('too-large');
    expect(all[1]!.view.submitted).toBe(false);
    expect(host.view.submitted).toBe(0);
    await all[1]!.submitDrawing(png());
    await flush(50);
    expect(host.view.submitted).toBe(1);
    host.leave();
  });

  it('같은 칸 두 번째 제출·현재 단계 아닌 제출은 무시', async () => {
    const { net, host } = await room(3);
    const s = await raw(net, host.code);
    const pid = randomId();
    s.send({ t: 'join', pid, name: '넷째' });
    await flush();
    host.start();
    await flush();
    await (async () => {
      const step = s.got.find((m) => m.t === 'step');
      // 0단계는 그리기 — 1단계 답을 미리 보내도 무시
      s.send({ t: 'submit-guess', chainIdx: step.chainIdx, step: 1, text: '미리' });
      await flush();
      expect(host.view.submitted).toBe(0);
      const b64 = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 1, 2, 3));
      for (const id of ['a1', 'a2']) {
        s.send({ t: 'submit-draw', chainIdx: step.chainIdx, step: 0, imgId: id, mime: 'image/png', bytes: 7 });
        s.send({ t: 'chunk', imgId: id, idx: 0, total: 1, data: b64 });
      }
      await flush();
      expect(host.view.submitted).toBe(1);
      const e = (host as any).game.chains[step.chainIdx].entries[0];
      expect(e.imgId).toBe(`r1-${step.chainIdx}-0`);
    })();
    host.leave();
  });
});

describe('결과·투표·한 판 더', () => {
  async function playToReview(settings: Partial<Settings> = {}) {
    const r = await room(4, settings);
    r.host.start();
    await flush();
    for (let s = 0; s < 4; s++) await submitAll(r.all);
    return r;
  }

  it('show 전에 모든 그림 수신, 마지막 단계 preload 엔 글 없음', async () => {
    const { host, all, got } = await playToReview();
    expect(host.view.phase).toBe('review');
    for (const c of all) {
      const msgs = got.get(c)!;
      const showAt = msgs.findIndex((m) => m.t === 'show');
      const pre = msgs.findIndex((m) => m.t === 'review-preload');
      expect(pre).toBeGreaterThan(-1);
      expect(msgs[pre].pages.every((p: any) => p.kind === 'draw')).toBe(true);
      const ids = c.view.pages.filter((p) => p.kind === 'draw').map((p: any) => p.entry.imgId);
      expect(ids).toHaveLength(8);
      const chunkIds = new Set(msgs.slice(0, showAt).filter((m) => m.t === 'chunk').map((m) => m.imgId));
      for (const id of ids) expect(chunkIds.has(id)).toBe(true);
      for (const id of ids) expect(c.image(id)?.type).toBe('image/png');
      expect(c.view.pages).toHaveLength(24);
    }
    host.leave();
  });

  it('manual: next() 만 넘긴다, 학생은 스스로 안 넘김', async () => {
    const { host, all } = await playToReview({ review: 'manual' });
    await flush(30000);
    expect(all[1]!.view.page).toBe(0);
    expect(host.next()).toBe(true);
    await flush();
    expect(all.every((c) => c.view.page === 1)).toBe(true);
    host.leave();
  });

  it('timer: 방장 타이머가 show 를 올리고 끝나면 투표', async () => {
    const { host, all } = await playToReview({ review: 'timer', reviewSeconds: 3 });
    expect(host.next()).toBe(false);
    await flush(3000);
    expect(all[2]!.view.page).toBe(1);
    await flush(3000 * 23);
    expect(all[2]!.view.phase).toBe('vote');
    host.leave();
  });

  it('투표: slot 당 1회, 자기 것 무효, 전원 끝나면 vote-result', async () => {
    const { host, all } = await playToReview({ review: 'timer', reviewSeconds: 3 });
    await flush(3000 * 24);
    expect(host.view.phase).toBe('vote');
    const g = (host as any).game;
    const first = all[0]!.view.candidates!;
    expect(first.drawings.length).toBeGreaterThan(0);
    const own = g.chains[0].entries[0]; // slot 0 의 그림
    expect(first.drawings).not.toContain('0:0');
    expect(own.bySlot).toBe(0);
    all[0]!.vote('0:0', null); // 자기 것 — tally 가 무효
    all[1]!.vote('0:0', null);
    all[1]!.vote('1:0', null); // 두 번째는 무시(클라이언트에서도, 방장에서도)
    await flush();
    expect(host.view.voted).toBe(2);
    all[2]!.vote('0:0', null);
    await flush();
    expect(host.view.phase).toBe('vote');
    all[3]!.vote('1:0', null);
    await flush();
    expect(host.view.phase).toBe('vote-result');
    expect(all[3]!.view.result).toEqual({ bestDrawings: ['0:0'], bestAnswers: [] });
    host.leave();
  });

  it('끊긴 학생 투표는 60초 뒤 기권', async () => {
    const { net, host, all } = await playToReview({ review: 'timer', reviewSeconds: 3 });
    await flush(3000 * 24);
    closeTab(net, all[3]!);
    for (const c of all.slice(0, 3)) c.vote(null, null);
    await flush(59000);
    expect(host.view.phase).toBe('vote');
    await flush(1100);
    expect(host.view.phase).toBe('vote-result');
    host.leave();
  });

  it('한 판 더: 이전 판 그림·답 버림, 제시어 안 겹침, 끊긴 slot 유지', async () => {
    const { net, host, all } = await playToReview({ review: 'timer', reviewSeconds: 3 });
    await flush(3000 * 24);
    closeTab(net, all[3]!);
    for (const c of all.slice(0, 3)) c.vote(null, null);
    await flush(61000);
    const oldWords = (host as any).game.chains.map((c: any) => c.word.id);
    expect(host.again().ok).toBe(true);
    await flush();
    expect((host as any).images.size).toBe(0);
    expect((all[1] as any).images.size).toBe(0);
    expect(all[1]!.view.pages).toEqual([]);
    expect(all[1]!.view.cell?.step).toBe(0);
    const g = (host as any).game;
    expect(g.playerCount).toBe(4);
    for (const c of g.chains) expect(oldWords).not.toContain(c.word.id);
    expect(g.usedWordIds).toEqual(expect.arrayContaining(oldWords));
    const { c: back } = await reconnect(net, host.code, all[3]!.pid);
    expect(back.view.slot).toBe(3);
    expect(back.view.cell?.step).toBe(0);
    host.leave();
  });
});

describe('방장 종료', () => {
  it('leave 면 학생이 ended host-left 받고 정리', async () => {
    const { host, all } = await room(3);
    host.leave();
    await flush();
    expect(all[1]!.view.ended).toBe('host-left');
    expect(all[0]!.view.ended).toBe('host-left');
    await flush(300);
  });

  it('투표 결과 뒤 나가기는 finished', async () => {
    const { host, all } = await room(2);
    (host as any).phase = 'vote-result';
    host.leave();
    await flush();
    expect(all[1]!.view.ended).toBe('finished');
  });
});

describe('리뷰 수정 1차', () => {
  async function rawFourth() {
    const r = await room(3);
    const s = await raw(r.net, r.host.code);
    const pid = randomId();
    s.send({ t: 'join', pid, name: '넷째' });
    await flush();
    r.host.start();
    await flush();
    const step = s.got.find((m) => m.t === 'step');
    return { ...r, s, pid, step };
  }
  const b64png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6));

  it('업로드 중 끊겨 재접속하면 옛 조립을 버리고 다시 제출해 done', async () => {
    const { net, host, s, pid } = await rawFourth();
    s.send({ t: 'submit-draw', chainIdx: 3, step: 0, imgId: 'old', mime: 'image/png', bytes: 10 });
    s.send({ t: 'chunk', imgId: 'old', idx: 0, total: 2, data: b64png.slice(0, 4) });
    await flush();
    expect((host as any).incoming.size).toBe(1);
    net.cut(s.ep.id);
    await flush();
    const phases: string[] = [];
    const ep = await net.open(randomId());
    const cp = ep.connect(hostPeerId(host.code));
    await flush();
    const c = new ClientSession(await cp, { pid });
    c.subscribe((v) => phases.push(v.phase));
    const rr = c.rejoin();
    await flush();
    expect(await rr).toEqual({ ok: true });
    expect(phases).not.toContain('lobby'); // 게임 중 재접속은 대기실을 거치지 않는다
    expect(c.view.phase).toBe('play');
    expect((host as any).incoming.size).toBe(0);
    expect(c.view.submitted).toBe(false);
    await c.submitDrawing(png());
    await flush(20);
    expect(host.view.submitted).toBe(1);
    expect((host as any).game.chains[3].entries[0].status).toBe('done');
    host.leave();
  });

  it('그림이 아니면 bad-image 로 알리고 학생은 다시 제출할 수 있다', async () => {
    const { host, all } = await room(4);
    host.start();
    await flush();
    await all[1]!.submitDrawing(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
    await flush(20);
    expect(all[1]!.view.submitError).toBe('bad-image');
    expect(all[1]!.view.submitted).toBe(false);
    expect((host as any).incoming.size).toBe(0);
    await all[1]!.submitDrawing(png());
    await flush(20);
    expect(host.view.submitted).toBe(1);
    host.leave();
  });

  it('조각이 안 오거나 깨진 조각뿐이면 10초 뒤 bad-image, 받는 중 목록 비움', async () => {
    const { host, s, step } = await rawFourth();
    s.send({ t: 'submit-draw', chainIdx: step.chainIdx, step: 0, imgId: 'x1', mime: 'image/png', bytes: 10 });
    s.send({ t: 'chunk', imgId: 'x1', idx: 0, total: 1, data: '!!not-base64!!' });
    await flush(9900);
    expect(s.got.some((m) => m.t === 'rejected')).toBe(false);
    await flush(200);
    expect(s.got.filter((m) => m.t === 'rejected').at(-1)).toMatchObject({ reason: 'bad-image' });
    expect((host as any).incoming.size).toBe(0);
    host.leave();
  });

  it('같은 칸 두 번째 헤더는 앞 조립을 갈아탄다(말없이 버리지 않음)', async () => {
    const { host, s, step } = await rawFourth();
    s.send({ t: 'submit-draw', chainIdx: step.chainIdx, step: 0, imgId: 'a', mime: 'image/png', bytes: 10 });
    s.send({ t: 'submit-draw', chainIdx: step.chainIdx, step: 0, imgId: 'b', mime: 'image/png', bytes: 10 });
    s.send({ t: 'chunk', imgId: 'b', idx: 0, total: 1, data: b64png });
    await flush();
    expect(host.view.submitted).toBe(1);
    expect((host as any).incoming.size).toBe(0);
    host.leave();
  });

  it('pid 32자 초과는 거부(조각 ID 상한 64자에 맞춤)', async () => {
    const { net, host } = await room(1);
    const s = await raw(net, host.code);
    s.send({ t: 'join', pid: 'a'.repeat(33), name: '긴아이디' });
    await flush();
    expect(s.got.at(-1)).toMatchObject({ t: 'rejected', reason: 'name' });
    host.leave();
  });

  it('pagehide/beforeunload 는 leave 에서 해제', async () => {
    const add = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal('window', { addEventListener: add, removeEventListener: remove });
    const { host } = await room(1);
    expect(add.mock.calls.map((c) => c[0]).sort()).toEqual(['beforeunload', 'pagehide']);
    host.leave();
    expect(remove.mock.calls.map((c) => c[0]).sort()).toEqual(['beforeunload', 'pagehide']);
    expect(remove.mock.calls[0]![1]).toBe(add.mock.calls[0]![1]);
    vi.unstubAllGlobals();
  });
});
