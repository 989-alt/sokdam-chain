import { describe, expect, it } from 'vitest';
import type { Entry, EntryKey, ReviewPage } from '../../engine';
import { canSubmitVote, findEntries, voteItems } from './vote';

const word = { id: 'p1', text: 't', meaning: 'm', example: 'e' };
const e = (step: number, bySlot: number, x: Partial<Entry> = {}): Entry =>
  step % 2 === 0 ? { step, kind: 'draw', bySlot, status: 'done', imgId: `i${step}${bySlot}`, ...x } : { step, kind: 'guess', bySlot, status: 'done', text: `a${bySlot}`, ...x };
const pg = (chainIdx: number, entry: Entry): ReviewPage => ({ chainIdx, kind: entry.kind, entry, empty: entry.kind === 'guess' && entry.status === 'done' && !entry.text });
const pages: ReviewPage[] = [
  { chainIdx: 0, kind: 'prompt', text: 't' },
  pg(0, e(0, 0)),
  pg(0, e(1, 1)),
  pg(0, e(2, 2, { status: 'missing', imgId: undefined })),
  pg(0, e(3, 3, { text: '' })),
  { chainIdx: 0, kind: 'card', word },
  { chainIdx: 1, kind: 'prompt', text: 't' },
  pg(1, e(0, 1)),
  pg(1, e(1, 2)),
  pg(1, e(2, 3)),
  pg(1, e(3, 0)),
  { chainIdx: 1, kind: 'card', word },
];
// slot 0 의 후보(엔진 voteCandidates 가 자기 것·결측·빈 답을 뺀 것)
const cands = { drawings: ['1:0', '1:2'] as EntryKey[], answers: ['0:1', '1:1'] as EntryKey[] };

describe('voteItems', () => {
  it('결측·빈 답은 없음, 내 것은 보이되 비활성, 후보만 활성', () => {
    const it0 = voteItems(pages, cands, 0);
    expect(it0.drawings.map((x) => [x.key, x.mine, x.enabled])).toEqual([
      ['0:0', true, false],
      ['1:0', false, true],
      ['1:2', false, true],
    ]);
    expect(it0.answers.map((x) => [x.key, x.mine, x.enabled])).toEqual([
      ['0:1', false, true],
      ['1:1', false, true],
      ['1:3', true, false],
    ]);
  });
  it('후보에 없는 남의 것도 비활성', () => {
    expect(voteItems(pages, { drawings: [], answers: [] }, 0).drawings.every((x) => !x.enabled)).toBe(true);
  });
});

describe('canSubmitVote', () => {
  const items = voteItems(pages, cands, 0);
  it('두 부문 다 골라야', () => {
    expect(canSubmitVote(items, null, null)).toBe(false);
    expect(canSubmitVote(items, '1:0', null)).toBe(false);
    expect(canSubmitVote(items, null, '0:1')).toBe(false);
    expect(canSubmitVote(items, '1:0', '0:1')).toBe(true);
  });
  it('내 것·비활성 키는 고른 것으로 치지 않음', () => {
    expect(canSubmitVote(items, '0:0', '0:1')).toBe(false);
  });
  it('후보가 없는 부문은 건너뛴다', () => {
    const noDraw = voteItems(pages, { drawings: [], answers: ['0:1'] }, 0);
    expect(canSubmitVote(noDraw, null, '0:1')).toBe(true);
    expect(canSubmitVote(voteItems(pages, { drawings: [], answers: [] }, 0), null, null)).toBe(true);
  });
});

describe('findEntries', () => {
  it('동점 키 모두, 없는 키는 버림', () => {
    expect(findEntries(pages, ['1:0', '1:2', '9:9'] as EntryKey[]).map((x) => [x.key, x.entry.bySlot])).toEqual([
      ['1:0', 1],
      ['1:2', 3],
    ]);
    expect(findEntries(pages, [])).toEqual([]);
  });
});
