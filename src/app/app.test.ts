import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../engine';
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
