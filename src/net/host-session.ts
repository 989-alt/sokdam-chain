// 방장 세션 — 판의 권위 상태(PRD §7.2). 학생에겐 자기 칸 몫의 뷰만 보낸다(원 제시어·다른 체인 누설 방지).
// 방장 자신도 참가자다: connPair 로 이어진 ClientSession(me)이 slot 0 으로 들어온다.
import { filter } from '../data/filter';
import {
  advance,
  applySubmission,
  createGame,
  entryKey,
  inputFor,
  isFinished,
  isStepComplete,
  kindOf,
  markMissing,
  openKeys,
  parseKey,
  reviewPages,
  tally,
  voteCandidates,
  type EntryKey,
  type Game,
  type ReviewPage,
  type Rng,
  type Votes,
  type Word,
} from '../engine';
import { ASSEMBLE_MS, Assembler, sniffMime, split } from './chunks';
import { ClientSession } from './client-session';
import { connPair } from './loopback';
import { hostPeerId, randomId, randomRoomCode } from './peer-id';
import {
  ABSENT_MS,
  DRAW_GRACE_MS,
  HOST_SILENCE_MS,
  isMsg,
  MAX_IMG_BYTES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PING_MS,
  V,
  type CandidateKeys,
  type LobbyPlayer,
  type Phase,
  type RejectReason,
  type Settings,
  type SyncState,
  type ToClient,
  type Turn,
  type VoteResult,
} from './protocol';
import type { Conn, Endpoint, Network } from './transport';

export const MAX_NAME = 20; // 신뢰 경계 상한(계약에 값 없음 — 보고서 참조)
export const MAX_ANSWER = 100;
const REGISTER_TRIES = 5;
const FLUSH_MS = 200;

type Incoming = { slot: number; key: EntryKey; timer: ReturnType<typeof setTimeout> };

type Player = {
  pid: string;
  slot: number;
  name: string;
  connected: boolean;
  lastSeenAt: number;
  disconnectedAt: number | null;
  conn: Conn | null;
  sentImgs: Set<string>;
};

export type HostView = {
  code: string;
  phase: Phase;
  settings: Settings;
  players: LobbyPlayer[];
  canStart: boolean;
  step: number | null;
  stepCount: number | null;
  deadlineAt: number | null;
  submitted: number;
  total: number;
  page: number;
  pageCount: number;
  voted: number;
  result: VoteResult | null;
};

export type HostOptions = {
  network: Network;
  settings: Settings;
  pool: readonly Word[];
  teacher?: readonly Word[];
  /** 방장 자신의 참가 이름(필터 거침). */
  hostName: string;
  rng?: Rng;
  now?: () => number;
};

const isPid = (x: unknown): x is string => typeof x === 'string' && /^[a-z0-9]{16,32}$/.test(x);
const isKeyOrNull = (x: unknown): x is EntryKey | null => x === null || (typeof x === 'string' && parseKey(x) !== null);
const keysOf = (c: ReturnType<typeof voteCandidates>): CandidateKeys => ({
  drawings: c.drawings.map((x) => x.key),
  answers: c.answers.map((x) => x.key),
});

export class HostSession {
  private phase: Phase = 'lobby';
  private players: Player[] = [];
  private game: Game | null = null;
  private usedWordIds: string[] = [];
  private images = new Map<string, string>(); // 방장 imgId → base64
  private round = 0;
  private turnStartedAt = 0;
  private deadlineAt: number | null = null;
  private pages: ReviewPage[] = [];
  private page = 0;
  private votes: Votes = {};
  private result: VoteResult | null = null;
  private drawTimer: ReturnType<typeof setTimeout> | undefined;
  private reviewTimer: ReturnType<typeof setTimeout> | undefined;
  private absent = new Map<number, ReturnType<typeof setTimeout>>();
  private ping: ReturnType<typeof setInterval>;
  /** `${pid}:${학생 imgId}`(≤ 32+1+31 = 64자, isChunk 상한) → 받는 중인 그림의 칸. timer = 헤더부터 10초. */
  private incoming = new Map<string, Incoming>();
  private assembler = new Assembler(
    (id, b64) => this.onImage(id, b64),
    (id) => this.dropIncoming(id, 'bad-image'),
  );
  private onUnload = () => this.leave();
  private subs = new Set<(v: HostView) => void>();
  private now: () => number;
  private rng: Rng;

  constructor(
    private ep: Endpoint,
    readonly code: string,
    private o: HostOptions,
  ) {
    this.now = o.now ?? Date.now;
    this.rng = o.rng ?? Math.random;
    ep.onConnection((c) => this.accept(c));
    this.ping = setInterval(() => this.tick(), PING_MS);
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onUnload);
      window.addEventListener('beforeunload', this.onUnload);
    }
  }

  // ── UI 가 부르는 것 ──────────────────────────────────────────

  get view(): HostView {
    const g = this.game;
    const keys = g && this.phase === 'play' ? openKeys(g) : [];
    return {
      code: this.code,
      phase: this.phase,
      settings: this.o.settings,
      players: this.lobbyList(),
      canStart: this.phase === 'lobby' && this.players.length >= MIN_PLAYERS && this.players.length <= MAX_PLAYERS,
      step: g ? g.step : null,
      stepCount: g ? g.stepCount : null,
      deadlineAt: this.deadlineAt,
      submitted: keys.filter((k) => this.entry(k)!.status !== 'pending').length,
      total: keys.length,
      page: this.page,
      pageCount: this.pages.length,
      voted: Object.keys(this.votes).length,
      result: this.result,
    };
  }

  subscribe(cb: (v: HostView) => void): () => void {
    this.subs.add(cb);
    cb(this.view);
    return () => this.subs.delete(cb);
  }

  start(): { ok: true } | { ok: false; reason: string } {
    if (this.phase !== 'lobby') return { ok: false, reason: 'not-lobby' };
    return this.newGame();
  }

  /** 수동 결과 보기의 "다음". 타이머 모드에선 무시. */
  next(): boolean {
    if (this.phase !== 'review' || this.o.settings.review !== 'manual') return false;
    this.nextPage();
    return true;
  }

  /** 한 판 더 — 같은 방·같은 사람(끊긴 slot 유지)·새 제시어. 이전 판 이미지·답은 버린다. */
  again(): { ok: true } | { ok: false; reason: string } {
    if (this.phase !== 'vote-result') return { ok: false, reason: 'not-finished' };
    this.images.clear();
    for (const id of [...this.incoming.keys()]) this.dropIncoming(id);
    this.assembler.clear();
    for (const p of this.players) p.sentImgs.clear();
    this.broadcast({ t: 'again' });
    return this.newGame();
  }

  /** 방장 나가기·탭 닫힘. ended 를 best-effort 로 보내고 정리한다. */
  leave(): void {
    if (this.phase === 'ended') return;
    const reason = this.phase === 'vote-result' ? 'finished' : 'host-left';
    this.phase = 'ended';
    this.clearTurnTimers();
    clearTimeout(this.reviewTimer);
    clearInterval(this.ping);
    for (const id of [...this.incoming.keys()]) this.dropIncoming(id);
    this.assembler.clear();
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onUnload);
      window.removeEventListener('beforeunload', this.onUnload);
    }
    this.broadcast({ t: 'ended', reason });
    this.emit();
    setTimeout(() => {
      for (const p of this.players) p.conn?.close();
      this.ep.destroy();
    }, FLUSH_MS);
  }

  // ── 연결·메시지 ──────────────────────────────────────────────

  accept(conn: Conn): void {
    conn.onData((m) => {
      this.onMsg(conn, m);
      this.emit();
    });
    conn.onClose(() => {
      const p = this.playerOf(conn);
      if (!p) return;
      p.conn = null;
      this.setConnected(p, false);
      this.emit();
    });
  }

  private onMsg(conn: Conn, m: unknown): void {
    if (!isMsg(m)) return;
    if (m.v !== V) return this.reject(conn, 'version');
    const p = this.playerOf(conn);
    if (p) {
      p.lastSeenAt = this.now();
      this.setConnected(p, true);
    }
    if (m.t === 'join') return void (p || this.onJoin(conn, m.pid, m.name));
    if (m.t === 'rejoin') return void (p || this.onRejoin(conn, m.pid));
    if (!p) return;
    switch (m.t) {
      case 'submit-guess':
        return this.onGuess(p, m.chainIdx, m.step, m.text);
      case 'submit-draw':
        return this.onDrawHeader(p, m);
      case 'chunk':
        if (typeof m.imgId === 'string' && this.incoming.has(`${p.pid}:${m.imgId}`)) this.assembler.add({ ...m, imgId: `${p.pid}:${m.imgId}` });
        return;
      case 'vote':
        return this.onVote(p, m.drawing, m.answer);
      case 'leave':
        return this.onLeave(p);
    }
  }

  private onJoin(conn: Conn, pid: unknown, rawName: unknown): void {
    if (!isPid(pid) || typeof rawName !== 'string') return this.reject(conn, 'name');
    if (this.players.some((x) => x.pid === pid)) return this.onRejoin(conn, pid);
    if (this.phase === 'ended') return this.reject(conn, 'ended');
    if (this.phase !== 'lobby') return this.reject(conn, 'started');
    if (this.players.length >= MAX_PLAYERS) return this.reject(conn, 'full');
    const base = filter([...rawName.trim()].slice(0, MAX_NAME).join(''));
    if (!base) return this.reject(conn, 'name');
    let name = base;
    for (let k = 2; this.players.some((x) => x.name === name); k++) name = `${base} (${k})`;
    const p: Player = { pid, slot: this.players.length, name, connected: true, lastSeenAt: this.now(), disconnectedAt: null, conn, sentImgs: new Set() };
    this.players.push(p);
    this.send(p, { t: 'joined', pid, slot: p.slot, settings: this.o.settings });
    this.broadcastLobby();
  }

  private onRejoin(conn: Conn, pid: unknown): void {
    if (this.phase === 'ended') return this.reject(conn, 'ended');
    const p = this.players.find((x) => x.pid === pid);
    if (!p) return this.reject(conn, 'unknown');
    const old = p.conn;
    p.conn = conn; // 새 연결 채택 — 옛 연결의 close 는 playerOf 가 못 찾아 무시된다
    p.sentImgs = new Set();
    p.lastSeenAt = this.now();
    // 옛 연결로 받던 그림은 버린다 — 학생이 sync 를 받고 다시 제출한다
    for (const id of [...this.incoming.keys()]) if (id.startsWith(`${p.pid}:`)) this.dropIncoming(id);
    if (old && old !== conn) old.close();
    this.send(p, { t: 'joined', pid: p.pid, slot: p.slot, settings: this.o.settings });
    this.sendSync(p);
    if (p.connected) this.broadcastLobby();
    else this.setConnected(p, true);
  }

  private onLeave(p: Player): void {
    p.conn?.close();
    p.conn = null;
    if (this.phase === 'lobby') {
      this.players = this.players.filter((x) => x !== p);
      this.players.forEach((x, i) => (x.slot = i));
      this.broadcastLobby();
    } else this.setConnected(p, false);
  }

  private reject(conn: Conn, reason: RejectReason): void {
    conn.send({ t: 'rejected', reason, v: V });
    if (!this.playerOf(conn)) setTimeout(() => conn.close(), FLUSH_MS);
  }

  private tick(): void {
    const t = this.now();
    for (const p of this.players) {
      if (!p.conn) continue;
      this.send(p, { t: 'ping', hostNow: t });
      if (p.connected && t - p.lastSeenAt > HOST_SILENCE_MS) this.setConnected(p, false);
    }
    this.emit();
  }

  private setConnected(p: Player, on: boolean): void {
    if (p.connected === on) return;
    p.connected = on;
    p.disconnectedAt = on ? null : this.now();
    this.armAbsent(p);
    this.broadcastLobby();
  }

  // ── 판 진행 ──────────────────────────────────────────────────

  private newGame(): { ok: true } | { ok: false; reason: string } {
    const s = this.o.settings;
    const r = createGame({
      pool: this.o.pool,
      teacher: this.o.teacher,
      level: s.level,
      listSource: s.listSource,
      playerCount: this.players.length,
      mode: s.mode,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      exclude: this.usedWordIds,
      rng: this.rng,
    });
    if (!r.ok) return r;
    this.round++;
    this.game = r.game;
    this.usedWordIds = r.game.usedWordIds;
    this.votes = {};
    this.result = null;
    this.pages = [];
    this.page = 0;
    this.phase = 'play';
    this.startStep();
    this.emit();
    return { ok: true };
  }

  private startStep(): void {
    const g = this.game!;
    this.clearTurnTimers();
    this.turnStartedAt = this.now();
    this.deadlineAt = kindOf(g.step) === 'draw' ? this.turnStartedAt + this.o.settings.drawSeconds * 1000 : null;
    if (this.deadlineAt !== null) this.drawTimer = setTimeout(() => this.onDrawDeadline(), this.deadlineAt + DRAW_GRACE_MS - this.now());
    const last = g.step === g.stepCount - 1;
    for (const p of this.players) {
      if (last) this.sendPages(p, this.drawPages()); // 결과 미리 보내기 — 그림만(글은 원 제시어를 드러낸다)
      this.sendTurn(p);
      this.armAbsent(p);
    }
    this.broadcastWaiting();
  }

  private onDrawDeadline(): void {
    let g = this.game!;
    for (const k of openKeys(g)) g = markMissing(g, k);
    this.game = g;
    this.maybeAdvance();
    this.emit();
  }

  private maybeAdvance(): void {
    const g = this.game!;
    if (!isStepComplete(g)) return this.broadcastWaiting();
    this.game = advance(g);
    if (isFinished(this.game)) this.toReview();
    else this.startStep();
  }

  private onGuess(p: Player, chainIdx: unknown, step: unknown, text: unknown): void {
    if (this.phase !== 'play' || !Number.isInteger(chainIdx) || !Number.isInteger(step) || typeof text !== 'string') return;
    const r = applySubmission(this.game!, entryKey(chainIdx as number, step as number), p.slot, {
      text: filter([...text].slice(0, MAX_ANSWER).join('')),
    });
    if (!r.ok || r.ignored) return;
    this.game = r.game;
    this.maybeAdvance();
  }

  private onDrawHeader(p: Player, m: Record<string, unknown>): void {
    const { chainIdx, step, imgId, mime, bytes } = m;
    if (this.phase !== 'play' || !Number.isInteger(chainIdx) || !Number.isInteger(step)) return;
    if (typeof imgId !== 'string' || imgId.length < 1 || imgId.length > 31) return;
    const key = entryKey(chainIdx as number, step as number);
    const e = this.entry(key);
    if (!e || e.kind !== 'draw' || e.bySlot !== p.slot || e.status !== 'pending' || !openKeys(this.game!).includes(key)) return;
    if (typeof bytes !== 'number' || bytes > MAX_IMG_BYTES) return this.reject(p.conn!, 'too-large');
    if (mime !== 'image/webp' && mime !== 'image/png') return this.reject(p.conn!, 'bad-image');
    // 같은 칸을 받는 중이면(담당은 이 학생뿐) 새 제출로 갈아탄다 — 말없이 버리면 학생이 submitted 로 멈춘다
    for (const [id, x] of this.incoming) if (x.key === key) this.dropIncoming(id);
    const scoped = `${p.pid}:${imgId}`;
    this.incoming.set(scoped, { slot: p.slot, key, timer: setTimeout(() => this.dropIncoming(scoped, 'bad-image'), ASSEMBLE_MS) });
  }

  /** 받는 중인 그림을 버린다. reason 이 있고 그 칸이 아직 열려 있으면 학생에게 알려 다시 제출하게 한다. */
  private dropIncoming(scoped: string, reason?: RejectReason): void {
    const d = this.incoming.get(scoped);
    if (!d) return;
    clearTimeout(d.timer);
    this.incoming.delete(scoped);
    this.assembler.drop(scoped);
    const p = this.players.find((x) => x.slot === d.slot);
    const e = this.entry(d.key);
    if (reason && p?.conn && this.phase === 'play' && e?.status === 'pending' && openKeys(this.game!).includes(d.key)) this.reject(p.conn, reason);
    this.emit();
  }

  private onImage(scoped: string, b64: string): void {
    const d = this.incoming.get(scoped);
    if (!d) return;
    const bad = !sniffMime(b64) ? 'bad-image' : (b64.length * 3) / 4 > MAX_IMG_BYTES + 3 ? 'too-large' : undefined;
    this.dropIncoming(scoped, bad);
    if (bad || this.phase !== 'play') return;
    const k = parseKey(d.key)!;
    const imgId = `r${this.round}-${k.chainIdx}-${k.step}`;
    const r = applySubmission(this.game!, d.key, d.slot, { imgId });
    if (!r.ok || r.ignored) return;
    this.images.set(imgId, b64);
    this.game = r.game;
    this.maybeAdvance();
    this.emit();
  }

  private toReview(): void {
    this.clearTurnTimers();
    this.deadlineAt = null;
    this.pages = reviewPages(this.game!);
    this.page = 0;
    this.phase = 'review';
    for (const p of this.players) this.sendPages(p, this.pages);
    this.broadcast({ t: 'show', page: 0 });
    this.scheduleReview();
  }

  private scheduleReview(): void {
    clearTimeout(this.reviewTimer);
    if (this.o.settings.review === 'timer')
      this.reviewTimer = setTimeout(() => {
        this.nextPage();
        this.emit();
      }, this.o.settings.reviewSeconds * 1000);
  }

  private nextPage(): void {
    if (this.page + 1 >= this.pages.length) return this.openVote();
    this.page++;
    this.broadcast({ t: 'show', page: this.page });
    this.scheduleReview();
  }

  private openVote(): void {
    clearTimeout(this.reviewTimer);
    this.phase = 'vote';
    this.votes = {};
    this.turnStartedAt = this.now();
    for (const p of this.players) {
      this.send(p, { t: 'vote-open', candidates: keysOf(voteCandidates(this.game!, p.slot)) });
      this.armAbsent(p);
    }
  }

  private onVote(p: Player, drawing: unknown, answer: unknown): void {
    if (this.phase !== 'vote' || this.votes[p.slot] !== undefined || !isKeyOrNull(drawing) || !isKeyOrNull(answer)) return;
    this.votes[p.slot] = { drawing, answer }; // 자기 것·후보 아님은 tally 가 무효 처리
    this.armAbsent(p);
    this.maybeTally();
  }

  private maybeTally(): void {
    if (!this.players.every((p) => this.votes[p.slot] !== undefined)) return;
    const t = tally(this.votes, this.game!);
    this.result = { bestDrawings: t.bestDrawings, bestAnswers: t.bestAnswers };
    this.phase = 'vote-result';
    this.broadcast({ t: 'vote-result', ...this.result });
  }

  /** 끊긴 학생의 답 쓰기·투표 60초. 기산점 = max(끊긴 때, 차례 시작). 연결돼 있거나 기다릴 게 없으면 취소. */
  private armAbsent(p: Player): void {
    clearTimeout(this.absent.get(p.slot));
    this.absent.delete(p.slot);
    if (p.connected || p.disconnectedAt === null) return;
    const key = this.pendingKey(p.slot);
    const waitGuess = this.phase === 'play' && key !== null && kindOf(this.game!.step) === 'guess';
    const waitVote = this.phase === 'vote' && this.votes[p.slot] === undefined;
    if (!waitGuess && !waitVote) return;
    const at = Math.max(p.disconnectedAt, this.turnStartedAt) + ABSENT_MS;
    this.absent.set(
      p.slot,
      setTimeout(() => {
        this.absent.delete(p.slot);
        if (waitGuess) {
          this.game = markMissing(this.game!, key!);
          this.maybeAdvance();
        } else {
          this.votes[p.slot] = 'abstain';
          this.maybeTally();
        }
        this.emit();
      }, at - this.now()),
    );
  }

  private clearTurnTimers(): void {
    clearTimeout(this.drawTimer);
    for (const t of this.absent.values()) clearTimeout(t);
    this.absent.clear();
  }

  // ── 학생별 뷰 ────────────────────────────────────────────────

  private entry(key: string) {
    const k = parseKey(key);
    return k && this.game ? this.game.chains[k.chainIdx]?.entries[k.step] : undefined;
  }

  private pendingKey(slot: number): EntryKey | null {
    return this.game && this.phase === 'play' ? (openKeys(this.game).find((k) => this.entry(k)!.bySlot === slot && this.entry(k)!.status === 'pending') ?? null) : null;
  }

  private turnFor(slot: number): Turn | null {
    const g = this.game!;
    const key = openKeys(g).find((k) => this.entry(k)!.bySlot === slot);
    if (!key) return null;
    const { chainIdx, step } = parseKey(key)!;
    return { step, kind: kindOf(step), chainIdx, input: inputFor(g.chains[chainIdx]!, step, g.mode), deadlineAt: this.deadlineAt };
  }

  private sendTurn(p: Player): void {
    const t = this.turnFor(p.slot);
    if (!t || !p.conn) return;
    if (t.input.imgId) this.sendImage(p, t.input.imgId); // 순서 보장 채널 — 그림이 step 보다 먼저 닿는다
    this.send(p, { t: 'step', ...t, hostNow: this.now() });
  }

  private drawPages(): ReviewPage[] {
    return reviewPages(this.game!).filter((x) => x.kind === 'draw');
  }

  private sendPages(p: Player, pages: ReviewPage[]): void {
    if (!p.conn) return;
    for (const x of pages) if (x.kind === 'draw' && x.entry.imgId) this.sendImage(p, x.entry.imgId);
    this.send(p, { t: 'review-preload', pages });
  }

  private sendImage(p: Player, imgId: string): void {
    const data = this.images.get(imgId);
    if (!data || !p.conn || p.sentImgs.has(imgId)) return;
    p.sentImgs.add(imgId);
    for (const c of split(imgId, data)) this.send(p, { t: 'chunk', ...c });
  }

  private sendSync(p: Player): void {
    const g = this.game;
    const play = this.phase === 'play' && !!g;
    const cell = play ? this.turnFor(p.slot) : null;
    const results = this.phase === 'review' || this.phase === 'vote' || this.phase === 'vote-result';
    const pages = results ? this.pages : play && g.step === g.stepCount - 1 ? this.drawPages() : [];
    for (const x of pages) if (x.kind === 'draw' && x.entry.imgId) this.sendImage(p, x.entry.imgId);
    if (cell?.input.imgId) this.sendImage(p, cell.input.imgId);
    const v = this.view;
    const state: SyncState = {
      phase: this.phase,
      slot: p.slot,
      settings: this.o.settings,
      players: v.players,
      cell,
      submitted: cell ? this.entry(entryKey(cell.chainIdx, cell.step))!.status !== 'pending' : false,
      waiting: play ? { submitted: v.submitted, total: v.total } : null,
      pages,
      page: this.page,
      candidates: g && (this.phase === 'vote' || this.phase === 'vote-result') ? keysOf(voteCandidates(g, p.slot)) : null,
      voted: this.votes[p.slot] !== undefined,
      result: this.result,
    };
    this.send(p, { t: 'sync', state, hostNow: this.now() });
  }

  private lobbyList(): LobbyPlayer[] {
    return this.players.map((p) => ({ slot: p.slot, name: p.name, connected: p.connected }));
  }

  private broadcastLobby(): void {
    const players = this.lobbyList();
    for (const p of this.players) this.send(p, { t: 'lobby', players, you: p.slot });
  }

  private broadcastWaiting(): void {
    const v = this.view;
    this.broadcast({ t: 'waiting', submitted: v.submitted, total: v.total });
  }

  private broadcast(m: ToClient): void {
    for (const p of this.players) this.send(p, m);
  }

  private send(p: Player, m: ToClient): void {
    p.conn?.send({ ...m, v: V });
  }

  private playerOf(conn: Conn): Player | undefined {
    return this.players.find((p) => p.conn === conn);
  }

  private emit(): void {
    if (!this.subs.size) return;
    const v = this.view;
    for (const cb of this.subs) cb(v);
  }
}

/**
 * 방 만들기. 'sokdam-<6자리>' 등록이 unavailable-id 면 새 코드로 다시(전체 최대 5번).
 * 방장 자신은 me(ClientSession)로 slot 0 에 들어간다 — 기기 저장 없음.
 */
export async function createHost(
  o: HostOptions,
): Promise<{ ok: true; host: HostSession; me: ClientSession } | { ok: false; reason: string }> {
  let ep: Endpoint | null = null;
  let code = '';
  for (let i = 0; i < REGISTER_TRIES && !ep; i++) {
    code = randomRoomCode();
    try {
      ep = await o.network.open(hostPeerId(code));
    } catch (e) {
      const reason = (e as Error).message;
      if (reason !== 'unavailable-id') return { ok: false, reason };
    }
  }
  if (!ep) return { ok: false, reason: 'unavailable-id' };
  const host = new HostSession(ep, code, o);
  const [a, b] = connPair(hostPeerId(code), 'local');
  host.accept(a);
  const me = new ClientSession(b, { pid: randomId(), now: o.now });
  const r = await me.join(o.hostName);
  if (!r.ok) {
    host.leave();
    return r;
  }
  return { ok: true, host, me };
}
