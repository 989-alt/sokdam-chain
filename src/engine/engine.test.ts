import { describe, expect, it } from 'vitest';
import {
  advance,
  applySubmission,
  assignee,
  createGame,
  entryKey,
  inputFor,
  isFinished,
  isStepComplete,
  markMissing,
  mulberry32,
  openKeys,
  pickWords,
  reviewPages,
  stepCount,
  tally,
  voteCandidates,
  type CreateOptions,
  type Game,
  type Word,
} from './index';

const w = (i: number, level = 'e34'): Word => ({
  id: `p${i}`,
  text: `속담${i}`,
  meaning: `뜻${i}`,
  example: `예문${i}`,
  level,
  type: '속담',
});
const pool = [...Array(12).keys()].map((i) => w(i, i < 9 ? 'e34' : 'm'));
const teacher = [0, 1, 2].map((i) => ({ id: `t-${i}`, text: `교사${i}`, meaning: `교뜻${i}`, example: '' }));

const opts = (n: number, extra: Partial<CreateOptions> = {}): CreateOptions => ({
  playerCount: n,
  mode: 'A',
  minPlayers: 4,
  maxPlayers: 6,
  pool,
  level: null,
  listSource: 'default',
  rng: mulberry32(1),
  ...extra,
});
const mk = (n: number, extra: Partial<CreateOptions> = {}): Game => {
  const r = createGame(opts(n, extra));
  if (!r.ok) throw new Error(r.reason);
  return r.game;
};

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

/** 지금 차례 전부 제출(답은 텍스트, 그림은 imgId). */
function submitAll(g: Game, text = (k: string) => `답${k}`): Game {
  for (const k of openKeys(g)) {
    const [c, s] = k.split(':').map(Number);
    const e = g.chains[c!]!.entries[s!]!;
    const r = applySubmission(g, k, e.bySlot, e.kind === 'draw' ? { imgId: `img${k}` } : { text: text(k) });
    if (!r.ok) throw new Error(r.reason);
    g = r.game;
  }
  return advance(g);
}

describe('stepCount / assignee', () => {
  it('짝수 N → N, 홀수 N → N−1', () => {
    expect([3, 4, 5, 6, 7].map(stepCount)).toEqual([2, 4, 4, 6, 6]);
    for (let n = 3; n <= 7; n++) expect(stepCount(n) % 2).toBe(0);
  });

  it.each([4, 5, 6])('N=%i 매 라운드 각자 정확히 한 칸, 홀수면 안 맡는 체인은 (p+1) mod N 뿐', (n) => {
    const steps = stepCount(n);
    for (let s = 0; s < steps; s++) {
      const slots = [...Array(n).keys()].map((i) => assignee(i, s, n)).sort();
      expect(slots).toEqual([...Array(n).keys()]);
    }
    for (let p = 0; p < n; p++) {
      const skipped = [...Array(n).keys()].filter((i) => ![...Array(steps).keys()].some((s) => assignee(i, s, n) === p));
      expect(skipped).toEqual(n % 2 ? [(p + 1) % n] : []);
    }
  });

  it('entries 의 kind 는 짝수 단계 draw·홀수 guess, bySlot 은 공식', () => {
    const g = mk(5);
    for (const c of g.chains)
      for (const e of c.entries) {
        expect(e.kind).toBe(e.step % 2 ? 'guess' : 'draw');
        expect(e.bySlot).toBe((c.idx + e.step) % 5);
      }
  });
});

describe('createGame', () => {
  it('인원 범위 밖이면 {ok:false}', () => {
    expect(createGame(opts(3)).ok).toBe(false);
    expect(createGame(opts(3, { minPlayers: 3 })).ok).toBe(true);
    expect(createGame(opts(7)).ok).toBe(false);
    expect(createGame(opts(7, { minPlayers: 3 })).ok).toBe(false);
  });

  it('돌려쓰기 체인 2개 — 시작 slot 0, floor(N/2), sequential', () => {
    const g = mk(5, { minPlayers: 3, chainCount: 2 });
    expect(g.chains.map((c) => c.startSlot)).toEqual([0, 2]);
    expect(g.chains[1]!.entries.map((e) => e.bySlot)).toEqual([2, 3, 4, 0]);
    expect(g.order).toBe('sequential');
    expect(mk(4, { chainCount: 1 }).chains).toHaveLength(1);
  });

  it('sequential — 체인 A 끝까지 뒤 체인 B', () => {
    let g = mk(4, { chainCount: 2 });
    const seen: string[] = [];
    while (!isFinished(g)) {
      seen.push(...openKeys(g));
      g = submitAll(g);
    }
    expect(seen).toEqual(['0:0', '0:1', '0:2', '0:3', '1:0', '1:1', '1:2', '1:3']);
  });

  it('한 판 더 — usedWordIds 를 exclude 로 넘기면 겹치지 않고 누적', () => {
    const g1 = mk(4);
    const g2 = mk(4, { exclude: g1.usedWordIds, rng: mulberry32(2) });
    const ids2 = g2.chains.map((c) => c.word.id);
    expect(ids2.some((id) => g1.usedWordIds.includes(id))).toBe(false);
    expect(g2.usedWordIds).toEqual([...g1.usedWordIds, ...ids2]);
  });
});

describe('pickWords', () => {
  const src = { pool, level: 'e34' as const, listSource: 'default' as const };
  it('같은 시드 → 같은 결과, 겹침 없음, 수준 필터', () => {
    const a = pickWords(src, 5, [], mulberry32(7));
    const b = pickWords(src, 5, [], mulberry32(7));
    expect(a).toEqual(b);
    if (!a.ok) throw new Error();
    expect(new Set(a.words.map((x) => x.id)).size).toBe(5);
    expect(a.words.every((x) => x.level === 'e34')).toBe(true);
  });

  it('풀 9·N=5·exclude 5 → 초기화 후 성공', () => {
    const r = pickWords(src, 5, ['p0', 'p1', 'p2', 'p3', 'p4'], mulberry32(3));
    expect(r.ok && r.reset).toBe(true);
  });

  it('풀 4·N=5 → not-enough-words', () => {
    expect(pickWords({ ...src, pool: pool.slice(0, 4) }, 5, [], mulberry32(3))).toEqual({
      ok: false,
      reason: 'not-enough-words',
    });
  });

  it('teacher-only 는 level 무시하고 교사 항목만, teacher-add 는 합침', () => {
    const only = pickWords({ ...src, teacher, listSource: 'teacher-only' }, 3, [], mulberry32(1));
    expect(only.ok && only.words.every((x) => x.id.startsWith('t-'))).toBe(true);
    const add = pickWords({ ...src, level: 'm', teacher, listSource: 'teacher-add' }, 6, [], mulberry32(1));
    expect(add.ok && add.words.map((x) => x.id).sort()).toEqual(['p10', 'p11', 'p9', 't-0', 't-1', 't-2']);
  });
});

describe('inputFor', () => {
  it('0단계 — A 는 text, B 는 meaning(원문 없음)', () => {
    const c = mk(4).chains[0]!;
    expect(inputFor(c, 0, 'A')).toEqual({ kind: 'text', text: c.word.text });
    const b = inputFor(c, 0, 'B');
    expect(b).toEqual({ kind: 'meaning', text: c.word.meaning });
    expect(JSON.stringify(b)).not.toContain(c.word.text);
  });

  it('앞 칸이 있으면 그것, 연속 결측 2개면 그 앞 것 + fallbackNote', () => {
    let g = mk(6);
    g = submitAll(g); // 0 draw done
    expect(inputFor(g.chains[0]!, 1, 'A')).toEqual({ kind: 'image', imgId: 'img0:0' });
    g = markMissing(markMissing(g, '0:1'), '0:2');
    expect(inputFor(g.chains[0]!, 3, 'A')).toEqual({ kind: 'image', imgId: 'img0:0', fallbackNote: true });
  });

  it('전부 결측이면 제시어(B 는 뜻) + fallbackNote', () => {
    let g = mk(4);
    g = markMissing(markMissing(g, '1:0'), '1:1');
    const c = g.chains[1]!;
    expect(inputFor(c, 2, 'A')).toEqual({ kind: 'text', text: c.word.text, fallbackNote: true });
    expect(inputFor(c, 2, 'B')).toEqual({ kind: 'meaning', text: c.word.meaning, fallbackNote: true });
  });

  it('빈 답은 답 없음으로 보고 건너뛴다', () => {
    let g = submitAll(mk(4));
    g = submitAll(g, () => '  ');
    expect(inputFor(g.chains[0]!, 2, 'A')).toEqual({ kind: 'image', imgId: 'img0:0', fallbackNote: true });
  });
});

describe('applySubmission / markMissing / 단계', () => {
  it('중복 제출은 무시, 첫 제출 유지', () => {
    const g = mk(4);
    const r1 = applySubmission(g, '0:0', 0, { imgId: 'a' });
    if (!r1.ok) throw new Error();
    const r2 = applySubmission(r1.game, '0:0', 0, { imgId: 'b' });
    expect(r2.ok && r2.ignored && r2.game === r1.game).toBe(true);
    expect(r1.game.chains[0]!.entries[0]).toEqual({ step: 0, kind: 'draw', bySlot: 0, status: 'done', imgId: 'a' });
  });

  it('현재 단계 아님·담당 아님·종류 불일치 → {ok:false}', () => {
    const g = mk(4);
    expect(applySubmission(g, '0:1', 1, { text: 'x' }).ok).toBe(false);
    expect(applySubmission(g, '0:0', 1, { imgId: 'x' }).ok).toBe(false);
    expect(applySubmission(g, '0:0', 0, { text: 'x' }).ok).toBe(false);
    expect(applySubmission(g, '9:0', 0, { imgId: 'x' }).ok).toBe(false);
    expect(applySubmission(g, 'junk', 0, { imgId: 'x' }).ok).toBe(false);
  });

  it('빈 답은 done + text "", 미도착은 missing — reviewPages 에서 구분', () => {
    let g = submitAll(mk(4));
    let r = applySubmission(g, '0:1', 1, { text: '   ' });
    if (!r.ok) throw new Error();
    g = markMissing(r.game, '1:1');
    expect(g.chains[0]!.entries[1]).toMatchObject({ status: 'done', text: '' });
    expect(g.chains[1]!.entries[1]!.status).toBe('missing');
    const pages = reviewPages(g);
    const p0 = pages.find((p) => p.chainIdx === 0 && p.kind === 'guess');
    const p1 = pages.find((p) => p.chainIdx === 1 && p.kind === 'guess');
    expect(p0 && 'empty' in p0 && p0.empty).toBe(true);
    expect(p1 && 'empty' in p1 && !p1.empty && p1.entry.status === 'missing').toBe(true);
  });

  it('markMissing 은 pending 만, done 은 그대로', () => {
    const r = applySubmission(mk(4), '0:0', 0, { imgId: 'a' });
    if (!r.ok) throw new Error();
    expect(markMissing(r.game, '0:0')).toBe(r.game);
    expect(markMissing(r.game, '1:0').chains[1]!.entries[0]!.status).toBe('missing');
  });

  it('단계 완료 — 모든 체인 현재 칸이 done/missing 이면 완료, advance', () => {
    let g = mk(4);
    expect(isStepComplete(g)).toBe(false);
    for (const k of ['0:0', '1:0', '2:0']) {
      const r = applySubmission(g, k, Number(k[0]), { imgId: k });
      if (!r.ok) throw new Error();
      g = r.game;
    }
    expect(isStepComplete(g)).toBe(false);
    expect(advance(g)).toBe(g);
    g = markMissing(g, '3:0');
    expect(isStepComplete(g)).toBe(true);
    expect(advance(g).step).toBe(1);
  });
});

describe('reviewPages', () => {
  it.each([4, 5, 6])('N=%i 순서 prompt → entries → card, card 직전은 guess', (n) => {
    let g = mk(n);
    while (!isFinished(g)) g = submitAll(g);
    const pages = reviewPages(g);
    expect(pages).toHaveLength(n * (stepCount(n) + 2));
    const per = stepCount(n) + 2;
    for (let c = 0; c < n; c++) {
      const chunk = pages.slice(c * per, (c + 1) * per);
      expect(chunk.every((p) => p.chainIdx === c)).toBe(true);
      expect(chunk[0]!.kind).toBe('prompt');
      expect(chunk[per - 1]!.kind).toBe('card');
      expect(chunk[per - 2]!.kind).toBe('guess');
    }
  });

  it('모드 B prompt 는 뜻만', () => {
    const g = mk(4, { mode: 'B' });
    const p = reviewPages(g)[0]!;
    expect(p).toEqual({ chainIdx: 0, kind: 'prompt', text: g.chains[0]!.word.meaning });
  });
});

describe('투표', () => {
  // N=4 판: 1:1 빈 답, 2:2 그림 결측
  function played(): Game {
    let g = submitAll(mk(4));
    g = submitAll(g, (k) => (k === '1:1' ? '' : `답${k}`));
    for (const k of openKeys(g)) {
      if (k === '2:2') continue;
      const e = g.chains[Number(k[0])]!.entries[2]!;
      const r = applySubmission(g, k, e.bySlot, { imgId: `img${k}` });
      if (!r.ok) throw new Error();
      g = r.game;
    }
    g = advance(markMissing(g, '2:2'));
    return submitAll(g);
  }

  it('후보 — 자기 것·결측·빈 답 없음', () => {
    const g = played();
    const { drawings, answers } = voteCandidates(g, 0);
    const all = [...drawings, ...answers];
    expect(all.some((c) => c.entry.bySlot === 0)).toBe(false);
    expect(all.some((c) => c.key === '2:2' || c.key === '1:1')).toBe(false);
    expect(drawings.every((c) => c.entry.kind === 'draw')).toBe(true);
    expect(drawings).toHaveLength(6); // 8 − 자기 것 2(0:0, 2:2 — 2:2 는 결측이기도)
    expect(answers).toHaveLength(5); // 8 − 빈 답 1(1:1) − 자기 것 2(3:1, 1:3)
  });

  it('자기 투표·후보 아닌 칸은 무효', () => {
    const g = played();
    // 0:0 은 slot 0 그림, 0:1 은 slot 1 답
    const r = tally({ 0: { drawing: '0:0', answer: '1:1' }, 1: { drawing: '0:0', answer: '0:1' } }, g);
    expect(r.drawingCounts).toEqual({ '0:0': 1 });
    expect(r.answerCounts).toEqual({});
    expect(r.bestDrawings).toEqual(['0:0']);
    expect(r.bestAnswers).toEqual([]);
  });

  it('동점은 전부, 표 0 이면 빈 배열, 기권은 제외', () => {
    const g = played();
    const tie = tally({ 2: { drawing: '0:0', answer: '0:1' }, 3: { drawing: '1:0', answer: '3:3' } }, g);
    expect(tie.bestDrawings.sort()).toEqual(['0:0', '1:0']);
    expect(tie.bestAnswers.sort()).toEqual(['0:1', '3:3']);
    expect(tally({}, g)).toMatchObject({ bestDrawings: [], bestAnswers: [] });
    expect(tally({ 0: 'abstain', 1: 'abstain' }, g)).toMatchObject({ bestDrawings: [], bestAnswers: [] });
  });
});

describe('순수성', () => {
  it('얼린 입력으로 전 흐름 통과, 입력 불변', () => {
    let g = deepFreeze(mk(5, { minPlayers: 3 }));
    const snap = JSON.stringify(g);
    const r = applySubmission(g, '0:0', 0, { imgId: 'a' });
    expect(r.ok).toBe(true);
    markMissing(g, '1:0');
    expect(JSON.stringify(g)).toBe(snap);
    while (!isFinished(g)) g = deepFreeze(submitAll(g));
    reviewPages(g);
    voteCandidates(g, 0);
    tally(deepFreeze({ 0: { drawing: entryKey(1, 0), answer: entryKey(1, 1) } }), g);
    expect(deepFreeze(pool)).toBe(pool);
    expect(pickWords({ pool, level: null, listSource: 'default' }, 3, deepFreeze(['p1']), mulberry32(1)).ok).toBe(true);
  });
});
