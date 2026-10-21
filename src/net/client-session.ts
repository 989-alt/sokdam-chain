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
import type { Conn, Endpoint, Network } from './transport';

export type ClientView = {
  phase: Phase | 'connecting';
  slot: number | null;
  settings: Settings | null;
  players: LobbyPlayer[];
  /** 지금 내 칸(이 학생 몫만). deadlineAt 은 방장 시계 — 남은 시간은 remainingMs(). */
  cell: Turn | null;
  submitted: boolean;
  /** 방장이 그림을 못 받음 — submitted 가 false 로 돌아오니 다시 내보내 submitDrawing. */
  submitError: 'too-large' | 'bad-image' | null;
  waiting: { submitted: number; total: number } | null;
  pages: ReviewPage[];
  /** 방장이 보낸 현재 장. 학생 쪽에서 바꾸지 않는다. */
  page: number;
  candidates: CandidateKeys | null;
  voted: boolean;
  result: VoteResult | null;
  /**
   * host-left = 방장이 나감(ended 수신·다시 붙어 보니 방이 없음 → 키 삭제. 방장에게 P2P 가 두 번 안 열림 → 키 유지, 이어하기가 no-room 을 받으면 그때 삭제).
   * lost = 내 망 문제로 다시 못 붙음(키 유지, 이어하기 가능). left = 내가 나감.
   */
  ended: EndReason | 'lost' | 'left' | null;
  /** 끊겨서 스스로 다시 붙는 중. 보통 1초 안, 최악은 방장 망 끊김 약 15~20초·내 망 끊김 약 21초(보고서 수정 4차). 화면은 그대로 두고 "다시 연결하는 중" 정도만. */
  reconnecting: boolean;
};

export type JoinResult = { ok: true } | { ok: false; reason: RejectReason | 'lost' | 'no-room' | 'no-session' | string };

type Opts = {
  pid: string;
  /** 학생 기기만 세션 키를 저장한다. 방장 기기 자신의 참가자는 null. */
  persist?: { roomCode: string; hostPeerId: string } | null;
  now?: () => number;
  /** 정리 때 함께 닫을 것(학생 peer). */
  onDispose?: () => void;
  /** 끊기면 스스로 다시 붙을 곳. 없으면(방장 기기 자신) 끊김 = 바로 lost. */
  redial?: { network: Network; hostId: string };
};

// 끊긴 뒤 다시 붙기: 최대 3번, 내 망 실패 사이 3초. 연결 시도는 전송 기본값(15초)까지 기다린다 — 느린 ICE(STUN 만·혼합 기기)를 방장 없음으로 오판하지 않게.
// 시그널링은 되는데 방장에게 P2P 가 안 열리는 것(unreachable)이 침묵 뒤 두 번이면 방장이 떠난 것(망 끊김·잠듦 —
// PeerServer 는 죽은 방장을 60초 동안 등록된 채로 두어 peer-unavailable 이 오지 않는다). 직전까지 P2P 로 붙어 있었으니 내 쪽 P2P 탓일 가능성은 낮다.
// 그래도 확정은 아니라 세션 키는 남긴다 — 이어하기가 no-room 을 받으면 그때 지운다.
// 방장 peer 가 없다는 답(peer-unavailable) 한 번이면 방장이 떠난 것: PeerServer 는 없는 peer 앞 offer 를
// expire_timeout(5초) 동안 쥐고 있다가 EXPIRE 로 답하므로, 그 답 자체가 "5초 넘게 등록이 없었다"는 뜻이다.
export const REDIAL_TRIES = 3;
export const REDIAL_GAP_MS = 3000;
/** ping 이 이만큼 끊기면 연결은 그대로 둔 채 시그널링에 방장 peer 가 아직 있는지 물어본다(말없이 사라진 방장을 10초보다 빨리 알기). */
export const PROBE_AFTER_MS = 2000;
/** 확인(probe)만 짧게 기다린다 — 답이 없어도 10초 규칙의 다시 붙기가 뒤따른다. */
export const PROBE_CONNECT_MS = 6000;
export const UNREACHABLE_LIMIT = 2;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 방장에게 새 연결. 'no-room' = 시그널링이 방장 peer 없음이라고 답함, 'net' = 내 시그널링이 안 열림·연결 중 끊김(내 망 문제 —
 * PeerJS 의 network·socket-error·socket-closed·server-error·disconnected), 'unreachable' = 시그널링은 되는데 방장에게 P2P 가 안 열림(timeout·ICE 실패).
 */
async function dial(network: Network, hostId: string, timeoutMs?: number): Promise<{ ep: Endpoint; conn: Conn } | 'no-room' | 'net' | 'unreachable'> {
  let ep: Endpoint;
  try {
    ep = await network.open(randomId());
  } catch {
    return 'net';
  }
  try {
    return { ep, conn: await ep.connect(hostId, timeoutMs) };
  } catch (e) {
    ep.destroy();
    const why = (e as Error).message;
    return why === 'peer-unavailable' ? 'no-room' : why === 'timeout' || why === 'connect-failed' ? 'unreachable' : 'net';
  }
}

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
  reconnecting: false,
});

export class ClientSession {
  view: ClientView = initial();
  /** 그리기 기한이 되면 부른다 — UI 가 캔버스를 내보내 submitDrawing 한다. */
  onAutoSubmit?: () => void;
  onHostLost?: () => void;

  private images = new Map<string, Blob>();
  private assembler = new Assembler((id, b64) => {
    try {
      this.images.set(id, base64ToBlob(b64));
    } catch {
      return; // 깨진 base64 — 그림 없이 진행
    }
    this.emit();
  });
  private offsets: number[] = [];
  private lastHeard: number;
  private silence: ReturnType<typeof setInterval>;
  private autoTimer: ReturnType<typeof setTimeout> | undefined;
  private pending: ((r: JoinResult) => void) | null = null;
  /** rejoin 은 joined 가 아니라 첫 sync 에서 끝난다(대기실이 잠깐 비치지 않게). */
  private rejoining = false;
  private disposed = false;
  private redialing = false;
  /** 다시 붙기 시도 수 — 방장 메시지를 하나라도 받으면 0. 붙어도 방장이 말이 없으면(멈춘 탭) 계속 센다. */
  private tries = 0;
  /** 다시 붙는 중에 한 제출 — 재합류 sync 가 같은 칸을 미제출로 주면 그때 보낸다. */
  private queued: { chainIdx: number; step: number; deadlineAt: number | null; run: () => void } | null = null;
  /** 다시 붙는 중에 한 투표 — 재합류 sync 가 아직 투표 중·미투표면 그때 보낸다. */
  private queuedVote: (() => void) | null = null;
  private probedFor = -1; // 이 lastHeard 에 대해 이미 물어봤으면 다시 안 묻는다
  /** 마지막으로 방장 소식을 들은 뒤 unreachable 횟수(확인·다시 붙기 합산). */
  private unreachable = 0;
  private subs = new Set<(v: ClientView) => void>();
  private now: () => number;

  constructor(
    private conn: Conn,
    private o: Opts,
  ) {
    this.now = o.now ?? Date.now;
    this.lastHeard = this.now();
    this.attach(conn);
    this.silence = setInterval(() => {
      const quiet = this.now() - this.lastHeard;
      if (quiet > CLIENT_SILENCE_MS) this.lost();
      else if (quiet > PROBE_AFTER_MS && this.o.redial && !this.redialing && this.probedFor !== this.lastHeard) void this.probe(this.o.redial);
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
    this.rejoining = true;
    return this.ask({ t: 'rejoin', pid: this.o.pid });
  }

  async submitDrawing(blob: Blob): Promise<void> {
    const t = this.view.cell;
    if (this.view.phase !== 'play' || t?.kind !== 'draw' || this.view.submitted) return;
    const again = () => void this.submitDrawing(blob);
    if (this.hold(t, again)) return;
    this.set({ submitted: true, submitError: null });
    const b64 = await blobToBase64(blob);
    if (this.view.cell !== t || this.disposed) return; // 그사이 단계가 바뀜
    if (this.hold(t, again)) return this.set({ submitted: false });
    const imgId = randomId(16);
    this.send({ t: 'submit-draw', chainIdx: t.chainIdx, step: t.step, imgId, mime: blob.type, bytes: blob.size });
    for (const c of split(imgId, b64)) this.send({ t: 'chunk', ...c });
  }

  submitGuess(text: string): void {
    const t = this.view.cell;
    if (this.view.phase !== 'play' || t?.kind !== 'guess' || this.view.submitted) return;
    if (this.hold(t, () => this.submitGuess(text))) return;
    this.set({ submitted: true });
    this.send({ t: 'submit-guess', chainIdx: t.chainIdx, step: t.step, text });
  }

  vote(drawing: EntryKey | null, answer: EntryKey | null): void {
    if (this.view.phase !== 'vote' || this.view.voted) return;
    if (this.redialing || this.rejoining) return void (this.queuedVote = () => this.vote(drawing, answer));
    this.set({ voted: true });
    this.send({ t: 'vote', drawing, answer });
  }

  leave(): void {
    if (this.disposed) return;
    if (!this.redialing) this.send({ t: 'leave' }); // 다시 붙는 중이면 열린 연결이 없다 — 방장은 끊김으로 처리
    if (this.o.persist) clearSession();
    this.set({ phase: 'ended', ended: 'left' });
    this.dispose();
  }

  /** 연결만 닫는다 — 방장에게 leave 를 보내지 않고 세션 키도 남긴다(이어하기가 상한 뒤에 늦게 붙었을 때). */
  close(): void {
    this.dispose();
  }

  // ── 내부 ─────────────────────────────────────────────────────

  /** 연결이 닫혀 있거나 재합류 sync 전이면 제출을 미룬다(닫힌 채널로 보내 말없이 잃지 않게). */
  private hold(t: Turn, run: () => void): boolean {
    if (!this.redialing && !this.rejoining) return false;
    this.queued = { chainIdx: t.chainIdx, step: t.step, deadlineAt: t.deadlineAt, run };
    return true;
  }

  private asked: ToHost | null = null;

  private ask(m: ToHost): Promise<JoinResult> {
    return new Promise((resolve) => {
      this.pending = resolve;
      this.asked = m;
      this.send(m);
    });
  }

  private attach(conn: Conn): void {
    this.conn = conn;
    this.lastHeard = this.now();
    conn.onData((m) => this.conn === conn && this.onMsg(m));
    conn.onClose(() => this.conn === conn && this.lost());
  }

  private settle(r: JoinResult): void {
    this.pending?.(r);
    this.pending = null;
    this.asked = null;
  }

  private onMsg(m: unknown): void {
    if (this.disposed || !isMsg(m) || m.v !== V) return;
    this.lastHeard = this.now();
    this.tries = 0;
    this.unreachable = 0;
    this.apply(m as unknown as ToClient);
  }

  private apply(m: ToClient): void {
    switch (m.t) {
      case 'joined':
        if (this.o.persist) saveSession({ ...this.o.persist, pid: this.o.pid }, this.now());
        if (this.rejoining) return this.set({ slot: m.slot, settings: m.settings });
        this.set({ slot: m.slot, settings: m.settings, phase: this.view.phase === 'connecting' ? 'lobby' : this.view.phase });
        return this.settle({ ok: true });
      case 'rejected':
        if (m.reason === 'too-large' || m.reason === 'bad-image') {
          if (this.view.phase === 'play' && this.view.cell?.kind === 'draw') this.set({ submitted: false, submitError: m.reason });
          return;
        }
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
        this.rejoining = false; // 먼저 — applySync 가 미룬 제출을 보낸다
        this.applySync(m.state);
        return this.settle({ ok: true });
      case 'chunk':
        return this.assembler.add(m);
    }
  }

  private applySync(s: SyncState): void {
    const { slot, settings, players, submitted, waiting, pages, page, candidates, voted, result, phase } = s;
    // 같은 칸이면 옛 cell 객체를 그대로 둔다 — 화면이 다시 마운트되지 않아 그리던 그림이 남는다.
    // 단 보낸 제출을 방장이 못 받았으면(submitted true→false) 다시 마운트해 화면이 다시 제출할 수 있게 한다.
    const cur = this.view.cell;
    const lostSubmit = this.view.submitted && !submitted;
    const same = !lostSubmit && !!cur && !!s.cell && cur.chainIdx === s.cell.chainIdx && cur.step === s.cell.step && cur.deadlineAt === s.cell.deadlineAt;
    const cell = same ? cur : s.cell;
    this.set({ phase, slot, settings, players, cell, submitted, waiting, pages, page, candidates, voted, result, submitError: null });
    const q = this.queued;
    this.queued = null;
    if (q && cell && phase === 'play' && !submitted && q.chainIdx === cell.chainIdx && q.step === cell.step && q.deadlineAt === cell.deadlineAt) q.run();
    const qv = this.queuedVote;
    this.queuedVote = null;
    if (qv && phase === 'vote' && !voted) qv();
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
    if (this.disposed || this.redialing) return;
    if (this.o.redial) return void this.redial(this.o.redial);
    this.finish('lost');
  }

  /** 끊김 뒤 다시 붙기. 붙으면 같은 pid 로 rejoin(입장 중이었으면 join 다시) → 방장 sync 로 이어감. */
  private async redial(r: { network: Network; hostId: string }): Promise<void> {
    this.redialing = true;
    this.set({ reconnecting: true });
    this.conn.close();
    this.o.onDispose?.();
    let wait = false;
    for (; this.tries < REDIAL_TRIES; this.tries++) {
      if (wait) await sleep(REDIAL_GAP_MS);
      if (this.disposed) return;
      const d = await dial(r.network, r.hostId);
      if (this.disposed) return void (typeof d === 'object' && d.ep.destroy());
      if (d === 'no-room') return this.finish('host-left');
      if (d === 'unreachable' && ++this.unreachable >= UNREACHABLE_LIMIT) return this.finish('host-left', false);
      wait = d === 'net'; // unreachable 은 이미 15초 기다렸다
      if (typeof d !== 'object') continue;
      this.tries++;
      this.o.onDispose = () => d.ep.destroy();
      this.attach(d.conn);
      this.redialing = false;
      this.set({ reconnecting: false });
      const again = this.asked ?? { t: 'rejoin' as const, pid: this.o.pid };
      if (again.t === 'rejoin') this.rejoining = true;
      return this.send(again);
    }
    this.finish('lost');
  }

  /** 방장 peer 가 시그널링에 없다고 답하면 방장이 떠난 것. 있거나 내 망 문제면 아무것도 안 한다(10초 규칙에 맡김). */
  private async probe(r: { network: Network; hostId: string }): Promise<void> {
    const heard = (this.probedFor = this.lastHeard);
    const d = await dial(r.network, r.hostId, PROBE_CONNECT_MS);
    if (typeof d === 'object') {
      d.conn.close();
      d.ep.destroy();
    }
    if (this.lastHeard !== heard) return;
    if (d === 'no-room') this.finish('host-left');
    else if (d === 'unreachable') this.unreachable++; // 다시 붙기에서 한 번 더 그러면 host-left
  }

  /** 끝. host-left 면 세션 키도 지운다(PRD §8 방장 끊김) — 단 unreachable 추정이면(clearKey=false) 남긴다. */
  private finish(ended: 'lost' | 'host-left', clearKey = true): void {
    if (this.disposed) return;
    if (ended === 'host-left' && clearKey && this.o.persist) clearSession();
    this.redialing = false;
    this.settle({ ok: false, reason: ended === 'lost' ? 'lost' : 'no-room' });
    this.set({ phase: 'ended', ended, reconnecting: false });
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
  // 내 망 문제(lost·network)면 키를 남겨 망이 돌아온 뒤 다시 이어하기
  if (!r.ok && r.reason !== 'lost' && r.reason !== 'network') clearSession();
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
  // 한 번 실패(채널 오류·ICE 실패 등 일시적일 수 있음)면 곧바로 한 번 더
  let d = await dial(network, hostId);
  if (d === 'net' || d === 'unreachable') d = await dial(network, hostId);
  if (typeof d !== 'object') return { ok: false, reason: d === 'no-room' ? d : 'network' };
  const { ep, conn } = d;
  const client = new ClientSession(conn, { pid, persist: { roomCode, hostPeerId: hostId }, now, onDispose: () => ep.destroy(), redial: { network, hostId } });
  const r = await first(client);
  return r.ok ? { ok: true, client } : r;
}
