// 결과 보기 장 모델. 장 순서는 엔진 reviewPages 그대로 — 여기서는 위치·문구만 계산한다.
import type { Category, Entry, Mode, ReviewPage } from '../../engine';

export type PagePos = {
  chainIdx: number;
  /** 몇 번째 책(1부터)과 책 수. */
  chainNo: number;
  chainCount: number;
  /** 이 책 안의 쪽(1부터)과 쪽 수. */
  pageNo: number;
  pageCount: number;
  /** 책 주인(0단계 담당). 장이 없으면 null. */
  owner: number | null;
  isLast: boolean;
};

export function ownerOf(pages: readonly ReviewPage[], chainIdx: number): number | null {
  for (const p of pages) if (p.chainIdx === chainIdx && (p.kind === 'draw' || p.kind === 'guess')) return p.entry.bySlot;
  return null;
}

export function pagePos(pages: readonly ReviewPage[], i: number): PagePos {
  const cur = pages[i]!;
  const chains = [...new Set(pages.map((p) => p.chainIdx))];
  const mine = pages.map((p, j) => [p, j] as const).filter(([p]) => p.chainIdx === cur.chainIdx);
  return {
    chainIdx: cur.chainIdx,
    chainNo: chains.indexOf(cur.chainIdx) + 1,
    chainCount: chains.length,
    pageNo: mine.findIndex(([, j]) => j === i) + 1,
    pageCount: mine.length,
    owner: ownerOf(pages, cur.chainIdx),
    isLast: i === pages.length - 1,
  };
}

/** 쪽 머리 문구. 이름은 넘겨받은 그대로(" (2)"·● 마스킹 유지). */
export function pageLabel(page: ReviewPage, pageNo: number, nameOf: (slot: number) => string, mode: Mode, category: Category | null): string {
  switch (page.kind) {
    case 'prompt':
      return `${pageNo}쪽 · 처음 ${mode === 'B' ? '뜻' : (category ?? '제시어')}`;
    case 'draw':
      return `${pageNo}쪽 · ${nameOf(page.entry.bySlot)} 그림`;
    case 'guess':
      return `${pageNo}쪽 · ${nameOf(page.entry.bySlot)} 답`;
    case 'card':
      return `${pageNo}쪽 · 뜻과 예문`;
  }
}

/** 답 장 본문: 결측 '답 없음', 빈 제출 '(비어 있음)'. */
export function guessText(entry: Entry, empty: boolean): string {
  if (entry.status !== 'done') return '답 없음';
  return empty || !entry.text ? '(비어 있음)' : entry.text;
}

/** 그림 장 Blob: 받아 둔 캐시에서 바로, 결측·아직 없음이면 null(→ '그림 없음' 자리). */
export function pictureOf(entry: Entry, image: (imgId: string) => Blob | undefined): Blob | null {
  return entry.status === 'done' && entry.imgId ? (image(entry.imgId) ?? null) : null;
}

/** 결측·빈 장 뒤에는 다음 사람이 그 앞 내용을 봤다 — 대체 안내를 붙인다(뒤가 카드면 다음 사람이 없어 안 붙임). */
export function isGap(pages: readonly ReviewPage[], i: number): boolean {
  const p = pages[i];
  return !!p && (p.kind === 'draw' || p.kind === 'guess') && (p.entry.status !== 'done' || p.empty) && pages[i + 1]?.kind !== 'card';
}
