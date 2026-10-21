// S3 인원 한계: 3명은 시작 불가(사유 문구), 7번째 입장은 '방이 꽉 찼어요'.
import { expect, test } from '@playwright/test';
import { closeAll, device, NAMES, seats, setupRoom } from '../helpers/game';

test.describe.configure({ mode: 'parallel' });

test('3명 — 시작 버튼 비활성 + 4명부터 시작할 수 있어요', async ({ browser }) => {
  const { players } = await setupRoom(browser, 3);
  const h = players[0]!;
  const startBtn = h.getByRole('button', { name: '시작하기' });
  await expect(startBtn).toHaveAttribute('aria-disabled', 'true');
  await expect(h.locator('#start-reason')).toContainText('4명부터 시작할 수 있어요');
  await startBtn.click({ force: true }); // aria-disabled 라 실행 가능 검사를 건너뛰고 탭한다
  await expect(h.locator('.screen-lobby')).toBeVisible(); // 눌러도 대기실 그대로
  for (const p of players) await expect(p.locator('.screen-draw')).toHaveCount(0);
  await closeAll(players);
});

test('7번째 입장 — 방이 꽉 찼어요, 대기실은 6명', async ({ browser }) => {
  test.setTimeout(90_000);
  const { players, code } = await setupRoom(browser, 6);
  const seventh = await device(browser);
  await seventh.goto('/#/join');
  await seventh.locator('#room-code').fill(code);
  await seventh.locator('#join-name').fill(NAMES[6]!);
  await seventh.getByRole('button', { name: '들어가기' }).click();
  await expect(seventh.getByRole('alert')).toContainText('방이 꽉 찼어요', { timeout: 10_000 });
  await expect(seventh.locator('.screen-lobby')).toHaveCount(0);
  await expect(seats(players[0]!)).toHaveCount(6);
  await expect(players[0]!.getByRole('button', { name: '시작하기' })).toHaveAttribute('aria-disabled', 'false');
  await closeAll([...players, seventh]);
});
