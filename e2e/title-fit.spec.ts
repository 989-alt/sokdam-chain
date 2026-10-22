// T18: 앱 제목 '이어라! 언어 표현 한 바퀴'가 상단 바에서 잘리지 않는다(홈·게임 중, 칩이 가장 많은 경우).
import { expect, test, type Page } from '@playwright/test';
import { bootDev, devServer } from './helpers/dev';

const VIEWPORTS = [
  { width: 768, height: 950 },
  { width: 1024, height: 690 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
];
const TITLE = '이어라! 언어 표현 한 바퀴';

let dev: Awaited<ReturnType<typeof devServer>>;
test.beforeAll(async () => {
  dev = await devServer();
});
test.afterAll(async () => {
  await dev?.close();
});

async function expectFits(page: Page, label: string) {
  const r = await page.evaluate(() => {
    const t = document.querySelector<HTMLElement>('.topbar .title')!;
    const bar = document.querySelector<HTMLElement>('.topbar')!;
    return { text: t.textContent, sw: t.scrollWidth, cw: t.clientWidth, barOverflow: bar.scrollWidth - bar.clientWidth };
  });
  expect(r.text, label).toBe(TITLE);
  expect(r.sw, `${label} title scrollWidth ${r.sw} > clientWidth ${r.cw}`).toBeLessThanOrEqual(r.cw);
  expect(r.barOverflow, `${label} top bar overflow`).toBeLessThanOrEqual(0);
}

test('홈 상단 바 제목이 잘리지 않는다', async ({ page }) => {
  await bootDev(page, dev.url);
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    await page.goto(`${dev.url}/#/`);
    await expect(page.locator('.topbar .title')).toHaveText(TITLE);
    await expectFits(page, `home ${vp.width}×${vp.height}`);
  }
});

test('게임 중 상단 바(스케치북 칩 + 이름 칩) 제목이 잘리지 않는다', async ({ page }) => {
  await bootDev(page, dev.url);
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    await page.evaluate(async () => {
      const w = window as any;
      const { GuessScreen } = await import(/* @vite-ignore */ '/src/ui/play/GuessScreen.tsx' as string);
      const h = w.__h;
      const chips = h(
        'span',
        null,
        h('span', { class: 'chip book-tag' }, '열두글자이름이라서의 스케치북 ', h('small', null, '10 / 10쪽')),
        h('span', { class: 'chip player' }, h('i', null), '열두글자이름이라서'),
      );
      const el = document.getElementById('app')!;
      w.__render(null, el);
      w.__render(h(GuessScreen, { input: { kind: 'image', imgId: 'x' }, category: '속담', image: () => undefined, submitted: false, onSubmit: () => {}, sound: () => {}, chips }), el);
    });
    await expectFits(page, `game ${vp.width}×${vp.height}`);
  }
});
