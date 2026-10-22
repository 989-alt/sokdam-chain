import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mulberry32, type Game } from '../engine';
import { joinRoom } from '../net/client-session';
import { createHost } from '../net/host-session';
import { createLoopback } from '../net/loopback';
import type { Network } from '../net/transport';
import { loadSession } from '../storage/session';
import { resumeFailMessage } from '../ui/shared/messages';
import { settingsSummary } from '../ui/lobby/labels';
import { categoryOf } from '../net/protocol';
import { resume, RESUME_TIMEOUT_MS } from './connect';
import { encodeList } from '../teacher/list';
import { parseRoute } from './router';
import { readTeacherHash } from './teacher-state';

// 세션 키 저장소를 메모리로 바꾼다(node 에는 브라우저 저장소가 없다)
let saved: object | null = null;
vi.mock('../storage/session', () => ({
  saveSession: (s: object) => void (saved = s),
  loadSession: () => saved,
  clearSession: () => void (saved = null),
}));

describe('router', () => {
  it('parses named routes; anything else is home', () => {
    expect(parseRoute('#/create')).toBe('create');
    expect(parseRoute('#/room')).toBe('room');
    expect(parseRoute('')).toBe('home');
    expect(parseRoute('#/nope')).toBe('home');
    expect(parseRoute('#l=abc')).toBe('home');
  });
});

describe('teacher hash', () => {
  it('ignores non-list hashes, reads valid list, reports broken one', () => {
    expect(readTeacherHash('#/create')).toBeNull();
    const enc = encodeList('only', [{ t: '가는 말이 고와야 오는 말이 곱다', m: '내가 잘해야 남도 잘한다', e: '' }]);
    if (!enc.ok) throw new Error('encode');
    expect(readTeacherHash(enc.hash)).toEqual({ list: { mode: 'only', items: [{ t: '가는 말이 고와야 오는 말이 곱다', m: '내가 잘해야 남도 잘한다', e: '' }] } });
    expect(readTeacherHash('#l=%%%')).toHaveProperty('error');
  });
});

describe('이어하기 늦은 성공', () => {
  beforeEach(() => {
    saved = null;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('상한(20초) 뒤에 붙으면 연결만 닫고 세션 키는 남긴다, 안내는 코드 확인이 아님', async () => {
    const net = createLoopback();
    const flush = (ms = 5) => vi.advanceTimersByTimeAsync(ms);
    const settings = { level: null, mode: 'A', drawSeconds: 60, review: 'manual', reviewSeconds: 5, sound: true, listSource: 'default' } as const;
    const words = Array.from({ length: 30 }, (_, i) => ({ id: `w${i}`, text: `원문${i}`, meaning: `뜻${i}`, example: `예${i}`, level: 'e34' as const, type: '속담' as const }));
    const hp = createHost({ network: net, settings, pool: words, hostName: '방장', rng: mulberry32(1) });
    await flush();
    const h = await hp;
    if (!h.ok) throw new Error(h.reason);
    const jp = joinRoom({ network: net, code: h.host.code, name: '민수' });
    await flush();
    const j = await jp;
    if (!j.ok) throw new Error(j.reason);
    j.client.close();
    expect(loadSession()).not.toBeNull();
    const slow: Network = {
      open: async (id) => {
        const ep = await net.open(id);
        return { ...ep, connect: (p, t) => new Promise((r) => setTimeout(r, 21000)).then(() => ep.connect(p, t)) };
      },
    };
    const rp = resume(slow);
    await flush(RESUME_TIMEOUT_MS - 100);
    let r: Awaited<typeof rp> | null = null;
    void rp.then((x) => (r = x));
    await flush(0);
    expect(r).toBeNull(); // 8초 상한이면 여기서 이미 timeout
    await flush(200);
    expect(r).toEqual({ ok: false, reason: 'timeout' });
    expect(resumeFailMessage('timeout')).not.toContain('코드');
    await flush(2000); // 늦은 성공 → close
    expect(loadSession()).not.toBeNull();
    h.host.leave();
  });
});

describe('category 없는 settings(옛 방장, 프로토콜 v 그대로)', () => {
  beforeEach(() => {
    saved = null;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('학생이 joined 로 받아도 요약·안내가 깨지지 않고 속담으로 본다', async () => {
    const net = createLoopback();
    const flush = (ms = 5) => vi.advanceTimersByTimeAsync(ms);
    const settings = { level: 'e56', mode: 'A', drawSeconds: 60, review: 'manual', reviewSeconds: 5, sound: false, listSource: 'default' } as const;
    const words = Array.from({ length: 30 }, (_, i) => ({ id: `w${i}`, text: `원문${i}`, meaning: `뜻${i}`, example: `예${i}`, level: 'e56' as const, type: '관용표현' as const }));
    const hp = createHost({ network: net, settings, pool: words, hostName: '방장', rng: mulberry32(1) });
    await flush();
    const h = await hp;
    if (!h.ok) throw new Error(h.reason);
    const jp = joinRoom({ network: net, code: h.host.code, name: '민수' });
    await flush();
    const j = await jp;
    if (!j.ok) throw new Error(j.reason);
    const got = j.client.view.settings!;
    expect(got).not.toHaveProperty('category');
    expect(categoryOf(got)).toBe('속담');
    expect(settingsSummary(got, false)).toEqual(['속담', '초등 5~6', '글자로 시작', '그리기 60초', '방장이 넘김']);
    h.host.leave();
  });
});

describe('온라인 묶음 경로(loopback)', () => {
  beforeEach(() => {
    saved = null;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('방장 category 관용표현 + 속담 섞인 pool → 모든 체인 제시어가 관용표현, 학생 settings 도 관용표현', async () => {
    const net = createLoopback();
    const flush = (ms = 5) => vi.advanceTimersByTimeAsync(ms);
    const settings = { category: '관용표현', level: 'e34', mode: 'A', drawSeconds: 60, review: 'manual', reviewSeconds: 5, sound: false, listSource: 'default' } as const;
    const mk = (type: '관용표현' | '속담', i: number) => ({ id: `${type === '속담' ? 'pv' : 'id'}-${i}`, text: `${type}${i}`, meaning: `뜻${type}${i}`, example: `예${i}`, level: 'e34' as const, type });
    const pool = Array.from({ length: 12 }, (_, i) => mk(i % 2 ? '속담' : '관용표현', i));
    const hp = createHost({ network: net, settings, pool, hostName: '방장', rng: mulberry32(3) });
    await flush();
    const h = await hp;
    if (!h.ok) throw new Error(h.reason);
    const clients = [];
    for (const name of ['민수', '지우', '하준']) {
      const jp = joinRoom({ network: net, code: h.host.code, name });
      await flush();
      const j = await jp;
      if (!j.ok) throw new Error(j.reason);
      clients.push(j.client);
    }
    expect(h.host.start()).toEqual({ ok: true });
    await flush(20);
    const game = (h.host as unknown as { game: Game }).game;
    expect(game.chains).toHaveLength(4);
    expect(game.chains.every((c) => c.word.type === '관용표현')).toBe(true);
    for (const c of clients) {
      expect(categoryOf(c.view.settings!)).toBe('관용표현');
      expect(c.view.cell?.input.text).toMatch(/^관용표현\d+$/); // 0단계 A — 학생이 받은 제시어도 관용표현
    }
    h.host.leave();
  });
});
