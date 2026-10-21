// T05 셸·대기실 e2e. 기본 webServer(로컬 시그널링 9000 + 빌드 미리보기 5173)를 쓴다. 기기 = 브라우저 컨텍스트 하나.
import { type Browser, type Page, expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { encodeList } from '../src/teacher/list';

async function device(browser: Browser, viewport = { width: 768, height: 1024 }) {
  const ctx = await browser.newContext({ viewport, hasTouch: true });
  return ctx.newPage();
}

async function host(page: Page, name = '방장', hash = '#/create'): Promise<string> {
  await page.goto('/' + hash);
  await page.locator('#host-name').fill(name);
  await page.getByRole('button', { name: '방 만들기' }).click();
  const code = page.locator('.code');
  await expect(code).toHaveText(/^\d{6}$/, { timeout: 15_000 });
  return (await code.textContent())!;
}

async function join(page: Page, code: string, name: string) {
  await page.goto('/#/join');
  await page.locator('#room-code').fill(code);
  await page.locator('#join-name').fill(name);
  await page.getByRole('button', { name: '들어가기' }).click();
  await expect(page.locator('.screen-lobby')).toBeVisible({ timeout: 15_000 });
}

const seats = (page: Page) => page.locator('.desk li:not(.empty)');

test('home: mode choice, mute toggle, teacher link small', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '여럿이 각자 기기로' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '기기 한 대 돌려쓰기' })).toBeVisible();
  await expect(page.getByText('이어하기')).toHaveCount(0);
  const mute = page.locator('button.mute');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: '돌려쓰기 시작' }).click();
  await expect(page).toHaveURL(/#\/pass$/);
  await page.goto('/');
  await page.getByRole('link', { name: /문제 목록 만들기/ }).click();
  await expect(page.locator('#teacher-lines')).toBeVisible();
});

test.describe('name input', () => {
  test.beforeEach(async ({ page }) => page.goto('/#/create'));
  const submit = (page: Page) => page.getByRole('button', { name: '방 만들기' });

  test('empty and spaces-only disable the button', async ({ page }) => {
    await expect(submit(page)).toBeDisabled();
    await page.locator('#host-name').fill('   ');
    await expect(submit(page)).toBeDisabled();
    await page.locator('#host-name').fill(' 서연 ');
    await expect(submit(page)).toBeEnabled();
  });
  test('12 characters max', async ({ page }) => {
    await page.locator('#host-name').pressSequentially('가나다라마바사아자차카타파하');
    await expect(page.locator('#host-name')).toHaveValue('가나다라마바사아자차카타');
  });
  test('banned word shows masked preview while typing', async ({ page }) => {
    await page.locator('#host-name').pressSequentially('바보민수');
    await expect(page.locator('.preview')).toContainText('●●민수');
  });
});

test('room code input: numeric, strips non-digits, needs 6', async ({ page }) => {
  await page.goto('/#/join');
  const code = page.locator('#room-code');
  await expect(code).toHaveAttribute('inputmode', 'numeric');
  await page.locator('#join-name').fill('민재');
  await code.pressSequentially('12a 3-45');
  await expect(code).toHaveValue('12345');
  await expect(page.getByRole('button', { name: '들어가기' })).toBeDisabled();
  await code.pressSequentially('67');
  await expect(code).toHaveValue('123456');
  await expect(page.getByRole('button', { name: '들어가기' })).toBeEnabled();
});

test('unknown room code → 방을 찾을 수 없어요 within 8 s', async ({ page }) => {
  await page.goto('/#/join');
  await page.locator('#room-code').fill('000001');
  await page.locator('#join-name').fill('민재');
  await page.getByRole('button', { name: '들어가기' }).click();
  await expect(page.getByText('방을 찾을 수 없어요. 코드를 다시 확인해요')).toBeVisible({ timeout: 9_000 });
});

test('lobby: start only for host, 3 → disabled with reason, 4 → enabled; joins/leaves/disconnects show', async ({ browser }) => {
  const h = await device(browser);
  const code = await host(h, '서연');
  await expect(h.locator('.lobby-empty')).toBeVisible();
  const [a, b, c] = [await device(browser), await device(browser), await device(browser)];
  await join(a, code, '민재');
  await expect(seats(h)).toHaveCount(2, { timeout: 1_000 });
  await join(b, code, '지우');
  await expect(seats(h)).toHaveCount(3, { timeout: 1_000 });

  const start = h.getByRole('button', { name: '시작하기' });
  await expect(start).toHaveAttribute('aria-disabled', 'true');
  await expect(h.locator('#start-reason')).toContainText('4명부터 시작할 수 있어요');
  await expect(a.getByRole('button', { name: '시작하기' })).toHaveCount(0);
  await expect(a.getByText('방장이 시작하기를 기다려요')).toBeVisible();
  await expect(a.locator('.code')).toHaveText(code);

  await join(c, code, '하준');
  await expect(start).toHaveAttribute('aria-disabled', 'false', { timeout: 1_000 });
  await expect(seats(a)).toHaveCount(4, { timeout: 1_000 });

  // 나가기 → 목록에서 빠짐, 시작 다시 막힘
  await c.getByRole('button', { name: '나가기' }).click();
  await expect(c.getByText('방에서 나왔어요')).toBeVisible();
  await expect(seats(h)).toHaveCount(3, { timeout: 1_000 });
  await expect(start).toHaveAttribute('aria-disabled', 'true');

  // 탭 닫힘 → 흐리게 + 숨은 '연결 끊김'
  await b.context().close();
  const off = h.locator('.desk li.off');
  await expect(off).toHaveCount(1, { timeout: 10_000 });
  await expect(off).toContainText('지우');
  await expect(off.locator('.sr')).toHaveText('연결 끊김');
  await expect(h.locator('#start-reason')).toContainText('연결 끊김: 지우');

  // 방장 나가기 → 학생 종료 화면 → 홈으로
  await h.getByRole('button', { name: '나가기' }).click();
  await expect(h.getByText('방에서 나왔어요')).toBeVisible();
  await expect(a.getByText('방장 연결이 끊겨 게임이 끝났어요')).toBeVisible({ timeout: 5_000 });
  await a.getByRole('button', { name: '홈으로' }).click();
  await expect(a.getByRole('heading', { name: '여럿이 각자 기기로' })).toBeVisible();
  await expect(a.getByText('이어하기')).toHaveCount(0); // 종료 받으면 net 층이 세션 키를 지웠다
});

test('resume: reload during lobby → 이어하기 → back in lobby', async ({ browser }) => {
  const h = await device(browser);
  const code = await host(h, '서연');
  const s = await device(browser);
  await join(s, code, '민재');
  await s.reload();
  const resume = s.getByRole('button', { name: '이어하기' });
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(s.locator('.screen-lobby')).toBeVisible({ timeout: 15_000 });
  await expect(s.locator('.chip.player')).toContainText('민재');
  await expect(seats(h)).toHaveCount(2);
});

test('browser back in the room does not change the screen', async ({ page }) => {
  await page.goto('/');
  await host(page, '서연');
  await page.goBack();
  await page.waitForTimeout(300);
  await expect(page.locator('.screen-lobby')).toBeVisible();
  await expect(page).toHaveURL(/#\/room$/);
});

test('browser back inside pass-around stays; 홈으로 leaves', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: '돌려쓰기 시작' }).click();
  await expect(page).toHaveURL(/#\/pass$/);
  await page.goBack();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/#\/pass$/);
  await expect(page.getByRole('region', { name: '돌려쓰기 설정' })).toBeVisible();
  await page.getByRole('button', { name: '홈으로' }).click();
  await expect(page.getByRole('heading', { name: '여럿이 각자 기기로' })).toBeVisible();
});

test.describe('teacher link', () => {
  test('valid only-list → badge with count, level hidden, room uses it', async ({ page }) => {
    const enc = encodeList('only', [
      { t: '가는 말이 고와야 오는 말이 곱다', m: '내가 남에게 잘해야 남도 나에게 잘한다', e: '' },
      { t: '낮말은 새가 듣고 밤말은 쥐가 듣는다', m: '말은 늘 조심해야 한다', e: '' },
    ]);
    if (!enc.ok) throw new Error('encode');
    await page.goto('/' + enc.hash);
    await expect(page.getByText('선생님 목록 사용 중 (2개)')).toBeVisible();
    await page.getByRole('link', { name: '방 만들기' }).click();
    await expect(page.getByText('선생님 목록 사용 중 (2개)')).toBeVisible();
    await expect(page.locator('fieldset.level')).toHaveCount(0);
    await page.locator('#host-name').fill('서연');
    await page.getByRole('button', { name: '방 만들기' }).click();
    await expect(page.locator('.summary')).toContainText('선생님 목록만');
  });

  test('broken link → toast, default list', async ({ page }) => {
    await page.goto('/#l=not-a-valid-list');
    await expect(page.getByRole('alert')).toContainText('링크가 잘못됐');
    await expect(page.getByText(/선생님 목록 사용 중/)).toHaveCount(0);
    await page.getByRole('link', { name: '방 만들기' }).click();
    await expect(page.locator('fieldset.level')).toBeVisible();
  });
});

for (const viewport of [
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
]) {
  test(`layout ${viewport.width}x${viewport.height}: buttons visible, no overlap, touch ≥56, text ≥18`, async ({ browser }, info) => {
    const page = await device(browser, viewport);
    const check = async (shot: string) => {
      const boxes = await page.locator('button:visible, a.btn:visible, a.linkbtn:visible').evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height, t: e.textContent?.trim() ?? '' };
        }),
      );
      expect(boxes.length).toBeGreaterThan(0);
      for (const b of boxes) expect(b.w * b.h, b.t).toBeGreaterThan(0);
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const p = boxes[i]!, q = boxes[j]!;
          const overlap = p.x < q.x + q.w - 1 && q.x < p.x + p.w - 1 && p.y < q.y + q.h - 1 && q.y < p.y + p.h - 1;
          expect(overlap, `${p.t} × ${q.t}`).toBe(false);
        }
      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollW).toBeLessThanOrEqual(viewport.width);
      for (const h of await page.locator('.btn.primary:visible, .btn.secondary:visible, .opt:visible, button.mute:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height)))
        expect(h).toBeGreaterThanOrEqual(56);
      const body = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
      expect(body).toBeGreaterThanOrEqual(18);
      await page.screenshot({ path: info.outputPath(`${shot}.png`), fullPage: true });
    };
    await page.goto('/');
    await check('home');
    await page.goto('/#/join');
    await check('join');
    await host(page, '서연');
    await check('lobby');
    await page.getByRole('button', { name: '나가기' }).click();
    await check('ended');
    await page.getByRole('button', { name: '홈으로' }).click();
    await page.getByRole('link', { name: '방 만들기' }).click();
    await expect(page.locator('#host-name')).toBeVisible();
    await check('create');
  });
}

test('reduced motion turns transitions off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const d = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--motion-duration-normal').trim());
  expect(d).toMatch(/^0m?s$/);
});

test.describe('signaling down', () => {
  test('create room fails → 돌려쓰기 suggestion', async ({ page }) => {
    // 닫힌 포트로 빌드한 별도 dev 서버(Vite 는 process.env 의 VITE_* 를 읽는다).
    Object.assign(process.env, { VITE_SIGNALING_HOST: '127.0.0.1', VITE_SIGNALING_PORT: '9', VITE_SIGNALING_SECURE: 'false' });
    const server = await createServer({
      root: fileURLToPath(new URL('..', import.meta.url)),
      logLevel: 'error',
      server: { host: '127.0.0.1', port: 5198, strictPort: true },
    });
    await server.listen();
    try {
      await page.goto('http://127.0.0.1:5198/#/create');
      await page.locator('#host-name').fill('서연');
      await page.getByRole('button', { name: '방 만들기' }).click();
      await expect(page.getByText('지금은 연결할 수 없어요. 기기 한 대 돌려쓰기로 해 보세요')).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: '돌려쓰기' }).click();
      await expect(page).toHaveURL(/#\/pass$/);
    } finally {
      await server.close();
    }
  });
});
