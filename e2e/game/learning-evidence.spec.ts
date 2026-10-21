// 학습 매핑표 관찰 증거(PRD §2): L2 B 방식 첫 그리기에 원문 없음, L3 답 쓰기에 원문·뜻 없음, L1·L6·L7 체인마다 카드로 끝남.
// 제시어 확인: 앱에 VITE_TEST_SEED 가 없어서, 0단계 화면의 뜻(B)을 words.json 에서 찾아 word 를 안다(뜻은 44개 모두 서로 다름).
import { expect, test } from '@playwright/test';
import { byChain, closeAll, html, playSteps, setupRoom, stepCount, walkReviewManual, wordByMeaning, wordByText, type Word } from '../helpers/game';

test('B 방식 4명 한 판 — L2·L3·L1·L6·L7', async ({ browser }) => {
  test.setTimeout(150_000);
  const n = 4;
  const steps = stepCount(n);
  const { players, names } = await setupRoom(browser, n, { mode: 'B', review: 'manual' });
  await players[0]!.getByRole('button', { name: '시작하기' }).click();

  const words = new Map<string, Word>(); // 책 주인 → 제시어
  let guessChecks = 0;
  let laterChecks = 0;
  await playSteps(players, names, {
    onCell: async (_slot, step, p, owner) => {
      const dom = await html(p);
      if (step === 0) {
        // L2: 첫 그리기 화면엔 뜻만 — word.text 는 DOM 어디에도 없다
        const meaning = (await p.locator('.screen-draw .prompt .text').textContent())!.trim();
        const word = wordByMeaning(meaning);
        expect(word, `뜻 '${meaning}' 이 words.json 에 있다`).toBeTruthy();
        await expect(p.locator('.screen-draw .prompt .label')).toHaveText('이 뜻을 그림으로 그려요');
        expect(await p.evaluate(() => document.body.textContent)).toContain(word!.meaning);
        expect(dom).not.toContain(word!.text);
        words.set(owner, word!);
        return;
      }
      // 0단계가 모두 끝난 뒤의 칸: 그 판의 어떤 제시어 원문도 화면에 없다(결과 보기 전까지)
      await expect.poll(() => words.size).toBe(n);
      for (const w of words.values()) expect(dom).not.toContain(w.text);
      laterChecks++;
      if (step % 2) {
        // L3: 답 쓰기엔 앞 그림 하나와 입력란만 — 이 책 제시어의 원문·뜻 모두 없다(다른 책 것도)
        const word = words.get(owner)!;
        expect(dom).not.toContain(word.text);
        expect(dom).not.toContain(word.meaning);
        for (const w of words.values()) expect(dom).not.toContain(w.meaning);
        await expect(p.locator('.guess-book article.page img.drawing')).toHaveCount(1);
        await expect(p.locator('.guess-book .fallback')).toHaveCount(0);
        guessChecks++;
      }
    },
  });
  expect(words.size).toBe(n);
  expect(guessChecks).toBe(n * (steps / 2));
  expect(laterChecks).toBe(n * (steps - 1));

  const recs = await walkReviewManual(players, n * (steps + 2));
  const chains = byChain(recs);
  // L1: card 장 수 == 체인 수, 각 체인의 마지막 장이 card
  expect(recs.filter((r) => r.kind === 'card')).toHaveLength(n);
  expect(chains.size).toBe(n);
  for (const [owner, pages] of chains) {
    const last = pages.at(-1)!;
    expect(last.kind).toBe('card');
    // 카드의 정답 = 그 책 0단계 제시어
    const word = wordByText(last.word!);
    expect(word).toEqual(words.get(owner));
    // L6: 카드에 word.example
    expect(last.example).toBe(word!.example);
    // L7: 카드 직전 장은 답 장
    expect(pages.at(-2)!.kind).toBe('guess');
    // B 방식 첫 장은 뜻
    expect(pages[0]!.kind).toBe('prompt');
  }
  await closeAll(players);
});
