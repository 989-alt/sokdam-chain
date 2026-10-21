// PRD §8 연결 끊김: 그리기 중 끊김 → 그림 없음 대체, 답 쓰기 새로고침 → 이어하기, 답 쓰기 끊김 60초 → 다음 단계, 방장 끊김 → 전원 종료.
// 앱엔 VITE_TEST_DISCONNECT_GRACE_MS 가 없어 60초(ABSENT_MS)를 실제로 기다린다.
import { expect, test, type Page } from '@playwright/test';
import { closeAll, draw, guess, answerOf, promptText, setupRoom, stepCount, waitCell } from '../helpers/game';

test.describe.configure({ mode: 'parallel' });

const FALLBACK = '앞사람 것이 없어서';

test('그리기 중 탭 닫힘 → 기한+3초 뒤 다음 사람에게 대체 안내와 그 앞 내용(제시어)', async ({ browser }) => {
  test.setTimeout(120_000);
  const { players } = await setupRoom(browser, 4, { drawSeconds: 30 });
  await players[0]!.getByRole('button', { name: '시작하기' }).click();
  const steps = stepCount(4);
  const gone = 2;
  await waitCell(players[gone]!, 0, steps);
  const word = (await promptText(players[gone]!))!; // A 방식 — 이 책의 원문
  await players[gone]!.context().close();
  await Promise.all([0, 1, 3].map(async (i) => (await waitCell(players[i]!, 0, steps), draw(players[i]!))));

  // 끊긴 학생 책(chain 2)의 1단계 담당 = slot 3
  const next = players[3]!;
  await waitCell(next, 1, steps, 45_000);
  await expect(next.locator('.guess-book .fallback')).toContainText(FALLBACK);
  await expect(next.locator('.guess-book article.page .guess q')).toHaveText(word);
  await expect(next.locator('.guess-book img.drawing')).toHaveCount(0);
  await closeAll(players);
});

test('답 쓰기 차례에 새로고침 → 홈 이어하기 → 같은 단계 복귀 → 제출 성공', async ({ browser }) => {
  test.setTimeout(120_000);
  const { players, names } = await setupRoom(browser, 4);
  await players[0]!.getByRole('button', { name: '시작하기' }).click();
  const steps = stepCount(4);
  await Promise.all(players.map(async (p) => (await waitCell(p, 0, steps), draw(p))));
  const r = players[1]!;
  const owner = await waitCell(r, 1, steps);
  await r.reload();
  const resume = r.getByRole('button', { name: '이어하기' });
  await expect(resume).toBeVisible();
  await resume.click();
  expect(await waitCell(r, 1, steps, 20_000)).toBe(owner);
  await expect(r.locator('.guess-book img.drawing')).toBeVisible();
  await Promise.all(players.map(async (p, i) => (await waitCell(p, 1, steps), guess(p, answerOf(names[i]!, 1)))));
  // 새로고침한 학생 답이 받아져 전원 2단계로
  for (const p of players) await waitCell(p, 2, steps);
  await closeAll(players);
});

test('답 쓰기 차례 탭 닫힘 → 60초 뒤 답 없음으로 다음 단계, 다음 사람은 그 앞 그림을 본다', async ({ browser }) => {
  test.setTimeout(150_000);
  const { players, names } = await setupRoom(browser, 4);
  await players[0]!.getByRole('button', { name: '시작하기' }).click();
  const steps = stepCount(4);
  await Promise.all(players.map(async (p) => (await waitCell(p, 0, steps), draw(p))));
  const gone = 2;
  await waitCell(players[gone]!, 1, steps);
  await players[gone]!.context().close();
  const left = [0, 1, 3];
  await Promise.all(left.map(async (i) => (await waitCell(players[i]!, 1, steps), guess(players[i]!, answerOf(names[i]!, 1)))));
  // 끊긴 사람을 기다리는 동안은 1단계에 머문다
  await expect(players[0]!.locator('.waiting .big')).toHaveText('3 / 4 제출');
  // 끊김 감지 +60초 → 2단계. 빠진 칸은 chain 1(slot 2 의 1단계) → 2단계 담당 slot 3
  // 여유: 끊김 감지(데이터 채널 close 또는 ping 무응답 수 초) + 60초 + 단계 전송 — 100초면 약 30초 남는다
  for (const i of left) await waitCell(players[i]!, 2, steps, 100_000);
  const next = players[3]!;
  await expect(next.locator('.screen-draw .prompt .hint')).toContainText(FALLBACK);
  await expect(next.locator('.screen-draw .prompt-pic img.drawing')).toBeVisible();
  await closeAll(players);
});

// 방장 끊김 → 학생 종료 화면까지 허용 시간. 시계는 방장 close() 직전부터 잰다.
// T03(74a9536) 계산 최악 약 10.1초, 로컬 실측 7.8~8.4초 → 15초 = 최악 + 약 5초 여유(병렬 부하). 계약 12초 의도는 '몇 초 안에 전원 종료'.
const HOST_LOST_WINDOW_MS = 15_000;

async function hostGone(browser: Parameters<typeof setupRoom>[0], close: (host: Page) => Promise<void>) {
  const { players } = await setupRoom(browser, 4);
  await players[0]!.getByRole('button', { name: '시작하기' }).click();
  const steps = stepCount(4);
  for (const p of players) await waitCell(p, 0, steps);
  const t0 = Date.now();
  await close(players[0]!);
  return { students: players.slice(1), t0 };
}

/** 종료 화면이 close() 기준 HOST_LOST_WINDOW_MS 안에 떴는지. */
async function expectEndWithin(students: Page[], t0: number, end: (p: Page) => ReturnType<Page['locator']>) {
  await Promise.all(students.map((p) => expect(end(p)).toBeVisible({ timeout: Math.max(0, t0 + HOST_LOST_WINDOW_MS - Date.now()) })));
  expect(Date.now() - t0).toBeLessThanOrEqual(HOST_LOST_WINDOW_MS);
}

async function goHome(p: Page) {
  await p.getByRole('button', { name: '홈으로' }).click();
  await expect(p.getByRole('heading', { name: '여럿이 각자 기기로' })).toBeVisible();
}

/** 세션 키 삭제 증거: 홈과 새로고침 뒤 홈 모두 '이어하기' 없음. */
async function expectNoResume(p: Page) {
  await expect(p.getByRole('button', { name: '이어하기' })).toHaveCount(0);
  await p.reload();
  await expect(p.getByRole('heading', { name: '여럿이 각자 기기로' })).toBeVisible();
  await expect(p.getByRole('button', { name: '이어하기' })).toHaveCount(0);
}

test('방장 탭 닫힘(페이지 종료 이벤트 있음) → 전원 "방장 연결이 끊겨 게임이 끝났어요", 홈에 이어하기 없음', async ({ browser }) => {
  test.setTimeout(90_000);
  const { students, t0 } = await hostGone(browser, (h) => h.close({ runBeforeUnload: true }));
  await expectEndWithin(students, t0, (p) => p.getByRole('heading', { name: '방장 연결이 끊겨 게임이 끝났어요' }));
  for (const p of students) {
    await goHome(p);
    await expectNoResume(p);
  }
  await closeAll(students);
});

test('방장 컨텍스트 강제 종료(종료 이벤트 없음) → 제한 안에 전원 종료 화면 + 세션 키 삭제', async ({ browser }) => {
  test.setTimeout(90_000);
  const { students, t0 } = await hostGone(browser, (h) => h.context().close());
  await expectEndWithin(students, t0, (p) => p.locator('.screen-end'));
  for (const p of students) await goHome(p);
  // PRD §8: 방장 끊김 → 세션 키 삭제(T03 74a9536 에서 고침 — 전엔 'lost' 로 키가 남았다)
  for (const p of students) await expectNoResume(p);
  await closeAll(students);
});
