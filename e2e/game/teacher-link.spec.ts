// 교사 링크: 교사 화면에 줄 입력 → '이 목록만' 링크 → 새 컨텍스트가 그 링크로 홈 진입 → 수준 선택 없음 → 판의 제시어가 교사 항목.
import { expect, test } from '@playwright/test';
import { closeAll, device, join, NAMES, promptText, stepCount, waitCell } from '../helpers/game';

// 온라인은 4명부터라 체인 4개 — '이 목록만' 이면 항목이 4개 이상이어야 시작된다(계약 예시는 3줄).
const ITEMS = [
  { t: '가는 말이 고와야 오는 말이 곱다', m: '내가 남에게 잘해야 남도 나에게 잘한다', e: '고운 말을 쓰니 친구도 고운 말로 답했다.' },
  { t: '낮말은 새가 듣고 밤말은 쥐가 듣는다', m: '말은 늘 조심해야 한다', e: '' },
  { t: '세 살 버릇 여든까지 간다', m: '어릴 때 버릇은 늙어서도 고치기 어렵다', e: '어릴 때부터 일찍 자는 버릇을 들였다.' },
  { t: '티끌 모아 태산', m: '작은 것도 모이면 큰 것이 된다', e: '용돈을 조금씩 모아 자전거를 샀다.' },
];

test('교사 목록(이 목록만) 링크 → 새 기기 홈 → 수준 선택 없음 → 제시어가 교사 항목', async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const teacher = await device(browser);
  await teacher.goto('/#/teacher');
  await teacher.locator('#teacher-lines').fill(ITEMS.map((x) => [x.t, x.m, x.e].join(' | ')).join('\n'));
  await teacher.getByRole('radio', { name: '이 목록만' }).check({ force: true });
  await expect(teacher.locator('.teacher-errors')).toHaveCount(0);
  const link = teacher.locator('#teacher-link');
  await expect(link).toHaveValue(/#l=/);
  const url = await link.inputValue();
  expect(url.startsWith(new URL('/#l=', baseURL).href)).toBe(true);
  await teacher.context().close();

  const host = await device(browser);
  await host.goto(url);
  await expect(host.getByText(`선생님 목록 사용 중 (${ITEMS.length}개)`)).toBeVisible();
  await host.getByRole('link', { name: '방 만들기' }).click();
  await expect(host.locator('fieldset.level')).toHaveCount(0);
  await host.locator('#host-name').fill(NAMES[0]!);
  await host.getByRole('button', { name: '방 만들기' }).click();
  const code = (await host.locator('.code').textContent({ timeout: 15_000 }))!;
  expect(code).toMatch(/^\d{6}$/);
  await expect(host.locator('.summary')).toContainText('선생님 목록만');

  const players = [host];
  for (let i = 1; i < 4; i++) {
    const p = await device(browser);
    await join(p, code, NAMES[i]!);
    players.push(p);
  }
  await host.getByRole('button', { name: '시작하기' }).click();
  const steps = stepCount(4);
  const prompts = await Promise.all(players.map(async (p) => (await waitCell(p, 0, steps), (await promptText(p))!)));
  expect(prompts.sort()).toEqual(ITEMS.map((x) => x.t).sort());
  await closeAll(players);
});
