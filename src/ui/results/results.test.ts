import { describe, expect, it } from 'vitest';
import type { Entry, ReviewPage } from '../../engine';
import { guessText, isGap, ownerOf, pageLabel, pagePos, pictureOf } from './pages';

type EP = Extract<ReviewPage, { entry: Entry }>;
const word = { id: 'p1', text: '발이 넓다', meaning: '아는 사람이 많다', example: '' };
const d = (chainIdx: number, step: number, bySlot: number, status: Entry['status'] = 'done', imgId: string | undefined = `i${chainIdx}${step}`): ReviewPage => ({
  chainIdx,
  kind: 'draw',
  entry: { step, kind: 'draw', bySlot, status, imgId: status === 'done' ? imgId : undefined },
  empty: false,
});
const g = (chainIdx: number, step: number, bySlot: number, text = '답', status: Entry['status'] = 'done'): ReviewPage => ({
  chainIdx,
  kind: 'guess',
  entry: { step, kind: 'guess', bySlot, status, text: status === 'done' ? text : undefined },
  empty: status === 'done' && !text,
});
// 2권 × (제시 + 그림·답 2단계 + 카드) — 엔진 reviewPages 모양
const pages: ReviewPage[] = [
  { chainIdx: 0, kind: 'prompt', text: '발이 넓다' },
  d(0, 0, 0),
  g(0, 1, 1, '', 'done'),
  { chainIdx: 0, kind: 'card', word },
  { chainIdx: 1, kind: 'prompt', text: '발이 넓다' },
  d(1, 0, 1, 'missing'),
  g(1, 1, 0, '', 'missing'),
  { chainIdx: 1, kind: 'card', word },
];
const names = ['민수', '민수 (2)'];
const nameOf = (s: number) => names[s]!;

describe('pagePos', () => {
  it('책 번호·쪽 번호·주인·마지막', () => {
    expect(pagePos(pages, 0)).toEqual({ chainIdx: 0, chainNo: 1, chainCount: 2, pageNo: 1, pageCount: 4, owner: 0, isLast: false });
    expect(pagePos(pages, 6)).toMatchObject({ chainNo: 2, pageNo: 3, owner: 1 });
    expect(pagePos(pages, 7).isLast).toBe(true);
    expect(ownerOf(pages, 9)).toBeNull();
  });
});

describe('pageLabel', () => {
  it('이름은 (2)·● 그대로', () => {
    expect(pageLabel(pages[1]!, 2, nameOf, 'A', '속담')).toBe('2쪽 · 민수 그림');
    expect(pageLabel(pages[5]!, 2, nameOf, 'A', '속담')).toBe('2쪽 · 민수 (2) 그림');
    expect(pageLabel(pages[2]!, 3, (s) => (s === 1 ? '●●민수' : 'x'), 'A', '속담')).toBe('3쪽 · ●●민수 답');
    expect(pageLabel(pages[0]!, 1, nameOf, 'B', '속담')).toBe('1쪽 · 처음 뜻');
    expect(pageLabel(pages[0]!, 1, nameOf, 'A', '사자성어')).toBe('1쪽 · 처음 사자성어');
    expect(pageLabel(pages[0]!, 1, nameOf, 'A', null)).toBe('1쪽 · 처음 제시어');
    expect(pageLabel(pages[3]!, 4, nameOf, 'A', '속담')).toBe('4쪽 · 뜻과 예문');
  });
});

describe('결측·빈 답·그림', () => {
  it("답 없음 / (비어 있음) / 원문", () => {
    const p2 = pages[2] as EP;
    const p6 = pages[6] as EP;
    expect(guessText(p2.entry, p2.empty)).toBe('(비어 있음)');
    expect(guessText(p6.entry, p6.empty)).toBe('답 없음');
    const ok = g(0, 1, 1, '바나나') as EP;
    expect(guessText(ok.entry, ok.empty)).toBe('바나나');
  });
  it('그림은 캐시에서 바로, 없으면 null(그림 없음 자리)', () => {
    const blob = new Blob(['x']);
    const cache = new Map([['i00', blob]]);
    const img = (id: string) => cache.get(id);
    expect(pictureOf((pages[1] as EP).entry, img)).toBe(blob);
    expect(pictureOf((pages[5] as EP).entry, img)).toBeNull();
    expect(pictureOf((d(0, 2, 0) as EP).entry, img)).toBeNull(); // done 인데 아직 안 옴
  });
  it('대체 안내는 결측·빈 장 뒤에 다음 사람이 있을 때만', () => {
    expect(isGap(pages, 5)).toBe(true);
    expect(isGap(pages, 6)).toBe(false); // 다음이 카드
    expect(isGap(pages, 2)).toBe(false);
    expect(isGap(pages, 1)).toBe(false);
    expect(isGap(pages, 0)).toBe(false);
  });
});
