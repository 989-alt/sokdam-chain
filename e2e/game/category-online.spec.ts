// 온라인 묶음 경로: 방장이 관용표현을 고르면 학생 4명의 0단계 제시어가 모두 관용표현이고, 답 쓰기 안내가 "관용표현을".
import { expect, test } from '@playwright/test';
import { closeAll, draw, promptText, setupRoom, start, stepCount, waitCell, wordByText } from '../helpers/game';

test('온라인 관용표현 — 제시어 묶음·대기실 칩·답 쓰기 안내', async ({ browser }) => {
  test.setTimeout(120_000);
  const { players } = await setupRoom(browser, 4, { category: '관용표현', review: 'manual' });
  await expect(players[1]!.locator('.summary .chip').first()).toHaveText('관용표현'); // 학생도 joined settings 로 본다
  await start(players[0]!);
  const steps = stepCount(4);
  for (const p of players) {
    await waitCell(p, 0, steps);
    expect(wordByText((await promptText(p))!)?.type).toBe('관용표현');
  }
  await Promise.all(players.map((p) => draw(p)));
  for (const p of players) {
    await waitCell(p, 1, steps);
    await expect(p.locator('.page.lined .ask')).toHaveText('이 그림이 나타내는 관용표현을 써 보세요');
  }
  await closeAll(players);
});
