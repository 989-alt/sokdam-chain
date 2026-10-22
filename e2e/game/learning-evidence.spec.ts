// 학습 매핑표 관찰 증거(PRD §2): L2 B 방식 첫 그리기에 원문 없음, L3 답 쓰기에 원문·뜻 없음, L1·L6·L7 체인마다 카드로 끝남.
// 제시어 확인: 앱에 VITE_TEST_SEED 가 없어서, 0단계 화면의 뜻(B)을 본 목록(words/*.json)에서 찾아 word 를 안다(뜻은 모두 서로 다름 — helpers 가 시작 때 검사).
import { expect, test } from '@playwright/test';
import { byChain, closeAll, draw, html, playSteps, setupRoom, stepCount, walkReviewManual, wordByMeaning, wordByText, type Word } from '../helpers/game';

test('B 방식 4명 한 판 — L2·L3·L1·L6·L7', async ({ browser }) => {
  test.setTimeout(150_000);
  const n = 4;
  const steps = stepCount(n);
  const { players, names } = await setupRoom(browser, n, { mode: 'B', review: 'manual' });
  await players[0]!.getByRole('button', { name: '시작하기' }).click();

  const words = new Map<string, Word>(); // 책 주인 → 제시어
  let guessChecks = 0;
  let laterChecks = 0;
  // 누설 검사 대상: document.documentElement.outerHTML 스냅샷 — 렌더된 DOM 의 텍스트·속성(aria-label·alt·title·data-*)·인라인 style 을 본다.
  // 보지 않는 것: JS 메모리(세션 상태)·네트워크 메시지·blob 그림 속 픽셀·스냅샷 사이에 잠깐 떴다 사라진 노드.
  const step0Doms: string[] = [];
  let waitingDom = '';
  // 0단계 제출 뒤 기다리기 화면도 한 번 본다: slot 0 이 먼저 내고 기다리기 화면을 찍을 때까지 slot n−1 은 제출을 미룬다
  let scanned!: () => void;
  const waitingScanned = new Promise<void>((r) => (scanned = r));
  await playSteps(players, names, {
    onCell: async (slot, step, p, owner) => {
      const dom = await html(p);
      if (step === 0) {
        step0Doms.push(dom);
        // L2: 첫 그리기 화면엔 뜻만 — word.text 는 DOM 어디에도 없다
        const meaning = (await p.locator('.screen-draw .prompt .text').textContent())!.trim();
        const word = wordByMeaning(meaning);
        expect(word, `뜻 '${meaning}' 이 본 목록에 있다`).toBeTruthy();
        await expect(p.locator('.screen-draw .prompt .label')).toHaveText('이 뜻을 그림으로 그려 보세요');
        expect(await p.evaluate(() => document.body.textContent)).toContain(word!.meaning);
        expect(dom).not.toContain(word!.text);
        words.set(owner, word!);
        if (slot === n - 1) await waitingScanned;
        if (slot !== 0) return;
        await draw(p);
        await expect(p.locator('.waiting')).toBeVisible();
        waitingDom = await html(p);
        scanned();
        return true; // slot 0 은 여기서 이미 냈다
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
  // 0단계 스냅샷·기다리기 화면을 이 판의 모든 제시어 원문에 대해 다시 훑는다(자기 것만이 아니라)
  expect(step0Doms).toHaveLength(n);
  expect(waitingDom).not.toBe('');
  for (const dom of [...step0Doms, waitingDom]) for (const w of words.values()) expect(dom).not.toContain(w.text);
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
