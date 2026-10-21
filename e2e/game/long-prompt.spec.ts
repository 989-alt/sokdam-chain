// 긴 제시(QA r1): 허용 상한 뜻 60자·앞사람 답 40자가 그리기 화면 4개 뷰포트에서 잘리지 않고 다 보인다.
// 한 화면 규칙(세로 스크롤 없음·제출 버튼 화면 안)과 캔버스 최소 폭 480 도 같이 본다. DESIGN §3-1.
import { expect, test, type Page } from '@playwright/test';
import { device, draw, guess, NAMES } from '../helpers/game';

const MEANING = '친구가 어려움을 겪을 때 모른 척하지 않고 곁에서 끝까지 도와주어 함께 문제를 해결한다는 뜻입니다요요요요요요';
const ANSWER = '친구가 힘들 때 끝까지 곁에서 도와주고 같이 문제를 풀어 주는 착한 마음';
const VIEWPORTS = [
  { width: 768, height: 950 },
  { width: 1024, height: 690 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
];

async function fitsEverywhere(page: Page, text: string) {
  await expect(page.locator('.screen-draw .prompt .text')).toHaveText(text);
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    // 회전·넘겨주기 애니메이션이 끝난 배치로 잰다(transform 중이면 getBoundingClientRect 가 부푼다)
    await expect.poll(() => page.evaluate(() => document.getAnimations().every((a) => a.playState !== 'running'))).toBe(true);
    const m = await page.evaluate(() => {
      const t = document.querySelector<HTMLElement>('.screen-draw .prompt .text')!;
      const c = document.querySelector<HTMLElement>('.screen-draw canvas')!.getBoundingClientRect();
      const s = document.querySelector<HTMLElement>('.screen-draw .book > .submit')!.getBoundingClientRect();
      return { head: document.querySelector<HTMLElement>('.screen-draw .prompt')!.offsetHeight, sh: t.scrollHeight, ch: t.clientHeight, sw: t.scrollWidth, cw: t.clientWidth, canvas: c.width, submit: s.bottom, doc: document.documentElement.scrollHeight, vh: innerHeight };
    });
    const at = `${vp.width}×${vp.height} ${JSON.stringify(m)}`;
    expect(m.sh, at).toBeLessThanOrEqual(m.ch);
    expect(m.sw, at).toBeLessThanOrEqual(m.cw);
    expect(m.canvas, at).toBeGreaterThanOrEqual(480);
    expect(m.submit, at).toBeLessThanOrEqual(m.vh);
    expect(m.doc, at).toBeLessThanOrEqual(m.vh);
  }
  await page.setViewportSize({ width: 1024, height: 768 });
}

test('뜻 60자·앞사람 답 40자 제시가 768×950·1024×690·768×1024·1024×768 에서 잘리지 않는다', async ({ browser }) => {
  test.setTimeout(120_000);
  expect([...MEANING].length).toBe(60);
  expect([...ANSWER].length).toBe(40);
  const page = await device(browser);
  await page.goto('/#/teacher');
  await page.locator('#teacher-lines').fill(`상부상조 | ${MEANING}`);
  await page.getByRole('radio', { name: '이 목록만' }).check({ force: true });
  await expect(page.locator('.teacher-errors')).toHaveCount(0);
  await page.goto(await page.locator('#teacher-link').inputValue());
  await page.getByRole('link', { name: '돌려쓰기 시작' }).click();
  await page.getByRole('button', { name: '한 명 더' }).click();
  for (let i = 0; i < 4; i++) await page.locator(`#pass-name-${i}`).fill(NAMES[i]!);
  await page.getByRole('button', { name: '1권', exact: true }).click();
  await page.getByRole('button', { name: '뜻', exact: true }).click();
  await page.getByRole('button', { name: '시작하기', exact: true }).click();
  const ready = async () => {
    const btn = page.locator('.pass-cover').getByRole('button', { name: '준비됐어요' });
    await expect(btn).toHaveAttribute('aria-disabled', 'false');
    await btn.click();
  };
  await ready();
  await fitsEverywhere(page, MEANING);
  await draw(page);
  await ready();
  await guess(page, ANSWER);
  await ready();
  await fitsEverywhere(page, ANSWER);
  await page.context().close();
});
