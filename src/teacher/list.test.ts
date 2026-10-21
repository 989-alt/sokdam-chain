import { describe, expect, it } from 'vitest';
import { deflateSync, strFromU8 } from 'fflate';
import { validateWords } from '../data/schema';
import words from '../data/words.json';
import { buildLink, copyText, decodeFailMessage, decodeList, ITEMS_MAX, encodeList, HASH_MAX, parseLines, PREFIX, toWords, type ListItem } from './list';

const b64url = (bytes: Uint8Array) => btoa(strFromU8(bytes, true)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const raw = (s: string) => PREFIX + b64url(deflateSync(new TextEncoder().encode(s)));

// 서로 다른 한글 문장(압축이 잘 안 되는 최악에 가깝게) — 결정적 의사난수.
function fakeItems(n: number): ListItem[] {
  let x = 7;
  const syl = (k: number) => Array.from({ length: k }, () => String.fromCharCode(0xac00 + ((x = (x * 1103515245 + 12345) % 2 ** 31) % 11172))).join('');
  return Array.from({ length: n }, (_, i) => ({ t: `${syl(8)}${i}`, m: syl(30), e: syl(40) }));
}

describe('parseLines', () => {
  it('첫 두 | 로 나누고 나머지 | 는 예문에, 공백 제거·빈 줄 무시', () => {
    const r = parseLines('  가는 말이 고와야 | 내가 잘해야 남도 잘한다 | 예문 a | b  \n\n   \n원숭이 | 실수한다');
    expect(r.errors).toEqual([]);
    expect(r.items).toEqual([
      { t: '가는 말이 고와야', m: '내가 잘해야 남도 잘한다', e: '예문 a | b' },
      { t: '원숭이', m: '실수한다', e: '' },
    ]);
  });
  it('조각 1개·빈 속담·빈 뜻은 줄 번호와 함께 오류', () => {
    const r = parseLines('속담만\n\n | 뜻\n속담 |  | 예문');
    expect(r.items).toEqual([]);
    expect(r.errors.map((e) => e.line)).toEqual([1, 3, 4]);
    expect(r.errors[0]!.reason).toContain('|');
  });
  it('길이 상한 30·60·80 초과는 줄 번호 오류, 경계값은 통과', () => {
    const ok = `${'가'.repeat(30)} | ${'나'.repeat(60)} | ${'다'.repeat(80)}`;
    const r = parseLines([ok, `${'가'.repeat(31)} | 뜻`, `속담2 | ${'나'.repeat(61)}`, `속담3 | 뜻 | ${'다'.repeat(81)}`].join('\n'));
    expect(r.items).toHaveLength(1);
    expect(r.errors.map((e) => [e.line, e.reason.slice(0, 2)])).toEqual([
      [2, '속담'],
      [3, '뜻은'],
      [4, '예문'],
    ]);
  });
  it('같은 속담은 먼저 것만', () => {
    const r = parseLines('a | 뜻1\nb | 뜻\na | 뜻2');
    expect(r.items.map((x) => x.m)).toEqual(['뜻1', '뜻']);
  });
});

describe('toWords', () => {
  it("id 't-<순번>', type 관용표현, validateWords 통과", () => {
    const { items } = parseLines('a | 뜻a | 예문a\nb | 뜻b | 예문b');
    const w = toWords(items, 'e34');
    expect(w.map((x) => [x.id, x.type])).toEqual([
      ['t-1', '관용표현'],
      ['t-2', '관용표현'],
    ]);
    expect(validateWords(w)).toBe(w);
  });
});

describe('encode/decode', () => {
  it('왕복 — 한글·이모지·| 포함, 두 mode', () => {
    const items = [
      { t: '고래 싸움에 새우 등 터진다 🐋', m: '센 사람 싸움에 약한 사람이 다친다', e: 'a | b 🦐' },
      { t: '누워서 떡 먹기', m: '아주 쉽다', e: '' },
    ];
    for (const mode of ['add', 'only'] as const) {
      const r = encodeList(mode, items);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.hash.startsWith('#l=')).toBe(true);
      expect(r.hash.slice(3)).not.toMatch(/[+/=]/);
      expect(decodeList(r.hash)).toEqual({ ok: true, mode, items });
    }
  });
  it("'=' 패딩이 붙어도 복원", () => {
    const r = encodeList('add', [{ t: '가', m: '나', e: '' }]);
    if (!r.ok) throw new Error();
    const body = r.hash.slice(3);
    const padded = PREFIX + body + '='.repeat((4 - (body.length % 4)) % 4);
    expect(decodeList(padded).ok).toBe(true);
  });
  it('실제 낱말 50개(44 + 변형 6) 왕복 성공, 1,500 넘으면 QR 경고', () => {
    const base = words.map((w) => ({ t: w.text, m: w.meaning, e: w.example }));
    const items = [...base, ...base.slice(0, 50 - base.length).map((x) => ({ ...x, t: `${x.t}2` }))];
    expect(items).toHaveLength(50);
    const r = encodeList('add', items);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hash.length).toBeLessThanOrEqual(HASH_MAX);
    expect(r.warning).toMatch(/^QR 로 나눠 주려면 \d+개 이하가 좋아요$/);
    const n = Number(r.warning!.match(/\d+/)![0]);
    expect(encodeList('add', items.slice(0, n)).ok && !(encodeList('add', items.slice(0, n)) as { warning?: string }).warning).toBe(true);
    expect((encodeList('add', items.slice(0, n + 1)) as { warning?: string }).warning).toBeDefined();
    expect(decodeList(r.hash)).toEqual({ ok: true, mode: 'add', items });
  });
  it('짧으면 경고 없음', () => {
    const r = encodeList('only', [{ t: '가', m: '나', e: '다' }]);
    expect(r).toEqual({ ok: true, hash: expect.any(String) });
  });
  it('400개는 6,000자 초과 — maxItems 는 실제로 들어가는 개수', () => {
    const items = fakeItems(400);
    const r = encodeList('add', items);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.maxItems).toBeGreaterThan(0);
    expect(r.maxItems).toBeLessThan(400);
    expect(encodeList('add', items.slice(0, r.maxItems)).ok).toBe(true);
    expect(encodeList('add', items.slice(0, r.maxItems + 1)).ok).toBe(false);
  });
});

describe('잘못된 링크', () => {
  it.each([
    ['base64 아님', '#l=!!!@@', 'base64'],
    ['inflate 실패', PREFIX + b64url(new Uint8Array([0xff, 0xff, 0xff, 0xff])), 'inflate'],
    ['JSON 아님', raw('{v:1'), 'json'],
    ['v≠1', raw('{"v":2,"mode":"add","items":[{"t":"a","m":"b"}]}'), 'version'],
    ['items 비어 있음', raw('{"v":1,"mode":"add","items":[]}'), 'items'],
    ['해시 없음', '', 'missing'],
    ['항목 길이 초과', raw(JSON.stringify({ v: 1, mode: 'only', items: [{ t: 'a'.repeat(31), m: 'b' }] })), 'items'],
    ['mode 잘못됨', raw('{"v":1,"mode":"x","items":[{"t":"a","m":"b"}]}'), 'version'],
  ])('%s', (_, hash, reason) => {
    expect(decodeList(hash)).toEqual({ ok: false, reason });
  });
});

describe('크기 방어', () => {
  it('해시가 6,000자 넘으면 toolong', () => {
    expect(decodeList(PREFIX + 'A'.repeat(HASH_MAX + 1))).toEqual({ ok: false, reason: 'toolong' });
  });
  it("압축 폭탄(4MB 'a', 해시 6,000자 안) 은 고정 버퍼로 막고 toolong", () => {
    const bomb = PREFIX + b64url(deflateSync(new Uint8Array(4e6).fill(97), { level: 9 }));
    expect(bomb.length).toBeLessThanOrEqual(HASH_MAX);
    expect(decodeList(bomb)).toEqual({ ok: false, reason: 'toolong' });
  });
  it('항목 300개 초과는 복원 거부, 인코딩도 300 이하로 안내', () => {
    const many = Array.from({ length: ITEMS_MAX + 1 }, (_, i) => ({ t: `${i}`, m: 'b' }));
    expect(decodeList(raw(JSON.stringify({ v: 1, mode: 'add', items: many })))).toEqual({ ok: false, reason: 'items' });
    const r = encodeList('add', many.map((x) => ({ ...x, e: '' })));
    expect(r).toEqual({ ok: false, maxItems: ITEMS_MAX });
  });
  it('실패 문구 하나', () => {
    expect(decodeFailMessage('inflate')).toContain('기본 목록');
  });
});

describe('buildLink', () => {
  it("origin + pathname(base '/sokdam-chain/') + hash", () => {
    expect(buildLink('#l=abc', { origin: 'https://x.github.io', pathname: '/sokdam-chain/' })).toBe('https://x.github.io/sokdam-chain/#l=abc');
  });
});

describe('copyText', () => {
  it('성공 true, 거부·API 없음 false', async () => {
    let got = '';
    expect(await copyText('a', { writeText: async (s: string) => void (got = s) })).toBe(true);
    expect(got).toBe('a');
    expect(await copyText('a', { writeText: () => Promise.reject(new Error('NotAllowedError')) })).toBe(false);
    expect(await copyText('a', undefined)).toBe(false);
  });
});
