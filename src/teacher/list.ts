// 교사 목록 링크 (PRD §7.6, 설계문서 §5.2). 서버 없이 URL 해시 '#l=' 에 압축해 담는다.
// 압축은 fflate — 구형 iOS Safari 에 브라우저 내장 압축 API 가 없다. fflate 의 deflateSync 가 raw DEFLATE(=deflateRaw) 다.
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { Level, Word } from '../data/schema';

export type ListMode = 'add' | 'only';
/** 링크 안의 항목. e 는 비어 있을 수 있다(카드에 예문 줄 생략). */
export interface ListItem {
  t: string;
  m: string;
  e: string;
}
export interface LineError {
  line: number;
  reason: string;
}

export const PREFIX = '#l=';
export const HASH_MAX = 6000; // 브라우저·클래스룸 링크 안전선
export const HASH_QR = 1500; // QR 하나에 무리 없는 길이
export const MAX = { t: 30, m: 60, e: 80 } as const; // words 스키마·카드 한 화면과 같다
export const ITEMS_MAX = 300; // 링크 하나에 담는 항목 상한(복원 쪽 방어와 같다)
const INFLATE_MAX = 256 * 1024; // 300개 × 최대 항목(UTF-8 ≈ 540B) ≈ 160KB 보다 넉넉히

/** 한 줄 '속담 | 뜻 | 예문'. 첫 두 '|' 로만 나눈다. 줄 번호는 빈 줄 포함 1부터. 같은 속담은 먼저 것만 남긴다. */
export function parseLines(text: string): { items: ListItem[]; errors: LineError[] } {
  const items: ListItem[] = [];
  const errors: LineError[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    const parts = raw.split('|');
    if (parts.length < 2) return errors.push({ line, reason: "'속담 | 뜻' 처럼 | 로 나눠 주세요" });
    const t = parts[0]!.trim();
    const m = parts[1]!.trim();
    const e = parts.slice(2).join('|').trim();
    const bad = checkItem({ t, m, e });
    if (bad) return errors.push({ line, reason: bad });
    if (seen.has(t)) return;
    seen.add(t);
    items.push({ t, m, e });
  });
  return { items, errors };
}

function checkItem(x: ListItem): string | null {
  if (!x.t) return '속담이 비어 있어요';
  if (!x.m) return '뜻이 비어 있어요';
  if (x.t.length > MAX.t) return `속담은 ${MAX.t}자까지예요 (${x.t.length}자)`;
  if (x.m.length > MAX.m) return `뜻은 ${MAX.m}자까지예요 (${x.m.length}자)`;
  if (x.e.length > MAX.e) return `예문은 ${MAX.e}자까지예요 (${x.e.length}자)`;
  return null;
}

/** 엔진·카드가 쓰는 Word 로. id 't-<순번>', type '관용표현' 고정. level 은 교사 목록에 없어 부르는 쪽이 정한다. */
export function toWords(items: ListItem[], level: Level): Word[] {
  return items.map((x, i) => ({ id: `t-${i + 1}`, text: x.t, meaning: x.m, example: x.e, level, type: '관용표현' }));
}

function toHash(mode: ListMode, items: ListItem[]): string {
  const payload = { v: 1, mode, items: items.map((x) => (x.e ? x : { t: x.t, m: x.m })) };
  const bin = strFromU8(deflateSync(new TextEncoder().encode(JSON.stringify(payload)), { level: 9 }), true);
  return PREFIX + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 앞에서부터 몇 개까지 limit 안에 드는가(실제 인코딩으로 계산). 압축 길이는 개수에 거의 단조라 이분 탐색. */
function fitCount(mode: ListMode, items: ListItem[], limit: number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (toHash(mode, items.slice(0, mid)).length <= limit) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export type EncodeResult =
  | { ok: true; hash: string; warning?: string }
  | { ok: false; maxItems: number };

/** {v:1, mode, items} → UTF-8 → deflateRaw → base64url → '#l=…'. 6,000자 넘으면 실패와 담을 수 있는 개수. */
export function encodeList(mode: ListMode, items: ListItem[]): EncodeResult {
  if (items.length > ITEMS_MAX) return { ok: false, maxItems: fitCount(mode, items.slice(0, ITEMS_MAX), HASH_MAX) };
  const hash = toHash(mode, items);
  if (hash.length > HASH_MAX) return { ok: false, maxItems: fitCount(mode, items, HASH_MAX) };
  if (hash.length > HASH_QR) return { ok: true, hash, warning: `QR 로 나눠 주려면 ${fitCount(mode, items, HASH_QR)}개 이하가 좋아요` };
  return { ok: true, hash };
}

export type DecodeFail = 'missing' | 'base64' | 'inflate' | 'json' | 'version' | 'items' | 'toolong';
export type DecodeResult = { ok: true; mode: ListMode; items: ListItem[] } | { ok: false; reason: DecodeFail };

/** location.hash('#l=…') → 목록. 링크는 누구나 만들 수 있으니 항목을 다시 검증한다. '=' 패딩 유무 모두 허용. */
export function decodeList(hash: string): DecodeResult {
  if (!hash.startsWith(PREFIX)) return { ok: false, reason: 'missing' };
  const s = hash.slice(PREFIX.length);
  if (s.length > HASH_MAX) return { ok: false, reason: 'toolong' };
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(s)) return { ok: false, reason: 'base64' };
  let bin: string;
  try {
    bin = atob(s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return { ok: false, reason: 'base64' };
  }
  let bytes: Uint8Array;
  try {
    // 고정 버퍼: fflate 0.8.3 은 넘치면 throw 하지 않고 잘라 버퍼 길이를 돌려준다 → 꽉 차면 폭탄으로 본다.
    bytes = inflateSync(strToU8(bin, true), { out: new Uint8Array(INFLATE_MAX + 1) });
  } catch {
    return { ok: false, reason: 'inflate' };
  }
  if (bytes.length > INFLATE_MAX) return { ok: false, reason: 'toolong' };
  let p: unknown;
  try {
    p = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, reason: 'json' };
  }
  if (typeof p !== 'object' || p === null) return { ok: false, reason: 'json' };
  const o = p as Record<string, unknown>;
  if (o.v !== 1 || (o.mode !== 'add' && o.mode !== 'only')) return { ok: false, reason: 'version' };
  if (!Array.isArray(o.items) || o.items.length === 0 || o.items.length > ITEMS_MAX) return { ok: false, reason: 'items' };
  const items: ListItem[] = [];
  const seen = new Set<string>();
  for (const x of o.items as unknown[]) {
    const r = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
    if (typeof r.t !== 'string' || typeof r.m !== 'string' || (r.e !== undefined && typeof r.e !== 'string')) return { ok: false, reason: 'items' };
    const it = { t: r.t.trim(), m: r.m.trim(), e: ((r.e as string | undefined) ?? '').trim() };
    if (checkItem(it)) return { ok: false, reason: 'items' };
    if (seen.has(it.t)) continue;
    seen.add(it.t);
    items.push(it);
  }
  return { ok: true, mode: o.mode, items };
}

/** 복원 실패 시 T05 가 보여 줄 문구 하나. 'missing'(링크에 목록 없음)은 실패가 아니라 보여 주지 않는다. */
export function decodeFailMessage(_reason: DecodeFail): string {
  return '선생님 링크가 잘못됐거나 깨졌어요. 기본 목록으로 할게요.';
}

/** 공유 링크 = origin + pathname(base 포함) + '#l=…'. 쿼리·기존 해시는 버린다. */
export function buildLink(hash: string, loc: Pick<Location, 'origin' | 'pathname'> = location): string {
  return loc.origin + loc.pathname + hash;
}

/** 클립보드 복사. 실패(권한·비보안 컨텍스트·API 없음)면 false — 화면이 텍스트를 선택해 두고 길게 눌러 복사하라고 안내한다. */
export async function copyText(text: string, clip: Pick<Clipboard, 'writeText'> | undefined = globalThis.navigator?.clipboard): Promise<boolean> {
  try {
    if (!clip) return false;
    await clip.writeText(text);
    return true;
  } catch {
    return false;
  }
}
