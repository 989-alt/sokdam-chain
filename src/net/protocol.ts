// 메시지 프로토콜 v1 (PRD §7.5). 데이터 채널 위 JSON. 공통 머리 { t, v }.
import { PROTOCOL_VERSION } from '../config';
import type { EntryKey, Input, Level, ListSource, Mode, ReviewPage } from '../engine';

/** PRD §7.4 Settings. 방장이 정하고 joined 로 학생에게 알린다. */
export type Settings = {
  level: Level | null;
  mode: Mode;
  drawSeconds: 30 | 60 | 90 | 120;
  review: 'timer' | 'manual';
  reviewSeconds: 3 | 5 | 8;
  sound: boolean;
  listSource: ListSource;
};

export type Phase = 'lobby' | 'play' | 'review' | 'vote' | 'vote-result' | 'ended';
export type LobbyPlayer = { slot: number; name: string; connected: boolean };
export type RejectReason = 'full' | 'started' | 'version' | 'name' | 'unknown' | 'ended' | 'too-large' | 'bad-image';
export type EndReason = 'host-left' | 'finished';
/** 학생 한 명의 이번 차례 칸. 이 학생 몫만 — 다른 체인·원 제시어 없음(0단계 첫 사람 제외). */
export type Turn = { step: number; kind: 'draw' | 'guess'; chainIdx: number; input: Input; deadlineAt: number | null };
export type CandidateKeys = { drawings: EntryKey[]; answers: EntryKey[] };
export type VoteResult = { bestDrawings: EntryKey[]; bestAnswers: EntryKey[] };
export type Chunk = { imgId: string; idx: number; total: number; data: string };

/** 재접속 학생에게 주는 현재 뷰 전부. */
export type SyncState = {
  phase: Phase;
  slot: number;
  settings: Settings;
  players: LobbyPlayer[];
  cell: Turn | null;
  submitted: boolean;
  waiting: { submitted: number; total: number } | null;
  pages: ReviewPage[];
  page: number;
  candidates: CandidateKeys | null;
  voted: boolean;
  result: VoteResult | null;
};

export type ToHost =
  | { t: 'join'; pid: string; name: string }
  | { t: 'rejoin'; pid: string }
  | { t: 'submit-draw'; chainIdx: number; step: number; imgId: string; mime: string; bytes: number }
  | { t: 'submit-guess'; chainIdx: number; step: number; text: string }
  | { t: 'vote'; drawing: EntryKey | null; answer: EntryKey | null }
  | { t: 'leave' }
  | { t: 'pong' }
  | ({ t: 'chunk' } & Chunk);

export type ToClient =
  | { t: 'joined'; pid: string; slot: number; settings: Settings }
  | { t: 'rejected'; reason: RejectReason }
  | { t: 'lobby'; players: LobbyPlayer[]; you: number }
  | ({ t: 'step'; hostNow: number } & Turn)
  | { t: 'waiting'; submitted: number; total: number }
  | { t: 'review-preload'; pages: ReviewPage[] }
  | { t: 'show'; page: number }
  | { t: 'vote-open'; candidates: CandidateKeys }
  | ({ t: 'vote-result' } & VoteResult)
  | { t: 'again' }
  | { t: 'ended'; reason: EndReason }
  | { t: 'ping'; hostNow: number }
  | { t: 'sync'; state: SyncState; hostNow: number }
  | ({ t: 'chunk' } & Chunk);

export type Msg = ToHost | ToClient;
export const V = PROTOCOL_VERSION;

/** 받은 값이 { t: string } 꼴인지만 본다. 필드 검증은 각 처리기가 한다(신뢰 경계). */
export const isMsg = (x: unknown): x is Record<string, unknown> & { t: string } =>
  typeof x === 'object' && x !== null && typeof (x as { t?: unknown }).t === 'string';

// 타이밍 상수 (PRD §7.5·§8, 계약 edge_cases)
export const PING_MS = 1000;
export const HOST_SILENCE_MS = 5000; // 방장: 학생 무응답 → connected:false
export const CLIENT_SILENCE_MS = 10000; // 학생: ping 무수신 → 방장 끊김
export const DRAW_GRACE_MS = 3000; // 그리기 기한 뒤 미도착 처리까지 여유
export const ABSENT_MS = 60000; // 끊긴 학생의 답 쓰기·투표 기다림
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 4;
export const MAX_IMG_BYTES = 256 * 1024;
