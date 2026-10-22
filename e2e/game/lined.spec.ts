// 줄 맞춤(DESIGN §3-2, 2026-10-22 사용자 피드백 "글자가 줄을 무시"): 줄 공책 속지(.page.lined) 위 글자는 47px 줄 칸에 앉는다.
// 답 쓰기 화면(GuessScreen)과 결과 보기 답 장·제시어 장(ReviewScreen)을 개발 서버에서 직접 띄워 잰다 — 답 40자(두 줄)·뜻 60자(B 제시어 장) 포함.
// 확인: 글자 요소 line-height 47px · 위 경계가 속지 content-box 위에서 47 배수(±1) · 첫 줄 기준선이 그 칸의 줄(44~47px) 바로 위 0~4px.
import { expect, test, type Page } from '@playwright/test';
import { bootDev, devServer } from '../helpers/dev';

const MEANING = '친구가 어려움을 겪을 때 모른 척하지 않고 곁에서 끝까지 도와서 함께 문제를 해결하는 착한 마음을 이르는 말';
const ANSWER = '친구가 힘들 때 끝까지 곁에서 도와주고 같이 문제를 풀어 주는 착한 마음';
const VIEWPORTS = [
  { width: 768, height: 950 },
  { width: 1024, height: 690 },
];
const LINE = 47;

let dev: Awaited<ReturnType<typeof devServer>>;
test.beforeAll(async () => {
  dev = await devServer();
});
test.afterAll(async () => {
  await dev?.close();
});

type Probe = { sel: string; lh: string; top: number; base: number; line: number; h: number };

/** 속지 하나 안의 글자 요소를 잰다. top·base 는 content-box 위에서의 거리, line = 첫 줄 칸의 줄(빈칸 44 뒤) 위치(배경 이동 반영). */
async function measure(page: Page, pageSel: string, sels: string[]): Promise<Probe[]> {
  return page.evaluate(
    ({ pageSel, sels, LINE }) => {
      const pg = document.querySelector<HTMLElement>(pageSel)!;
      const cs = getComputedStyle(pg);
      const top0 = pg.getBoundingClientRect().top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
      const shift = parseFloat(cs.backgroundPositionY) || 0;
      return sels.map((sel) => {
        const el = pg.querySelector<HTMLElement>(sel)!;
        // 기준선 = 첫 글자 줄 안에 높이 0 inline-block 을 넣어 잰 위치(인라인 자식이 있으면 그 안에)
        const host = el.querySelector<HTMLElement>('q, span, .none') ?? el;
        const mark = document.createElement('i');
        mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
        host.prepend(mark);
        const base = mark.getBoundingClientRect().top - top0;
        mark.remove();
        const r = el.getBoundingClientRect();
        const top = r.top - top0;
        const cell = Math.floor((top + 1) / LINE) * LINE;
        return { sel, lh: getComputedStyle(el).lineHeight, top, base, line: cell + 44 + shift, h: r.height };
      });
    },
    { pageSel, sels, LINE },
  );
}

function check(ps: Probe[], at: string) {
  for (const p of ps) {
    const m = `${at} ${JSON.stringify(p)}`;
    expect(p.lh, m).toBe('47px');
    const off = ((p.top % LINE) + LINE) % LINE;
    expect(Math.min(off, LINE - off), m).toBeLessThanOrEqual(1);
    expect(Math.round(p.h) % LINE, m).toBe(0);
    // 글자는 줄 위에 앉는다: 기준선이 줄보다 0~4px 위
    expect(p.line - p.base, m).toBeGreaterThanOrEqual(0);
    expect(p.line - p.base, m).toBeLessThanOrEqual(4);
  }
}

/** 글자 아닌 블록(대체 안내 띠·기다리기 패널·탭 줄)도 칸을 정확히 차지한다: 위 경계와 높이가 47 배수(±1). */
async function onGrid(page: Page, pageSel: string, sel: string) {
  const b = await page.evaluate(
    ({ pageSel, sel }) => {
      const pg = document.querySelector<HTMLElement>(pageSel)!;
      const cs = getComputedStyle(pg);
      const top0 = pg.getBoundingClientRect().top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
      const r = pg.querySelector<HTMLElement>(sel)!.getBoundingClientRect();
      return { sel, top: r.top - top0, h: r.height };
    },
    { pageSel, sel },
  );
  const near = (x: number) => Math.min(((x % LINE) + LINE) % LINE, LINE - (((x % LINE) + LINE) % LINE));
  expect(near(b.top), JSON.stringify(b)).toBeLessThanOrEqual(1);
  expect(near(b.h), JSON.stringify(b)).toBeLessThanOrEqual(1);
  return b;
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready); // 글꼴 로드 전엔 대체 글꼴 기준선으로 재 버린다
  await page.evaluate(() => new Promise((r) => setTimeout(r, 150)));
  await expect.poll(() => page.evaluate(() => document.getAnimations().every((a) => a.playState !== 'running'))).toBe(true);
}

test('답 쓰기 화면 — 오른쪽 속지 글자가 줄에 앉는다(묶음 4개 안내 포함)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bootDev(page, dev.url);
  for (const vp of VIEWPORTS)
    for (const category of ['속담', '관용표현', '사자성어', '상식용어', null]) {
      await page.setViewportSize(vp);
      await page.evaluate(async (category) => {
        const w = window as any;
        const { GuessScreen } = await import(/* @vite-ignore */ '/src/ui/play/GuessScreen.tsx' as string);
        const el = document.getElementById('app')!;
        w.__render(null, el);
        w.__render(w.__h(GuessScreen, { input: { kind: 'image', imgId: 'x' }, category, image: () => undefined, submitted: false, onSubmit: () => {}, sound: () => {} }), el);
      }, category);
      await settle(page);
      const ask = { 속담: '속담을', 관용표현: '관용표현을', 사자성어: '사자성어를', 상식용어: '낱말을' }[category ?? ''] ?? '말을';
      await expect(page.locator('.page.lined .ask')).toHaveText(`이 그림이 나타내는 ${ask} 써 보세요`);
      check(await measure(page, 'form.page.lined', ['.who', '.ask', '.field label', '.field .help']), `${vp.width}×${vp.height} ${category}`);
      if (category === '사자성어') await test.info().attach(`guess-${vp.width}x${vp.height}`, { body: await page.screenshot(process.env.SHOT_DIR ? { path: `${process.env.SHOT_DIR}/guess-${vp.width}.png` } : {}), contentType: 'image/png' });
    }
});

test('결과 보기 — 제시어 장(뜻 60자)·답 장(40자 두 줄·짧은 답·빈 답) 글자가 줄에 앉는다', async ({ page }) => {
  expect([...MEANING].length).toBe(60);
  expect([...ANSWER].length).toBe(40);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bootDev(page, dev.url);
  const entry = (text: string) => ({ step: 1, kind: 'guess', bySlot: 1, status: 'done', text });
  const PAGES = [
    { chainIdx: 0, kind: 'prompt', text: MEANING },
    { chainIdx: 0, kind: 'guess', entry: entry(ANSWER), empty: false },
    { chainIdx: 0, kind: 'guess', entry: entry('발이 넓다'), empty: false },
    { chainIdx: 0, kind: 'guess', entry: entry(''), empty: true },
  ];
  for (const vp of VIEWPORTS)
    for (let i = 0; i < PAGES.length; i++) {
      await page.setViewportSize(vp);
      await page.evaluate(
        async ({ pages, i }) => {
          const w = window as any;
          const { ReviewScreen } = await import(/* @vite-ignore */ '/src/ui/results/ReviewScreen.tsx' as string);
          const el = document.getElementById('app')!;
          w.__render(null, el);
          w.__render(
            w.__h(ReviewScreen, { pages: [pages[i]], page: 0, mode: 'B', category: '관용표현', nameOf: () => '민재', image: () => undefined, review: 'manual', reviewSeconds: 5, onNext: () => {}, sound: () => {} }),
            el,
          );
        },
        { pages: PAGES, i },
      );
      await settle(page);
      const ps = await measure(page, '.spread .page.lined', ['.who', '.guess']);
      check(ps, `${vp.width}×${vp.height} 장 ${i}`);
      if (i < 2) await test.info().attach(`review-${i}-${vp.width}x${vp.height}`, { body: await page.screenshot(process.env.SHOT_DIR ? { path: `${process.env.SHOT_DIR}/review-${i}-${vp.width}.png` } : {}), contentType: 'image/png' });
      // 위에서 쌓기: 첫 글자 블록은 둘째 칸(띠 칸 다음), 본문은 그 바로 다음 칸 — 탭 줄(한 칸) 뒤
      expect(ps[0]!.top, JSON.stringify(ps)).toBeCloseTo(2 * LINE, 0);
      expect(ps[1]!.top, JSON.stringify(ps)).toBeCloseTo(3 * LINE, 0);
      // 줄이 잘려 숨지 않는다
      const clip = await page.evaluate(() => {
        const g = document.querySelector<HTMLElement>('.spread .page.lined .guess')!;
        return { sh: g.scrollHeight, ch: g.clientHeight, pb: document.querySelector('.spread .page.lined')!.getBoundingClientRect().bottom, gb: g.getBoundingClientRect().bottom };
      });
      expect(clip.sh, JSON.stringify(clip)).toBeLessThanOrEqual(clip.ch);
      expect(clip.gb, JSON.stringify(clip)).toBeLessThanOrEqual(clip.pb);
      if (i === 3) await onGrid(page, '.spread .page.lined', '.fallback'); // 빈 답 장 뒤 대체 안내 띠(한 쪽만 띄워 isGap)
    }
});

test('결과 보기 — 탭이 두 줄로 접혀도(94px) 머리·본문이 줄 칸에서 시작', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bootDev(page, dev.url);
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    await page.evaluate(async () => {
      const w = window as any;
      const { ReviewScreen } = await import(/* @vite-ignore */ '/src/ui/results/ReviewScreen.tsx' as string);
      const el = document.getElementById('app')!;
      // 한 권에 쪽 14개 — 탭이 768·1024 폭 모두에서 두 줄로 접힌다
      const pages = Array.from({ length: 14 }, (_, k) => ({ chainIdx: 0, kind: 'guess', entry: { step: k, kind: 'guess', bySlot: 1, status: 'done', text: `답${k}` }, empty: false }));
      w.__render(null, el);
      w.__render(w.__h(ReviewScreen, { pages, page: 0, mode: 'A', category: '속담', nameOf: () => '민재', image: () => undefined, review: 'manual', reviewSeconds: 5, onNext: () => {}, sound: () => {} }), el);
    });
    await settle(page);
    const tabs = await onGrid(page, '.spread .page.lined', '.pagetabs');
    expect(Math.round(tabs.h), JSON.stringify(tabs)).toBe(2 * LINE);
    const ps = await measure(page, '.spread .page.lined', ['.who', '.guess']);
    check(ps, `${vp.width}×${vp.height} 탭 두 줄`);
    expect(ps[0]!.top).toBeCloseTo(3 * LINE, 0);
  }
});

test('답 쓰기 제출 뒤 — 기다리기 패널(6명)이 줄 칸을 정확히 차지', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bootDev(page, dev.url);
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    await page.evaluate(async () => {
      const w = window as any;
      const { GuessScreen } = await import(/* @vite-ignore */ '/src/ui/play/GuessScreen.tsx' as string);
      const { WaitingPanel } = await import(/* @vite-ignore */ '/src/ui/play/WaitingPanel.tsx' as string);
      const players = ['서연', '민재', '지우', '하준', '도윤', '수아'].map((name, k) => ({ name, connected: k !== 4 }));
      const waiting = w.__h(WaitingPanel, { count: { submitted: 3, total: 6 }, title: '다른 친구를 기다려요', players });
      const el = document.getElementById('app')!;
      w.__render(null, el);
      w.__render(w.__h(GuessScreen, { input: { kind: 'image', imgId: 'x' }, category: '속담', image: () => undefined, submitted: true, onSubmit: () => {}, sound: () => {}, waiting }), el);
    });
    await settle(page);
    check(await measure(page, 'form.page.lined', ['.who', '.ask']), `${vp.width}×${vp.height} 기다리기`);
    await onGrid(page, 'form.page.lined', '.waiting');
  }
});

test('줄 맞춤은 속지(.page.lined)에만 — 그리기 쪽 .page·뜻 카드는 그대로', async ({ page }) => {
  await bootDev(page, dev.url);
  const lh = await page.evaluate(async () => {
    const w = window as any;
    const { GuessScreen } = await import(/* @vite-ignore */ '/src/ui/play/GuessScreen.tsx' as string);
    const el = document.getElementById('app')!;
    w.__render(null, el);
    w.__render(w.__h(GuessScreen, { input: { kind: 'text', text: '발이 넓다', fallbackNote: true }, category: '속담', image: () => undefined, submitted: false, onSubmit: () => {}, sound: () => {} }), el);
    await new Promise((r) => setTimeout(r, 50));
    const left = el.querySelector<HTMLElement>('article.page:not(.lined)')!;
    return { who: getComputedStyle(left.querySelector('.who')!).lineHeight, guess: getComputedStyle(left.querySelector('.guess')!).lineHeight };
  });
  expect(lh.who).not.toBe('47px');
  expect(lh.guess).not.toBe('47px');
});
