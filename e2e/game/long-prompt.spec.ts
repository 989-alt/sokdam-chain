// 긴 제시(QA r1): 허용 상한 뜻 60자·앞사람 답 40자가 그리기 화면 4개 뷰포트에서 잘리지 않고 다 보인다.
// 한 화면 규칙(세로 스크롤 없음·제출 버튼 화면 안)과 캔버스 최소 폭 480 도 같이 본다. DESIGN §3-1.
import { expect, test, type Page } from '@playwright/test';
import { bootDev, devServer } from '../helpers/dev';
import { device, draw, guess, NAMES } from '../helpers/game';

const FALLBACK_NOTE = '앞사람 것이 없어서 그 앞 내용을 보여줘요'; // src/ui/play/prompt.ts

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

// QA r2 #1: 긴 제시에 아래 안내 줄(2단계 이상 '원래 속담은…'·대체 입력 FALLBACK_NOTE)이 함께 있을 때도 잘림 없음·캔버스 ≥ 480.
// 대체 입력은 돌려쓰기로 만들 수 없어 개발 서버에서 DrawScreen 을 직접 띄운다.
test.describe('긴 제시 + 안내 줄', () => {
  let dev: Awaited<ReturnType<typeof devServer>>;
  test.beforeAll(async () => {
    dev = await devServer();
  });
  test.afterAll(async () => {
    await dev?.close();
  });
  const CASES = [
    { name: '뜻 60자 · 0단계', input: { kind: 'meaning', text: MEANING }, first: true },
    { name: '뜻 60자 · 대체 입력', input: { kind: 'meaning', text: MEANING, fallbackNote: true }, first: false },
    { name: '앞사람 답 40자 · 2단계', input: { kind: 'text', text: ANSWER }, first: false },
    { name: '앞사람 답 40자 · 대체 입력', input: { kind: 'text', text: ANSWER, fallbackNote: true }, first: false },
    { name: '띄어쓰기 없는 답 40자 · 2단계', input: { kind: 'text', text: '친구가어려움을겪을때모른척하지않고끝까지도와주어서함께문제를해결하는착한마음이다' }, first: false },
  ];
  for (const c of CASES)
    test(`${c.name} — 4 뷰포트에서 제시·안내 다 보이고 캔버스 ≥ 480`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await bootDev(page, dev.url);
      for (const vp of VIEWPORTS) {
        await page.setViewportSize(vp);
        const m = await page.evaluate(async (c) => {
          const w = window as any;
          const { DrawScreen } = await import(/* @vite-ignore */ '/src/ui/play/DrawScreen.tsx' as string);
          const el = document.getElementById('app')!;
          w.__render(null, el);
          w.__render(w.__h(DrawScreen, { input: c.input, first: c.first, image: () => undefined, totalSeconds: 60, remainingMs: () => 45000, nextName: '김철수', submitted: false, onSubmit: () => {}, sound: () => {} }), el);
          await new Promise((r) => setTimeout(r, 120));
          const q = (s: string) => el.querySelector<HTMLElement>(s);
          const p = q('.prompt')!.getBoundingClientRect();
          const hint = q('.prompt .hint');
          return {
            hint: hint?.textContent ?? null,
            sh: q('.prompt .text')!.scrollHeight,
            ch: q('.prompt .text')!.clientHeight,
            psh: q('.prompt')!.scrollHeight,
            pch: q('.prompt')!.clientHeight,
            hintIn: !hint || hint.getBoundingClientRect().bottom <= p.bottom + 0.5,
            prompt: p.height,
            canvas: q('canvas')!.getBoundingClientRect().width,
            submit: q('.book > .submit')!.getBoundingClientRect().bottom,
            doc: document.documentElement.scrollHeight,
            vh: innerHeight,
          };
        }, c);
        const at = `${vp.width}×${vp.height} ${JSON.stringify(m)}`;
        if (c.input.fallbackNote) expect(m.hint, at).toBe(FALLBACK_NOTE); // 대체 안내는 절대 빼지 않는다
        expect(m.sh, at).toBeLessThanOrEqual(m.ch);
        expect(m.psh, at).toBeLessThanOrEqual(m.pch);
        expect(m.hintIn, at).toBe(true);
        expect(m.canvas, at).toBeGreaterThanOrEqual(480);
        expect(m.submit, at).toBeLessThanOrEqual(m.vh);
        expect(m.doc, at).toBeLessThanOrEqual(m.vh);
      }
    });
});
