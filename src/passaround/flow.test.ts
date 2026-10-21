import { describe, expect, it, vi } from 'vitest';
import { mulberry32, stepCount, voteCandidates } from '../engine';
import { again, current, finalNames, guardUnload, nextPage, nextSlot, reveal, start, submit, turnOrder, vote, wordSource, type Pass, type PassSettings } from './flow';

const S: PassSettings = { level: 'e34', mode: 'A', drawSeconds: 60, chainCount: 2 };
const names = (n: number) => ['가', '나', '다', '라', '마', '바'].slice(0, n);
const ok = (r: ReturnType<typeof start>): Pass => {
  if ('ok' in r) throw new Error(r.reason);
  return r;
};

/** 한 판을 끝까지(그림 imgId = 차례 번호, 답 = 'a<차례>'). */
function playAll(p: Pass): Pass {
  for (let i = 0; p.phase.kind !== 'review'; i++) {
    p = reveal(p, 0);
    const c = current(p.game)!;
    p = submit(p, c.entry.kind === 'draw' ? { imgId: `img${i}` } : { text: `a${i}` });
  }
  return p;
}

describe('차례 순서(PRD §4)', () => {
  for (let n = 3; n <= 6; n++)
    for (const chainCount of [1, 2] as const)
      it(`N=${n} 체인 ${chainCount}`, () => {
        const p = ok(start(names(n), { ...S, chainCount }, null, mulberry32(n)));
        const steps = stepCount(n);
        const b = Math.floor(n / 2);
        const aLast = (steps - 1) % n;
        const bStart = b === aLast ? (b + 1) % n : b;
        const want = [...Array(steps).keys()].map((s) => s % n);
        if (chainCount === 2) want.push(...[...Array(steps).keys()].map((s) => (bStart + s) % n));
        expect(turnOrder(p.game)).toEqual(want);
        // 바로 이어지는 두 차례는 늘 다른 사람(A 마지막 ≠ B 첫 포함)
        want.slice(1).forEach((x, i) => expect(x).not.toBe(want[i]));
      });
  it('N=3 은 A [0,1], B [2,0]', () => {
    expect(turnOrder(ok(start(names(3), S, null, mulberry32(1))).game)).toEqual([0, 1, 2, 0]);
  });
});

describe('흐름 상태 기계', () => {
  it('가림 → 그리기(기한) → 가림 → 답(무제한) … → 결과 → 투표 → 집계', () => {
    let p = ok(start(names(4), S, null, mulberry32(2)));
    expect(p.phase).toEqual({ kind: 'cover' });
    expect(submit(p, { imgId: 'x' })).toBe(p); // 가림 중 제출 무시
    p = reveal(p, 1000);
    expect(p.phase).toEqual({ kind: 'turn', deadline: 61000 });
    expect(nextSlot(p.game)).toBe(1);
    p = submit(p, { imgId: 'img0' });
    expect(p.phase).toEqual({ kind: 'cover' });
    p = reveal(p, 5000);
    expect(p.phase).toEqual({ kind: 'turn', deadline: null });
    const after = submit(p, { text: '  답  ' });
    expect(submit(after, { text: '또' })).toBe(after); // 연타: 다음 가림 화면에선 무시
    p = playAll(after);
    expect(p.phase).toEqual({ kind: 'review', page: 0 });
    expect(p.game.chains[0]!.entries[1]!.text).toBe('답');
    const pages = 2 * (stepCount(4) + 2);
    for (let i = 0; i < pages; i++) p = nextPage(p, pages);
    expect(p.phase).toEqual({ kind: 'vote-cover', voter: 0 });
    for (let v = 0; v < 4; v++) {
      expect(p.phase).toEqual({ kind: 'vote-cover', voter: v });
      expect(vote(p, null, null)).toBe(p); // 가림 중 투표 무시
      p = reveal(p, 0);
      const c = voteCandidates(p.game, v);
      p = vote(p, c.drawings[0]?.key ?? null, c.answers[0]?.key ?? null);
    }
    expect(p.phase.kind).toBe('result');
    if (p.phase.kind === 'result') expect(p.phase.result.bestDrawings.length).toBeGreaterThan(0);
  });

  it('답은 40자·금지어 가림', () => {
    let p = reveal(submit(reveal(ok(start(names(3), S, null, mulberry32(3))), 0), { imgId: 'i' }), 0);
    p = submit(p, { text: 'ㄱ'.repeat(50) });
    expect(p.game.chains[0]!.entries[1]!.text).toHaveLength(40);
  });

  it('체인 1개면 결과 쪽 수 = stepCount+2 뒤 투표', () => {
    let p = playAll(ok(start(names(5), { ...S, chainCount: 1 }, null, mulberry32(4))));
    const pages = stepCount(5) + 2;
    for (let i = 0; i < pages - 1; i++) p = nextPage(p, pages);
    expect(p.phase).toEqual({ kind: 'review', page: pages - 1 });
    expect(nextPage(p, pages).phase).toEqual({ kind: 'vote-cover', voter: 0 });
  });
});

describe('이름', () => {
  it('빈 이름 불가, 같은 이름 (2)', () => {
    expect(finalNames(['a', ' ', 'b'])).toBeNull();
    expect(finalNames(['민수', '민수', ' 민수 ', '지우'])).toEqual(['민수', '민수 (2)', '민수 (3)', '지우']);
    expect(finalNames(['가나다라마바사아자차카타파하'])![0]).toHaveLength(12);
  });
  it('인원 2·7 은 시작 실패', () => {
    expect(start(names(2), S, null, mulberry32(1))).toEqual({ ok: false, reason: 'player-count' });
    expect(start([...names(6), '사'], S, null, mulberry32(1))).toEqual({ ok: false, reason: 'player-count' });
  });
});

describe('한 판 더·교사 목록', () => {
  it('같은 이름·설정, 앞 판 제시어 제외', () => {
    const p = ok(start(names(4), S, null, mulberry32(5)));
    const q = ok(again(p, mulberry32(6)));
    expect(q.names).toEqual(p.names);
    expect(q.settings).toEqual(p.settings);
    expect(q.phase).toEqual({ kind: 'cover' });
    const prev = p.game.chains.map((c) => c.word.id);
    q.game.chains.forEach((c) => expect(prev).not.toContain(c.word.id));
    expect(q.game.usedWordIds).toEqual([...prev, ...q.game.chains.map((c) => c.word.id)]);
  });
  it('listSource: only → teacher-only, add → teacher-add, 없음 → default', () => {
    const items = [
      { t: '가는 말이 고와야', m: '뜻1', e: '' },
      { t: '오는 말이 곱다', m: '뜻2', e: '' },
    ];
    expect(wordSource(null, 'm').listSource).toBe('default');
    const only = wordSource({ mode: 'only', items }, 'm');
    expect(only).toMatchObject({ listSource: 'teacher-only', level: null });
    expect(only.teacher).toHaveLength(2);
    expect(wordSource({ mode: 'add', items }, 'm')).toMatchObject({ listSource: 'teacher-add', level: 'm' });
    const p = ok(start(names(3), S, { mode: 'only', items }, mulberry32(7)));
    p.game.chains.forEach((c) => expect(c.word.id).toMatch(/^t-/));
  });
});

describe('새로고침 경고', () => {
  it('beforeunload 등록·해제', () => {
    const t = new EventTarget();
    const add = vi.spyOn(t, 'addEventListener');
    const stop = guardUnload(t);
    expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    const e = new Event('beforeunload', { cancelable: true });
    t.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    stop();
    const e2 = new Event('beforeunload', { cancelable: true });
    t.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(false);
  });
});

