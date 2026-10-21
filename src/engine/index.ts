// 규칙 엔진 — 순수 함수만. DOM·네트워크·타이머·시계 없음. 난수는 rng 인자로 받는다.
// 온라인 모드와 돌려쓰기 모드가 같이 쓴다(PRD §7.1, 설계문서 §6.3).

export type Level = 'e34' | 'e56' | 'm';
export type Mode = 'A' | 'B';
export type ListSource = 'default' | 'teacher-add' | 'teacher-only';
/** PRD §7.3. 교사 항목엔 level 이 없을 수 있다. */
export type Word = { id: string; text: string; meaning: string; example: string; level?: string; type?: string };
export type Rng = () => number; // [0, 1)

export type EntryKey = `${number}:${number}`;
export type EntryStatus = 'pending' | 'done' | 'missing';
export type Entry = {
  step: number;
  kind: 'draw' | 'guess';
  bySlot: number;
  status: EntryStatus;
  imgId?: string;
  text?: string;
};
export type Chain = { idx: number; startSlot: number; word: Word; entries: Entry[] };
export type Game = {
  mode: Mode;
  /** lockstep: 모든 체인이 한 단계씩 같이(온라인). sequential: 체인 하나를 끝까지 돌린 뒤 다음 체인(돌려쓰기). */
  order: 'lockstep' | 'sequential';
  playerCount: number;
  stepCount: number;
  /** 차례 번호(0부터). lockstep 은 단계 번호와 같고, sequential 은 체인 순서로 이어 센다. */
  step: number;
  chains: Chain[];
  /** 이번 세션에 나온 제시어 id — 다음 판 createGame 의 exclude 로 넘긴다. */
  usedWordIds: string[];
};

export type Input = { kind: 'text' | 'meaning' | 'image'; text?: string; imgId?: string; fallbackNote?: true };
export type Fail = { ok: false; reason: string };

export const stepCount = (n: number): number => (n % 2 === 0 ? n : n - 1);
export const assignee = (startSlot: number, step: number, n: number): number => (startSlot + step) % n;
export const kindOf = (step: number): Entry['kind'] => (step % 2 === 0 ? 'draw' : 'guess');
export const entryKey = (chainIdx: number, step: number): EntryKey => `${chainIdx}:${step}`;
export const parseKey = (key: string): { chainIdx: number; step: number } | null => {
  const m = /^(\d+):(\d+)$/.exec(key);
  return m ? { chainIdx: Number(m[1]), step: Number(m[2]) } : null;
};

/** 시드 난수(mulberry32). 같은 시드 → 같은 수열. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type WordSource = { pool: readonly Word[]; teacher?: readonly Word[]; level: Level | null; listSource: ListSource };

/** 후보 = 수준 필터(+교사 목록) − exclude. 모자라면 exclude 를 비우고 다시. reset 은 그때 true. */
export function pickWords(
  src: WordSource,
  n: number,
  exclude: readonly string[],
  rng: Rng,
): { ok: true; words: Word[]; reset: boolean } | Fail {
  const teacher = src.teacher ?? [];
  const base =
    src.listSource === 'teacher-only'
      ? teacher
      : [...src.pool.filter((w) => src.level === null || w.level === src.level), ...(src.listSource === 'teacher-add' ? teacher : [])];
  const ex = new Set(exclude);
  let cand = base.filter((w) => !ex.has(w.id));
  let reset = false;
  if (cand.length < n) {
    cand = [...base];
    reset = true;
  }
  if (cand.length < n) return { ok: false, reason: 'not-enough-words' };
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (cand.length - i));
    [cand[i], cand[j]] = [cand[j]!, cand[i]!];
  }
  return { ok: true, words: cand.slice(0, n), reset };
}

export type CreateOptions = WordSource & {
  playerCount: number;
  mode: Mode;
  minPlayers: number; // 온라인 4, 돌려쓰기 3
  maxPlayers: number; // 6
  /** 돌려쓰기만 넘긴다(1|2). 넘기면 sequential, B 체인 시작 slot = floor(N/2). 없으면 체인 N개 lockstep. */
  chainCount?: 1 | 2;
  exclude?: readonly string[];
  rng: Rng;
};

export function createGame(o: CreateOptions): { ok: true; game: Game } | Fail {
  const n = o.playerCount;
  if (!Number.isInteger(n) || n < o.minPlayers || n > o.maxPlayers) return { ok: false, reason: 'player-count' };
  const starts = o.chainCount === undefined ? [...Array(n).keys()] : [0, Math.floor(n / 2)].slice(0, o.chainCount);
  const exclude = o.exclude ?? [];
  const picked = pickWords(o, starts.length, exclude, o.rng);
  if (!picked.ok) return picked;
  const steps = stepCount(n);
  const chains = starts.map((startSlot, idx) => ({
    idx,
    startSlot,
    word: picked.words[idx]!,
    entries: Array.from({ length: steps }, (_, s): Entry => ({
      step: s,
      kind: kindOf(s),
      bySlot: assignee(startSlot, s, n),
      status: 'pending',
    })),
  }));
  const used = [...(picked.reset ? [] : exclude), ...picked.words.map((w) => w.id)];
  return {
    ok: true,
    game: {
      mode: o.mode,
      order: o.chainCount === undefined ? 'lockstep' : 'sequential',
      playerCount: n,
      stepCount: steps,
      step: 0,
      chains,
      usedWordIds: used,
    },
  };
}

const turnCount = (g: Game) => (g.order === 'lockstep' ? g.stepCount : g.stepCount * g.chains.length);
export const isFinished = (g: Game): boolean => g.step >= turnCount(g);

/** 지금 차례에 제출을 받는 (체인,단계) 목록. */
export function openKeys(g: Game): EntryKey[] {
  if (isFinished(g)) return [];
  if (g.order === 'lockstep') return g.chains.map((c) => entryKey(c.idx, g.step));
  return [entryKey(Math.floor(g.step / g.stepCount), g.step % g.stepCount)];
}

const entryAt = (g: Game, key: string): Entry | undefined => {
  const k = parseKey(key);
  return k ? g.chains[k.chainIdx]?.entries[k.step] : undefined;
};

/** 단계 s 담당자가 볼 입력. 앞 단계가 결측(또는 빈 답)이면 더 앞으로, 끝은 제시어(B 는 뜻). */
export function inputFor(chain: Chain, step: number, mode: Mode): Input {
  for (let k = step - 1; k >= 0; k--) {
    const e = chain.entries[k]!;
    if (e.status !== 'done') continue;
    const note = k < step - 1 ? { fallbackNote: true as const } : {};
    if (e.kind === 'draw') return { kind: 'image', imgId: e.imgId, ...note };
    if (e.text) return { kind: 'text', text: e.text, ...note };
  }
  const note = step > 0 ? { fallbackNote: true as const } : {};
  return mode === 'A' ? { kind: 'text', text: chain.word.text, ...note } : { kind: 'meaning', text: chain.word.meaning, ...note };
}

const replaceEntry = (g: Game, key: string, next: Entry): Game => {
  const k = parseKey(key)!;
  return {
    ...g,
    chains: g.chains.map((c) =>
      c.idx === k.chainIdx ? { ...c, entries: c.entries.map((e) => (e.step === k.step ? next : e)) } : c,
    ),
  };
};

export type Payload = { imgId: string } | { text: string };

/** 제출 적용. 지금 차례가 아니거나 담당 slot 이 아니면 실패. 이미 처리된 칸(done/missing)이면 무시(ignored, 같은 game). */
export function applySubmission(
  g: Game,
  key: string,
  bySlot: number,
  payload: Payload,
): { ok: true; game: Game; ignored: boolean } | Fail {
  const e = entryAt(g, key);
  if (!e || !openKeys(g).includes(key as EntryKey)) return { ok: false, reason: 'not-current' };
  if (e.bySlot !== bySlot) return { ok: false, reason: 'not-assignee' };
  if (e.status !== 'pending') return { ok: true, game: g, ignored: true };
  if (e.kind === 'draw') {
    if (!('imgId' in payload) || !payload.imgId) return { ok: false, reason: 'bad-payload' };
    return { ok: true, game: replaceEntry(g, key, { ...e, status: 'done', imgId: payload.imgId }), ignored: false };
  }
  if (!('text' in payload) || typeof payload.text !== 'string') return { ok: false, reason: 'bad-payload' };
  return { ok: true, game: replaceEntry(g, key, { ...e, status: 'done', text: payload.text.trim() }), ignored: false };
}

/** 미도착 처리. pending 만 바꾸고 done·missing 은 그대로. */
export function markMissing(g: Game, key: string): Game {
  const e = entryAt(g, key);
  return e && e.status === 'pending' ? replaceEntry(g, key, { ...e, status: 'missing' }) : g;
}

export const isStepComplete = (g: Game): boolean =>
  openKeys(g).every((k) => entryAt(g, k)!.status !== 'pending');

/** 지금 차례가 끝났으면 다음 차례로. 아니면 같은 game. */
export const advance = (g: Game): Game => (!isFinished(g) && isStepComplete(g) ? { ...g, step: g.step + 1 } : g);

export type ReviewPage =
  | { chainIdx: number; kind: 'prompt'; text: string } // A: 속담 원문, B: 뜻만
  | { chainIdx: number; kind: 'draw' | 'guess'; entry: Entry; empty: boolean } // empty: 빈 답 제출('답 없음')
  | { chainIdx: number; kind: 'card'; word: Word };

/** 체인별 prompt → entries… → card. 장 수 = 체인 수 × (stepCount + 2). */
export function reviewPages(g: Game): ReviewPage[] {
  return g.chains.flatMap((c): ReviewPage[] => [
    { chainIdx: c.idx, kind: 'prompt', text: g.mode === 'A' ? c.word.text : c.word.meaning },
    ...c.entries.map((e) => ({
      chainIdx: c.idx,
      kind: e.kind,
      entry: e,
      empty: e.kind === 'guess' && e.status === 'done' && !e.text,
    })),
    { chainIdx: c.idx, kind: 'card', word: c.word },
  ]);
}

export type Candidate = { key: EntryKey; entry: Entry };

/** 투표 후보 — 제출된(done) 그림·비어 있지 않은 답. slot 본인 것은 뺀다. */
export function voteCandidates(g: Game, slot: number): { drawings: Candidate[]; answers: Candidate[] } {
  const all = g.chains.flatMap((c) => c.entries.map((e) => ({ key: entryKey(c.idx, e.step), entry: e })));
  const ok = (x: Candidate) =>
    x.entry.status === 'done' && x.entry.bySlot !== slot && (x.entry.kind === 'draw' ? !!x.entry.imgId : !!x.entry.text);
  return {
    drawings: all.filter((x) => x.entry.kind === 'draw' && ok(x)),
    answers: all.filter((x) => x.entry.kind === 'guess' && ok(x)),
  };
}

export type Vote = { drawing: EntryKey; answer: EntryKey };
export type Votes = Record<number, Vote | 'abstain'>;
export type TallyResult = {
  bestDrawings: EntryKey[];
  bestAnswers: EntryKey[];
  drawingCounts: Record<string, number>;
  answerCounts: Record<string, number>;
};

/** 집계. 기권·자기 것·후보가 아닌 칸에 던진 표는 무효. 최다 득표 동점은 전부, 표 0 이면 빈 배열. */
export function tally(votes: Votes, g: Game): TallyResult {
  const { drawings, answers } = voteCandidates(g, -1);
  const count = (cands: Candidate[], pick: (v: Vote) => string) => {
    const owner = new Map(cands.map((c) => [c.key as string, c.entry.bySlot]));
    const counts: Record<string, number> = {};
    for (const [voter, v] of Object.entries(votes)) {
      if (v === 'abstain') continue;
      const key = pick(v);
      const by = owner.get(key);
      if (by === undefined || by === Number(voter)) continue;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const max = Math.max(0, ...Object.values(counts));
    return { counts, best: max === 0 ? [] : (Object.keys(counts).filter((k) => counts[k] === max) as EntryKey[]) };
  };
  const d = count(drawings, (v) => v.drawing);
  const a = count(answers, (v) => v.answer);
  return { bestDrawings: d.best, bestAnswers: a.best, drawingCounts: d.counts, answerCounts: a.counts };
}
