// 돌려쓰기: 기기(컨텍스트) 하나, 4명·스케치북 2권 완주. 가림 화면엔 앞사람 그림·답이 DOM 에 없다.
import { expect, test } from '@playwright/test';
import { answerOf, device, draw, guess, html, NAMES, promptText, stepCount } from '../helpers/game';

test('4명·체인 2개 완주 — 가림 화면 DOM 에 앞 내용 없음, 결과 12장 체인마다 카드, 투표 → 결과', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await device(browser);
  const names = NAMES.slice(0, 4);
  const steps = stepCount(4);
  await page.goto('/#/pass');
  await page.getByRole('button', { name: '한 명 더' }).click();
  for (let i = 0; i < 4; i++) await page.locator(`#pass-name-${i}`).fill(names[i]!);
  await expect(page.getByRole('button', { name: '2권' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '시작하기' }).click();

  const cover = page.locator('.pass-cover');
  const ready = async () => {
    const btn = cover.getByRole('button', { name: '준비됐어요' });
    await expect(btn).toHaveAttribute('aria-disabled', 'false'); // 400ms 잠금 뒤
    await btn.click();
  };
  const answers: string[] = [];
  const words: string[] = []; // 각 권 0단계 제시어(A 원문)
  for (let t = 0; t < steps * 2; t++) {
    await expect(cover).toBeVisible();
    // 가림 화면: 앞 화면은 언마운트 — 캔버스·받은 그림·앞사람 답이 DOM 에 없다
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(0);
    const dom = await html(page);
    for (const a of [...answers, ...words]) expect(dom).not.toContain(a);
    const who = (await cover.locator('h1.h').textContent())!.split(' 차례예요')[0]!;
    await ready();
    const step = t % steps;
    if (step % 2) {
      const a = answerOf(who, t);
      await guess(page, a);
      answers.push(a);
    } else {
      if (step === 0) words.push((await promptText(page))!);
      await draw(page);
    }
  }
  expect(words).toHaveLength(2);

  // 결과 보기: 2권 × (4 + 2) = 12장, 권마다 prompt → 그림 → 답 → 그림 → 답 → 카드
  await expect(page.locator('.screen-review')).toBeVisible();
  const kinds: string[] = [];
  for (let i = 0; i < 2 * (steps + 2); i++) {
    await expect(page.locator('.review-head .progress')).toContainText(`${(i % (steps + 2)) + 1} / ${steps + 2}`);
    const spread = page.locator('.spread');
    kinds.push((await spread.locator('.meaning').count()) ? 'card' : (await spread.locator('.pic').count()) ? 'draw' : (await spread.locator('.prompt-page').count()) ? 'prompt' : 'guess');
    if (kinds.at(-1) === 'card') await expect(spread.locator('.meaning .example')).not.toBeEmpty();
    await page.getByRole('button', { name: i === 2 * (steps + 2) - 1 ? '투표하러 가요' : '다음 쪽' }).click();
  }
  const book = ['prompt', 'draw', 'guess', 'draw', 'guess', 'card'];
  expect(kinds).toEqual([...book, ...book]);

  // 투표: 한 사람씩 가림 화면 → 고를 수 있는 첫 그림·첫 답
  for (let v = 0; v < 4; v++) {
    await expect(cover).toContainText(`${names[v]} 차례예요`);
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(0);
    await ready();
    for (const b of await page.locator('.cand:has(.mine)').all()) await expect(b).toBeDisabled();
    await page.locator('[aria-label="베스트 그림 후보"] .cand:not([disabled])').first().click();
    await page.locator('[aria-label="베스트 답 후보"] .cand:not([disabled])').first().click();
    await page.getByRole('button', { name: '스티커 다 붙였어요' }).click();
  }
  await expect(page.getByRole('heading', { name: '베스트 그림' })).toBeVisible();
  await expect(page.locator('section[aria-labelledby="best-drawing"] .best li').first()).toContainText('그린 사람 ·');
  await expect(page.getByRole('button', { name: '한 판 더' })).toBeVisible();
  await page.context().close();
});
