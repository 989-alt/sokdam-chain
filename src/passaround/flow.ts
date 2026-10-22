// 돌려쓰기 흐름 — 기기 한 대에서 엔진(T01)을 순차 호출한다. 온라인과 규칙은 같고 입력이 화면에서 바로 온다(설계문서 §6.3).
// 순수 함수만(타이머·DOM 없음). 그림 Blob 은 화면 쪽 메모리 Map 에 두고 여기엔 imgId 만.
import { filter } from '../data/filter';
import { POOL } from '../data/words';
import {
  advance,
  applySubmission,
  createGame,
  isFinished,
  openKeys,
  parseKey,
  tally,
  type EntryKey,
  type Category,
  type Game,
  type Level,
  type ListSource,
  type Mode,
  type Payload,
  type Rng,
  type TallyResult,
  type Votes,
  type Word,
} from '../engine';
import { toWords } from '../teacher/list';
import type { TeacherList } from '../app/teacher-state';

export const MIN = 3;
export const MAX = 6;
const NAME_MAX = 12;
const ANSWER_MAX = 40;

export type PassSettings = { category: Category | null; level: Level | null; mode: Mode; drawSeconds: number; chainCount: 1 | 2 };

export type Phase =
  | { kind: 'cover' } // 지금 차례 사람에게 넘기는 가림 화면
  | { kind: 'turn'; deadline: number | null } // 그리기만 기한(답 쓰기 무제한)
  | { kind: 'review'; page: number }
  | { kind: 'vote-cover'; voter: number }
  | { kind: 'vote'; voter: number }
  | { kind: 'result'; result: TallyResult };

export type Pass = { names: string[]; settings: PassSettings; teacher: TeacherList | null; game: Game; votes: Votes; phase: Phase };

/** 이름 정리: 공백 제거·12자·금지어 ●, 같은 이름은 ' (2)'. 빈 이름이 하나라도 있으면 null. */
export function finalNames(raw: readonly string[]): string[] | null {
  const out: string[] = [];
  for (const r of raw) {
    const base = filter([...r.trim()].slice(0, NAME_MAX).join('').trim());
    if (!base) return null;
    let name = base;
    for (let k = 2; out.includes(name); k++) name = `${base} (${k})`;
    out.push(name);
  }
  return out;
}

/** 교사 목록 → 엔진 WordSource. only 면 teacher-only(묶음·수준 무시), add 면 teacher-add. */
export function wordSource(
  teacher: TeacherList | null,
  category: Category | null,
  level: Level | null,
): { pool: readonly Word[]; teacher?: Word[]; category: Category | null; level: Level | null; listSource: ListSource } {
  if (!teacher) return { pool: POOL, category, level, listSource: 'default' };
  const only = teacher.mode === 'only';
  return {
    pool: POOL,
    teacher: toWords(teacher.items, level ?? 'e34'),
    category: only ? null : category,
    level: only ? null : level,
    listSource: only ? 'teacher-only' : 'teacher-add',
  };
}

/** 새 판. exclude = 앞 판 usedWordIds(한 판 더). */
export function start(names: string[], settings: PassSettings, teacher: TeacherList | null, rng: Rng, exclude: readonly string[] = []): Pass | { ok: false; reason: string } {
  const r = createGame({
    ...wordSource(teacher, settings.category, settings.level),
    playerCount: names.length,
    mode: settings.mode,
    minPlayers: MIN,
    maxPlayers: MAX,
    chainCount: settings.chainCount,
    exclude,
    rng,
  });
  if (!r.ok) return r;
  return { names, settings, teacher, game: r.game, votes: {}, phase: { kind: 'cover' } };
}

export const again = (p: Pass, rng: Rng) => start(p.names, p.settings, p.teacher, rng, p.game.usedWordIds);

/** 지금 차례 칸. 끝났으면 null. */
export function current(g: Game) {
  const key = openKeys(g)[0];
  if (!key) return null;
  const { chainIdx, step } = parseKey(key)!;
  const chain = g.chains[chainIdx]!;
  return { key, chain, step, entry: chain.entries[step]! };
}

/** 차례마다 기기를 받는 사람(slot) — 체인 A 끝까지, 이어 체인 B. */
export const turnOrder = (g: Game): number[] => g.chains.flatMap((c) => c.entries.map((e) => e.bySlot));

/** 다음 차례 사람(제출 버튼 "○○에게 넘겨요"). 마지막 차례면 null. */
export const nextSlot = (g: Game): number | null => turnOrder(g)[g.step + 1] ?? null;

/** 가림 화면에서 "준비됐어요". 그리기는 지금부터 기한. */
export function reveal(p: Pass, now: number): Pass {
  if (p.phase.kind === 'vote-cover') return { ...p, phase: { kind: 'vote', voter: p.phase.voter } };
  if (p.phase.kind !== 'cover') return p;
  const c = current(p.game);
  if (!c) return p;
  return { ...p, phase: { kind: 'turn', deadline: c.entry.kind === 'draw' ? now + p.settings.drawSeconds * 1000 : null } };
}

/** 지금 칸 제출(그림 {imgId} | 답 {text}). 끝나면 결과 보기, 아니면 다음 사람 가림 화면. 차례가 아니면 그대로. */
export function submit(p: Pass, payload: Payload): Pass {
  const c = current(p.game);
  if (p.phase.kind !== 'turn' || !c) return p;
  const clean = 'text' in payload ? { text: filter([...payload.text].slice(0, ANSWER_MAX).join('')) } : payload;
  const r = applySubmission(p.game, c.key, c.entry.bySlot, clean);
  if (!r.ok || r.ignored) return p;
  const game = advance(r.game);
  return { ...p, game, phase: isFinished(game) ? { kind: 'review', page: 0 } : { kind: 'cover' } };
}

/** 결과 보기 다음 쪽. 마지막 쪽 다음은 첫 사람 투표 가림 화면. */
export function nextPage(p: Pass, pageCount: number): Pass {
  if (p.phase.kind !== 'review') return p;
  const page = p.phase.page + 1;
  return { ...p, phase: page < pageCount ? { kind: 'review', page } : { kind: 'vote-cover', voter: 0 } };
}

/** 지금 사람 투표. 모두 끝나면 집계. */
export function vote(p: Pass, drawing: EntryKey | null, answer: EntryKey | null): Pass {
  if (p.phase.kind !== 'vote') return p;
  const voter = p.phase.voter;
  const votes = { ...p.votes, [voter]: { drawing, answer } };
  const next = voter + 1;
  return {
    ...p,
    votes,
    phase: next < p.names.length ? { kind: 'vote-cover', voter: next } : { kind: 'result', result: tally(votes, p.game) },
  };
}

/** 진행 중 판은 저장하지 않으므로 새로고침·닫기 전에 브라우저 경고 1회. 정리 함수 반환. */
export function guardUnload(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>): () => void {
  const on = (e: Event) => {
    e.preventDefault();
    (e as BeforeUnloadEvent).returnValue = ''; // 옛 브라우저는 returnValue 가 있어야 경고
  };
  target.addEventListener('beforeunload', on);
  return () => target.removeEventListener('beforeunload', on);
}
