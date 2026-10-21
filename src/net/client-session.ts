// 학생 세션 — 방장이 보내는 뷰를 들고 입력만 올린다. 스스로 장을 넘기거나 판정하지 않는다.
import type { EntryKey, ReviewPage } from '../engine';
import { clearSession, loadSession, saveSession } from '../storage/session';
import { Assembler, base64ToBlob, blobToBase64, split } from './chunks';
import { hostPeerId, isRoomCode, randomId } from './peer-id';
import {
  CLIENT_SILENCE_MS,
  isMsg,
  PING_MS,
  V,
  type CandidateKeys,
  type EndReason,
  type LobbyPlayer,
  type Phase,
  type RejectReason,
  type Settings,
  type SyncState,
  type ToClient,
  type ToHost,
  type Turn,
  type VoteResult,
} from './protocol';
import type { Conn, Network } from './transport';

export type ClientView = {
  phase: Phase | 'connecting';
  slot: number | null;
  settings: Settings | null;
  players: LobbyPlayer[];
  /** 지금 내 칸(이 학생 몫만). deadlineAt 은 방장 시계 — 남은 시간은 remainingMs(). */
  cell: Turn | null;
  submitted: boolean;
  submitError: 'too-large' | null;
  waiting: { submitted: number; total: number } | null;
  pages: ReviewPage[];
  /** 방장이 보낸 현재 장. 학생 쪽에서 바꾸지 않는다. */
  page: number;
  candidates: CandidateKeys | null;
  voted: boolean;
  result: VoteResult | null;
  /** lost = 방장 응답 없음·연결 끊김(본인 와이파이일 수도 — 세션 키를 남겨 이어하기 가능). left = 내가 나감. */
  ended: EndReason | 'lost' | 'left' | null;
};

export type JoinResult = { ok: true } | { ok: false; reason: RejectReason | 'lost' | 'no-room' | 'no-session' | string };

type Opts = {
  pid: string;
  /** 학생 기기만 세션 키를 저장한다. 방장 기기 자신의 참가자는 null. */
  persist?: { roomCode: string; hostPeerId: string } | null;
  now?: () => number;
  /** 정리 때 함께 닫을 것(학생 peer). */
  onDispose?: () => void;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

const initial = (): ClientView => ({
  phase: 'connecting',
  slot: null,
  settings: null,
  players: [],
  cell: null,
  submitted: false,
  submitError: null,
  waiting: null,
  pages: [],
  page: 0,
  candidates: null,
  voted: false,
  result: null,
  ended: null,
});

export class ClientSession {
  view: ClientView = initial();
  /** 그리기 기한이 되면 부른다 — UI 가 캔버스를 내보내 submitDrawing 한다. */
  onAutoSubmit?: () => void;
  onHostLost?: () => void;

  private images = new Map<string, Blob>();
  private assembler = new Assembler((id, b64) => {
    this.images.set(id, base64ToBlob(b64));
    this.emit();
  });
  private offsets: number[] = [];
  private lastHeard: number;
  private silence: ReturnType<typeof setInterval>;
  private autoTimer: ReturnType<typeof setTimeout> | undefined;
  private pending: ((r: JoinResult) => void) | null = null;
  private disposed = false;
  private subs = new Set<(v: ClientView) => void>();
  private now: () => number;

  constructor(
    private conn: Conn,
    private o: Opts,
  ) {
    this.now = o.now ?? Date.now;
    this.lastHeard = this.now();
    conn.onData((m) => this.onMsg(m));
    conn.onClose(() => this.lost());
    this.silence = setInterval(() => {
      if (this.now() - this.lastHeard > CLIENT_SILENCE_MS) this.lost();
    }, PING_MS);
  }

  get pid(): string {
    return this.o.pid;
  }

  subscribe(cb: (v: ClientView) => void): () => void {
    this.subs.add(cb);
    cb(this.view);
    return () => this.subs.delete(cb);
  }

  /** 받은 그림(그림 칸 입력·결과 장). 아직 덜 왔으면 undefined — 오면 뷰가 다시 나간다. */
  image(imgId: string): Blob | undefined {
    return this.images.get(imgId);
  }

  /** 방장 시계 기준 남은 시간(ms). 기한 없는 칸이면 null. */
  remainingMs(): number | null {
    const d = this.view.cell?.deadlineAt;
    return d == null ? null : d - (this.now() + median(this.offsets));
  }

  join(name: string): Promise<JoinResult> {
    return this.ask({ t: 'join', pid: this.o.pid, name });
  }

  rejoin(): Promise<JoinResult> {
    return this.ask({ t: 'rejoin', pid: this.o.pid });
  }

  async submitDrawing(blob: Blob): Promise<void> {
    const t = this.view.cell;
    if (this.view.phase !== 'play' || t?.kind !== 'draw' || this.view.submitted) return;
    this.set({ submitted: true, submitError: null });
    const b64 = await blobToBase64(blob);
    if (this.view.cell !== t || this.disposed) return; // 그사이 단계가 바뀜
    const imgId = randomId(16);
    this.send({ t: 'submit-draw', chainIdx: t.chainIdx, step: t.step, imgId, mime: blob.type, bytes: blob.size });
    for (const c of split(imgId, b64)) this.send({ t: 'chunk', ...c });
  }

  submitGuess(text: string): void {
    const t = this.view.cell;
    if (this.view.phase !== 'play' || t?.kind !== 'guess' || this.view.submitted) return;
    this.set({ submitted: true });
    this.send({ t: 'submit-guess', chainIdx: t.chainIdx, step: t.step, text });
  }

  vote(drawing: EntryKey | null, answer: EntryKey | null): void {
    if (this.view.phase !== 'vote' || this.view.voted) return;
    this.set({ voted: true });
    this.send({ t: 'vote', drawing, answer });
  }

  leave(): void {
    if (this.disposed) return;
    this.send({ t: 'leave' });
    if (this.o.persist) clearSession();
    this.set({ phase: 'ended', ended: 'left' });
    this.dispose();
  }

  // ── 내부 ─────────────────────────────────────────────────────

  private ask(m: ToHost): Promise<JoinResult> {
    return new Promise((resolve) => {
      this.pending = resolve;
      this.send(m);
    });
  }

  private settle(r: JoinResult): void {
    this.pending?.(r);
    this.pending = null;
  }

  private onMsg(m: unknown): void {
    if (this.disposed || !isMsg(m) || m.v !== V) return;
    this.lastHeard = this.now();
    this.apply(m as unknown as ToClient);
  }

  private apply(m: ToClient): void {
    switch (m.t) {
      case 'joined':
        if (this.o.persist) saveSession({ ...this.o.persist, pid: this.o.pid }, this.now());
        this.set({ slot: m.slot, settings: m.settings, phase: this.view.phase === 'connecting' ? 'lobby' : this.view.phase });
        return this.settle({ ok: true });
      case 'rejected':
        if (m.reason === 'too-large') return this.set({ submitted: false, submitError: 'too-large' });
        if (this.o.persist && (m.reason === 'unknown' || m.reason === 'ended')) clearSession();
        this.settle({ ok: false, reason: m.reason });
        this.set({ phase: 'ended', ended: null });
        return this.dispose();
      case 'lobby':
        return this.set({ players: m.players, slot: m.you });
      case 'step':
        this.sample(m.hostNow);
        this.set({ phase: 'play', cell: { step: m.step, kind: m.kind, chainIdx: m.chainIdx, input: m.input, deadlineAt: m.deadlineAt }, submitted: false, submitError: null });
        return this.armAuto();
      case 'waiting':
        return this.set({ waiting: { submitted: m.submitted, total: m.total } });
      case 'review-preload':
        return this.set({ pages: m.pages });
      case 'show':
        clearTimeout(this.autoTimer);
        return this.set({ phase: 'review', page: m.page, cell: null });
      case 'vote-open':
        return this.set({ phase: 'vote', candidates: m.candidates, voted: false });
      case 'vote-result':
        return this.set({ phase: 'vote-result', result: { bestDrawings: m.bestDrawings, bestAnswers: m.bestAnswers } });
      case 'again':
        this.images.clear();
        this.assembler.clear();
        clearTimeout(this.autoTimer);
        return this.set({ phase: 'play', cell: null, submitted: false, waiting: null, pages: [], page: 0, candidates: null, voted: false, result: null });
      case 'ended':
        if (this.o.persist) clearSession();
        this.set({ phase: 'ended', ended: m.reason });
        return this.dispose();
      case 'ping':
        this.sample(m.hostNow);
        return this.send({ t: 'pong' });
      case 'sync':
        this.sample(m.hostNow);
        this.applySync(m.state);
        return this.settle({ ok: true });
      case 'chunk':
        return this.assembler.add(m);
    }
  }

  private applySync(s: SyncState): void {
    const { slot, settings, players, cell, submitted, waiting, pages, page, candidates, voted, result, phase } = s;
    this.set({ phase, slot, settings, players, cell, submitted, waiting, pages, page, candidates, voted, result, submitError: null });
    this.armAuto();
  }

  private armAuto(): void {
    clearTimeout(this.autoTimer);
    const t = this.view.cell;
    const left = this.remainingMs();
    if (t?.kind !== 'draw' || left === null || this.view.submitted) return;
    this.autoTimer = setTimeout(() => {
      if (this.view.cell === t && !this.view.submitted) this.onAutoSubmit?.();
    }, Math.max(0, left));
  }

  /** 시계 보정: offset = hostNow − 내 시계, 최근 5개 중앙값. */
  private sample(hostNow: number): void {
    this.offsets.push(hostNow - this.now());
    if (this.offsets.length > 5) this.offsets.shift();
  }

  private lost(): void {
    if (this.disposed) return;
    this.settle({ ok: false, reason: 'lost' });
    this.set({ phase: 'ended', ended: 'lost' });
    this.dispose();
    this.onHostLost?.();
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.silence);
    clearTimeout(this.autoTimer);
    this.assembler.clear();
    this.conn.close();
    this.o.onDispose?.();
  }

  private send(m: ToHost): void {
    if (!this.disposed) this.conn.send({ ...m, v: V });
  }

  private set(p: Partial<ClientView>): void {
    this.view = { ...this.view, ...p };
    for (const cb of this.subs) cb(this.view);
  }

  private emit(): void {
    this.set({});
  }
}

/** 방 들어가기(학생 기기). 새 pid 를 만들고 joined 면 세션 키를 저장한다. */
export async function joinRoom(o: { network: Network; code: string; name: string; now?: () => number }): Promise<
  { ok: true; client: ClientSession } | { ok: false; reason: string }
> {
  if (!isRoomCode(o.code)) return { ok: false, reason: 'code' };
  return connectAnd(o.network, hostPeerId(o.code), o.code, randomId(), (c) => c.join(o.name), o.now);
}

/** 이어하기 — 저장된 세션 키로 rejoin. 방이 없거나 거부되면 세션 키를 지운다. */
export async function resumeRoom(o: { network: Network; now?: () => number }): Promise<
  { ok: true; client: ClientSession } | { ok: false; reason: string }
> {
  const s = loadSession(o.now?.());
  if (!s) return { ok: false, reason: 'no-session' };
  const r = await connectAnd(o.network, s.hostPeerId, s.roomCode, s.pid, (c) => c.rejoin(), o.now);
  if (!r.ok && r.reason !== 'lost') clearSession();
  return r;
}

async function connectAnd(
  network: Network,
  hostId: string,
  roomCode: string,
  pid: string,
  first: (c: ClientSession) => Promise<JoinResult>,
  now?: () => number,
): Promise<{ ok: true; client: ClientSession } | { ok: false; reason: string }> {
  let ep;
  try {
    ep = await network.open(randomId());
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  let conn: Conn;
  try {
    conn = await ep.connect(hostId);
  } catch (e) {
    ep.destroy();
    const m = (e as Error).message;
    return { ok: false, reason: m === 'peer-unavailable' ? 'no-room' : m };
  }
  const client = new ClientSession(conn, { pid, persist: { roomCode, hostPeerId: hostId }, now, onDispose: () => ep.destroy() });
  const r = await first(client);
  return r.ok ? { ok: true, client } : r;
}
