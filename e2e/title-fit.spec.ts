// T18: 앱 제목 '이어라! 언어 표현 한 바퀴'가 상단 바에서 잘리지 않는다(홈·게임 중, 칩이 가장 많은 경우).
import { expect, test, type Page } from '@playwright/test';
import { bootDev, devServer } from './helpers/dev';
import { closeAll, createRoom, device, draw, join, seats, start, waitCell } from './helpers/game';

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

// 실제 화면 구조: 허용 최대 이름(12자)을 셋 다 같게 써 ' (2)'·' (3)' 접미사가 붙은 칩과 함께
const LONG = '가나다라마바사아자차카타';

async function fitsAll(page: Page, label: string) {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    await page.evaluate(() => document.fonts.ready);
    await expectFits(page, `${label} ${vp.width}×${vp.height}`);
  }
}

test('돌려쓰기 그리기·답 쓰기 상단 바 제목이 긴 이름 칩과 함께 잘리지 않는다', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/pass');
  for (let i = 0; i < 3; i++) await page.locator(`#pass-name-${i}`).fill(LONG);
  await page.getByRole('button', { name: '1권', exact: true }).click();
  await page.getByRole('button', { name: '시작하기', exact: true }).click();
  const ready = async () => {
    const btn = page.locator('.pass-cover').getByRole('button', { name: '준비됐어요' });
    await expect(btn).toHaveAttribute('aria-disabled', 'false');
    await btn.click();
  };
  await ready();
  await expect(page.locator('.screen-draw .book')).toBeVisible();
  await fitsAll(page, 'pass draw');
  await page.setViewportSize({ width: 1024, height: 768 });
  await draw(page);
  await ready();
  await expect(page.locator('#answer')).toBeVisible();
  await expect(page.locator('.topbar .chip.player')).toContainText(`${LONG} (2)`);
  await fitsAll(page, 'pass guess');
});

test('온라인 대기실·그리기·답 쓰기 상단 바 제목이 긴 이름 칩과 함께 잘리지 않는다', async ({ browser }) => {
  test.setTimeout(90_000);
  const names = [LONG, '나다라마바사아자차카타파', '다라마바사아자차카타파하', '라마바사아자차카타파하가'];
  const players = [await device(browser)];
  const code = await createRoom(players[0]!, names[0]!);
  for (let i = 1; i < 4; i++) {
    const p = await device(browser);
    await join(p, code, names[i]!);
    await expect(seats(players[0]!)).toHaveCount(i + 1, { timeout: 5_000 });
    players.push(p);
  }
  await fitsAll(players[0]!, 'online lobby');
  await players[0]!.setViewportSize({ width: 1024, height: 768 });
  await start(players[0]!);
  for (const p of players) await waitCell(p, 0, 4);
  await fitsAll(players[0]!, 'online draw');
  await players[0]!.setViewportSize({ width: 1024, height: 768 });
  for (const p of players) await draw(p);
  for (const p of players) await waitCell(p, 1, 4);
  await fitsAll(players[0]!, 'online guess');
  await closeAll(players);
});
