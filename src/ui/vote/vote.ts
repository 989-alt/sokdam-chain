// 투표 화면 규칙(순수). 후보 판정은 엔진/방장 몫 — 여기는 보여 줄 목록과 제출 가능 여부만.
import { entryKey, type Entry, type EntryKey, type ReviewPage } from '../../engine';

export type VoteItem = { key: EntryKey; chainIdx: number; entry: Entry; mine: boolean; enabled: boolean };
export type Keys = { drawings: readonly EntryKey[]; answers: readonly EntryKey[] };

/** 결과 장에서 제출된(결측·빈 답 아님) 그림·답 전부. 내 것은 보이되 비활성, 고를 수 있는 건 후보에 든 것만. */
export function voteItems(pages: readonly ReviewPage[], candidates: Keys | null, mySlot: number | null): { drawings: VoteItem[]; answers: VoteItem[] } {
  const out = { drawings: [] as VoteItem[], answers: [] as VoteItem[] };
  for (const p of pages) {
    if (p.kind !== 'draw' && p.kind !== 'guess') continue;
    const e = p.entry;
    if (e.status !== 'done' || (p.kind === 'draw' ? !e.imgId : !e.text)) continue;
    const key = entryKey(p.chainIdx, e.step);
    const mine = e.bySlot === mySlot;
    const pool = p.kind === 'draw' ? candidates?.drawings : candidates?.answers;
    (p.kind === 'draw' ? out.drawings : out.answers).push({ key, chainIdx: p.chainIdx, entry: e, mine, enabled: !mine && !!pool?.includes(key) });
  }
  return out;
}

/** 두 부문 다 골라야 제출. 고를 후보가 하나도 없는 부문은 null 로 건너뛴다(엔진 Vote 형). */
export function canSubmitVote(items: { drawings: VoteItem[]; answers: VoteItem[] }, drawing: EntryKey | null, answer: EntryKey | null): boolean {
  const need = (xs: VoteItem[], k: EntryKey | null) => !xs.some((x) => x.enabled) || (k !== null && xs.some((x) => x.enabled && x.key === k));
  return need(items.drawings, drawing) && need(items.answers, answer);
}

/** 결과 키 → 장의 칸. 없는 키는 버린다. */
export function findEntries(pages: readonly ReviewPage[], keys: readonly EntryKey[]): { key: EntryKey; chainIdx: number; entry: Entry }[] {
  return keys.flatMap((key) => {
    const p = pages.find((x) => (x.kind === 'draw' || x.kind === 'guess') && entryKey(x.chainIdx, x.entry.step) === key);
    return p && (p.kind === 'draw' || p.kind === 'guess') ? [{ key, chainIdx: p.chainIdx, entry: p.entry }] : [];
  });
}
