// S3 완주: 5명(수동 결과·제출 연타·투표 동점·한 판 더), 6명(수동), 4명(타이머 만료 자동 제출 + 결과 자동 넘김).
import { expect, test } from '@playwright/test';
import {
  byChain,
  closeAll,
  draw,
  expectTieResult,
  playSteps,
  promptText,
  sent,
  setupRoom,
  start,
  stepCount,
  voteEvenly,
  waitCell,
  walkReviewManual,
} from '../helpers/game';

test.describe.configure({ mode: 'parallel' });

/** 결과 장 순서 기본 검사: 체인 수 × (단계 수 + 2), 체인마다 prompt → 그림/답 번갈아 → card. */
function expectPageOrder(recs: { owner: string; kind: string }[], n: number) {
  const steps = stepCount(n);
  expect(recs).toHaveLength(n * (steps + 2));
  const chains = byChain(recs as never);
  expect(chains.size).toBe(n);
  for (const [, pages] of chains) {
    const kinds = pages.map((p) => p.kind);
    expect(kinds).toEqual(['prompt', ...Array.from({ length: steps }, (_, s) => (s % 2 ? 'guess' : 'draw')), 'card']);
  }
}

test('5명 완주 — 대기실 → 4단계 → 수동 결과 보기 → 투표(동점) → 결과 → 한 판 더, 제출 연타 1건', async ({ browser }) => {
  test.setTimeout(170_000);
  const { players, names } = await setupRoom(browser, 5, { review: 'manual', spy: true });
  await start(players[0]!);
  const steps = stepCount(5);
  expect(steps).toBe(4);
  const spammer = players[1]!;

  // 0단계: 학생 1 이 '다 그렸어요' 를 한 번에 5번 누른다 → 보낸 submit-draw 1건
  const spamOwner = await waitCell(spammer, 0, steps);
  const spamPrompt = (await promptText(spammer))!;
  await spammer.locator('.screen-draw .submit').evaluate((b) => {
    for (let i = 0; i < 5; i++) (b as HTMLButtonElement).click();
  });
  await expect.poll(() => sent(spammer, 'submit-draw')).toBe(1);
  const prompts = await playSteps(players, names, {
    idle: { 0: [1] },
    onCell: async (slot, step, p) => {
      if (slot === 1 && step === 1) {
        // 답 쓰기 연타: 폼 제출을 같은 틱에 5번 → 보낸 submit-guess 1건
        await p.locator('#answer').fill('연타 답');
        await p.locator('.play-guess .submit').evaluate((b) => {
          for (let i = 0; i < 5; i++) (b as HTMLButtonElement).click();
        });
        await expect.poll(() => sent(p, 'submit-guess')).toBe(1);
        await expect(p.locator('#answer')).toHaveCount(0);
        return true;
      }
    },
  });
  // 연타한 학생은 단계마다 정확히 1건만 보냈다(0단계 그림 1 + 2단계 그림 1)
  expect(await sent(spammer, 'submit-draw')).toBe(2);
  expect(await sent(spammer, 'submit-guess')).toBe(2);
  prompts.set(spamOwner, spamPrompt);
  expect(prompts.size).toBe(5);

  const recs = await walkReviewManual(players, 5 * (steps + 2));
  expectPageOrder(recs, 5);

  await voteEvenly(players, names);
  await expectTieResult(players, names);
  for (const p of players.slice(1)) await expect(p.getByRole('button', { name: '한 판 더' })).toHaveCount(0);

  // 한 판 더 → 대기실 없이 전원 새 판 0단계, 제시어가 이전과 다름
  await players[0]!.getByRole('button', { name: '한 판 더' }).click();
  const again = await Promise.all(
    players.map(async (p) => {
      await expect(p.locator('.screen-lobby')).toHaveCount(0);
      await waitCell(p, 0, steps, 20_000);
      return (await promptText(p))!;
    }),
  );
  expect(new Set(again).size).toBe(5);
  for (const w of again) expect([...prompts.values()]).not.toContain(w);
  await closeAll(players);
});

test('6명 완주 — 6단계 → 수동 결과 보기 48장 → 투표 → 결과', async ({ browser }) => {
  test.setTimeout(170_000);
  const { players, names } = await setupRoom(browser, 6, { review: 'manual' });
  await start(players[0]!);
  await playSteps(players, names);
  const recs = await walkReviewManual(players, 6 * (6 + 2));
  expectPageOrder(recs, 6);
  await voteEvenly(players, names);
  await expectTieResult(players, names);
  await closeAll(players);
});

test('4명 완주 — 그리기 30초 만료 자동 제출, 결과 3초 자동 넘김', async ({ browser }) => {
  test.setTimeout(175_000);
  const { players, names } = await setupRoom(browser, 4, { drawSeconds: 30, review: 3 });
  await start(players[0]!);
  const steps = stepCount(4);
  const idle = 3; // 0단계에 아무것도 안 하는 학생

  // 0단계: 나머지 셋만 제출 → 기한 전엔 다음 단계로 가지 않음
  await Promise.all(players.slice(0, 3).map(async (p) => (await waitCell(p, 0, steps), draw(p))));
  await expect(players[idle]!.locator('.screen-draw .book')).toBeVisible();
  await expect(players[0]!.locator('.waiting .big')).toHaveText('3 / 4 제출');
  // 기한(30초) 뒤 학생 기기가 스스로 제출 → 1단계. 그 그림을 받은 사람(slot 0)은 대체 안내 없이 그림을 본다
  await waitCell(players[0]!, 1, steps, 40_000);
  await expect(players[0]!.locator('.chip.book-tag')).toContainText(names[idle]!);
  await expect(players[0]!.locator('.guess-book img.drawing')).toBeVisible();
  await expect(players[0]!.locator('.guess-book .fallback')).toHaveCount(0);

  await playSteps(players, names, { from: 1 });

  // 결과 보기: 아무도 누르지 않아도 넘어간다. 넘김 버튼은 누구에게도 없다
  for (const p of players) await expect(p.locator('.screen-review')).toBeVisible({ timeout: 20_000 });
  for (const p of players) await expect(p.locator('.review-foot button')).toHaveCount(0);
  const progress = players[0]!.locator('.review-head .progress');
  const first = await progress.textContent();
  await expect(progress).not.toHaveText(first!, { timeout: 6_000 });
  // 자동 넘김 중 만료 그림 장: idle 학생 책 0단계 그림이 '그림 없음' 이 아니다
  const h = players[0]!;
  const state = async () => {
    const chip = (await h.locator('.review-head .chip.book-tag').textContent()) ?? '';
    const pos = ((await progress.textContent()) ?? '').trim();
    if (!chip.includes(names[idle]!) || !/(^|\D)2 \/ 6$/.test(pos)) return 'other';
    return (await h.locator('.spread .pic img.drawing').count()) ? 'drawing' : 'missing';
  };
  let last = 'other';
  await expect.poll(async () => (last = await state()), { timeout: 80_000, intervals: [200] }).not.toBe('other');
  expect(last).toBe('drawing');
  // 4 × 6 = 24장 × 3초 뒤 투표
  await voteEvenly(players, names);
  await expectTieResult(players, names);
  await closeAll(players);
});
