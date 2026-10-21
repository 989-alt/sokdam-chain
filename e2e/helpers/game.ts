// T09 e2e 공용: 기기 = 브라우저 컨텍스트 하나(localStorage 분리 — storageState 를 공유하지 않는다).
// 시그널링은 playwright.config 의 로컬 peer 서버(127.0.0.1:9000)뿐이다.
import { type Browser, type Locator, type Page, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

export type Word = { id: string; text: string; meaning: string; example: string; level?: string; type?: string };
export const WORDS: Word[] = JSON.parse(readFileSync(new URL('../../src/data/words.json', import.meta.url), 'utf8'));
// 화면 글로 제시어를 찾으므로(wordByText·wordByMeaning) text·meaning 이 겹치면 판정이 틀린다 — 시작할 때 막는다.
for (const k of ['text', 'meaning'] as const)
  if (new Set(WORDS.map((w) => w[k])).size !== WORDS.length) throw new Error(`words.json ${k} 중복 — e2e 제시어 판정 불가`);
// 이름에 '그림'·'답'·'책' 같은 화면 문구를 넣지 않는다(장 머리 문구로 장 종류를 가린다).
export const NAMES = ['서연', '민재', '지우', '하준', '도윤', '수아', '예준'];

export const stepCount = (n: number) => (n % 2 ? n - 1 : n);

/**
 * 학생이 데이터 채널로 보낸 메시지 수를 t 별로 센다(제출 연타 검사).
 * 의존: PeerJS serialization 'json'(peer-transport.ts)이 메시지를 JSON 문자열의 UTF-8 바이트로 한 번에 send 하고 "t" 키가 맨 앞이라는 것.
 * 직렬화가 바뀌면(binary·청크) 계수가 0 이 되어 연타 테스트가 실패한다 — 그때 이 스파이를 고친다.
 */
const SPY = () => {
  const w = window as unknown as { __sent: Record<string, number> };
  w.__sent = {};
  const orig = RTCDataChannel.prototype.send;
  RTCDataChannel.prototype.send = function (this: RTCDataChannel, d: never) {
    try {
      const s = typeof d === 'string' ? d : new TextDecoder().decode(d as ArrayBuffer);
      const t = /"t":"([a-z-]+)"/.exec(s)?.[1];
      if (t) w.__sent[t] = (w.__sent[t] ?? 0) + 1;
    } catch {
      /* 셀 수 없는 형식은 무시 */
    }
    return orig.call(this, d);
  } as typeof orig;
};

export async function device(browser: Browser, o: { spy?: boolean } = {}): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  if (o.spy) await ctx.addInitScript(SPY);
  return ctx.newPage();
}

export const sent = (page: Page, t: string) => page.evaluate((t) => (window as unknown as { __sent: Record<string, number> }).__sent[t] ?? 0, t);

export type RoomOpts = { mode?: 'A' | 'B'; drawSeconds?: 30 | 60 | 90 | 120; review?: 'manual' | 3 | 5 | 8; hash?: string };

/** 방 만들기 → 대기실. 방 코드를 돌려준다. hash 가 교사 링크면 홈에서 '방 만들기' 로 들어간다. */
export async function createRoom(page: Page, name: string, o: RoomOpts = {}): Promise<string> {
  if (o.hash) {
    await page.goto('/' + o.hash);
    await page.getByRole('link', { name: '방 만들기' }).click();
  } else await page.goto('/#/create');
  const opt = (n: string) => page.getByRole('button', { name: n, exact: true }).click();
  if (o.mode === 'B') await opt('뜻');
  if (o.drawSeconds) await opt(`${o.drawSeconds}초`);
  if (o.review === 'manual') await opt('방장이 넘김');
  else if (o.review) await opt(`${o.review}초 뒤 자동 넘김`);
  const off = page.getByRole('button', { name: '끄기', exact: true });
  if (await off.count()) await off.click(); // 효과음 끔(효과음 파일이 없으면 소리 설정 자체가 없다)
  await page.locator('#host-name').fill(name);
  await page.getByRole('button', { name: '방 만들기' }).click();
  const code = page.locator('.code');
  await expect(code).toHaveText(/^\d{6}$/, { timeout: 15_000 });
  return (await code.textContent())!;
}

export async function join(page: Page, code: string, name: string) {
  await page.goto('/#/join');
  await page.locator('#room-code').fill(code);
  await page.locator('#join-name').fill(name);
  await page.getByRole('button', { name: '들어가기' }).click();
  await expect(page.locator('.screen-lobby')).toBeVisible({ timeout: 15_000 });
}

export const seats = (page: Page) => page.locator('.desk li:not(.empty)');

/** 방장 + 학생 n−1 명. players[i] 의 slot 이 i 임을 대기실에서 확인한다. */
export async function setupRoom(browser: Browser, n: number, o: RoomOpts & { spy?: boolean } = {}) {
  const names = NAMES.slice(0, n);
  const players = [await device(browser, o)];
  const code = await createRoom(players[0]!, names[0]!, o);
  for (let i = 1; i < n; i++) {
    const p = await device(browser, o);
    await join(p, code, names[i]!);
    await expect(seats(players[0]!)).toHaveCount(i + 1, { timeout: 5_000 });
    players.push(p);
  }
  for (let i = 0; i < n; i++) await expect(players[0]!.locator(`.desk li[data-slot="${i}"]`)).toContainText(names[i]!);
  return { players, names, code };
}

export async function start(host: Page) {
  const btn = host.getByRole('button', { name: '시작하기' });
  await expect(btn).toHaveAttribute('aria-disabled', 'false');
  await btn.click();
}

/** 들어오는 애니메이션(handoff-in 360ms)이 끝날 때까지. */
async function settle(el: Locator) {
  await expect.poll(() => el.evaluate((e) => e.getAnimations().every((a) => a.playState !== 'running'))).toBe(true);
}

/** 그 단계의 칸 화면이 뜰 때까지 기다린다. 책 주인 이름을 돌려준다. */
export async function waitCell(page: Page, step: number, steps: number, timeout = 15_000): Promise<string> {
  const chip = page.locator('.screen .chip.book-tag');
  await expect(chip).toContainText(`${step + 1} / ${steps}쪽`, { timeout });
  await expect(page.locator(step % 2 ? '#answer' : '.screen-draw .book')).toBeVisible({ timeout });
  return (await chip.textContent())!.split('의 스케치북')[0]!.trim();
}

/** 그리기 제시 글(그림 제시면 null). */
export const promptText = async (page: Page) => {
  const t = page.locator('.screen-draw .prompt .text');
  return (await t.count()) ? (await t.textContent())!.trim() : null;
};

export async function draw(page: Page) {
  const book = page.locator('.screen-draw .book');
  await settle(book);
  const b = (await page.locator('.screen-draw canvas').first().boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.6, { steps: 4 });
  await page.mouse.up();
  await page.getByRole('button', { name: /다 그렸어요/ }).click();
  await expect(book).toHaveCount(0, { timeout: 10_000 });
}

export async function guess(page: Page, text: string) {
  await settle(page.locator('.guess-book'));
  await page.locator('#answer').fill(text);
  await page.getByRole('button', { name: '답 보내기' }).click();
  await expect(page.locator('#answer')).toHaveCount(0);
}

export const answerOf = (name: string, step: number) => `${name}의 생각 ${step}`;

/** 페이지 전체 HTML(속성 포함) — 누설 검사용. */
export const html = (page: Page) => page.evaluate(() => document.documentElement.outerHTML);

/** true 를 돌려주면 그 칸 제출을 훅이 이미 했다. */
export type CellHook = (slot: number, step: number, page: Page, owner: string) => Promise<boolean | void>;

/**
 * 한 판의 모든 단계를 진행한다. idle[step] 에 든 slot 은 그 단계에 아무것도 하지 않는다.
 * 반환: 책 주인 이름 → 0단계 제시 글(A 원문 / B 뜻).
 */
export async function playSteps(players: Page[], names: string[], o: { idle?: Record<number, number[]>; onCell?: CellHook; from?: number } = {}) {
  const n = players.length;
  const steps = stepCount(n);
  const prompts = new Map<string, string>();
  for (let s = o.from ?? 0; s < steps; s++) {
    await Promise.all(
      players.map(async (p, slot) => {
        if (o.idle?.[s]?.includes(slot)) return;
        const owner = await waitCell(p, s, steps, 40_000);
        if (s === 0) prompts.set(owner, (await promptText(p))!);
        if (await o.onCell?.(slot, s, p, owner)) return;
        if (s % 2) await guess(p, answerOf(names[slot]!, s));
        else await draw(p);
      }),
    );
  }
  return prompts;
}

export const wordByText = (t: string) => WORDS.find((w) => w.text === t);
export const wordByMeaning = (m: string) => WORDS.find((w) => w.meaning === m);

export type ReviewRec = { sig: string; owner: string; kind: 'prompt' | 'draw' | 'guess' | 'card'; word?: string; example?: string; picture?: boolean };

const reviewSig = async (p: Page) =>
  `${(await p.locator('.review-head .chip.book-tag').textContent())?.trim()} | ${(await p.locator('.review-head .progress').textContent())?.trim()}`;

async function readPage(p: Page): Promise<ReviewRec> {
  const sig = await reviewSig(p);
  const owner = sig.split('의 스케치북')[0]!.trim();
  const spread = p.locator('.spread');
  if (await spread.locator('.meaning').count())
    return {
      sig,
      owner,
      kind: 'card',
      word: (await spread.locator('.meaning .word').textContent())!.trim(),
      example: ((await spread.locator('.meaning .example').textContent()) ?? '').trim(),
    };
  if (await spread.locator('.pic').count()) return { sig, owner, kind: 'draw', picture: (await spread.locator('.pic img.drawing').count()) > 0 };
  if (await spread.locator('.prompt-page').count()) return { sig, owner, kind: 'prompt' };
  if (await spread.locator('article.page .guess').count()) return { sig, owner, kind: 'guess' };
  throw new Error(`결과 장 종류를 알 수 없음: ${sig}`);
}

/**
 * 수동 결과 보기: 방장이 '다음 쪽' 을 끝까지 누른다. 매 장마다 학생 화면 장 번호가 방장과 같고 학생에겐 넘김 버튼이 없음을 확인.
 * 마지막 장에서 '투표하러 가요' 를 누른다.
 */
export async function walkReviewManual(players: Page[], total: number): Promise<ReviewRec[]> {
  const [host, ...students] = players as [Page, ...Page[]];
  const recs: ReviewRec[] = [];
  await expect(host.locator('.screen-review')).toBeVisible({ timeout: 20_000 });
  for (const s of students) await expect(s.locator('.screen-review')).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < total; i++) {
    if (i > 0) await expect.poll(() => reviewSig(host)).not.toBe(recs[i - 1]!.sig);
    const rec = await readPage(host);
    recs.push(rec);
    for (const s of students) {
      await expect.poll(() => reviewSig(s)).toBe(rec.sig);
      await expect(s.locator('.review-foot button')).toHaveCount(0);
    }
    await host.getByRole('button', { name: i === total - 1 ? '투표하러 가요' : '다음 쪽' }).click();
  }
  return recs;
}

/** 체인(책)별 장 종류 묶음. */
export function byChain(recs: ReviewRec[]) {
  const m = new Map<string, ReviewRec[]>();
  for (const r of recs) m.set(r.owner, [...(m.get(r.owner) ?? []), r]);
  return m;
}

/**
 * 투표: slot p 는 (p+1) 책의 0단계 그림과 1단계 답에 스티커 — 후보마다 정확히 1표라 전원 동점.
 * 투표하기 전 '내 것' 후보가 모두 비활성임을 확인.
 */
export async function voteEvenly(players: Page[], names: string[]) {
  const n = players.length;
  await Promise.all(
    players.map(async (p, slot) => {
      await expect(p.locator('.screen-vote .vote-submit')).toBeVisible({ timeout: 20_000 });
      const mine = p.locator('.cand:has(.mine)');
      expect(await mine.count()).toBeGreaterThan(0);
      for (const b of await mine.all()) await expect(b).toBeDisabled();
      const book = names[(slot + 1) % n]!;
      await p.getByRole('button', { name: `${book}의 스케치북 · ${book} 그림` }).click();
      await p.getByRole('button', { name: `${book}의 스케치북 · ${names[(slot + 2) % n]} 답` }).click();
      await p.getByRole('button', { name: '스티커 다 붙였어요' }).click();
    }),
  );
}

/** 투표 결과: 전원 동점이면 그림·답 모두 n개, 이름이 전부 나온다. */
export async function expectTieResult(players: Page[], names: string[]) {
  for (const p of players) {
    await expect(p.getByRole('heading', { name: '베스트 그림' })).toBeVisible({ timeout: 20_000 });
    const drawings = p.locator('section[aria-labelledby="best-drawing"] .best li');
    const answers = p.locator('section[aria-labelledby="best-answer"] .best li');
    await expect(drawings).toHaveCount(names.length);
    await expect(answers).toHaveCount(names.length);
    for (const nm of names) {
      await expect(drawings.filter({ hasText: `그린 사람 · ${nm}` })).toHaveCount(1);
      await expect(answers.filter({ hasText: `쓴 사람 · ${nm}` })).toHaveCount(1);
    }
  }
}

export async function closeAll(players: Page[]) {
  await Promise.all(players.map((p) => p.context().close().catch(() => {})));
}
