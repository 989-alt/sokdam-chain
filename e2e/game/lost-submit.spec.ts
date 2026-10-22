// 잃은 제출(QA r2 #0): 끊김을 알기 전 죽은 채널로 보낸 그림·답 → 재합류 sync(submitted false) 뒤 화면이 다시 마운트되지 않고
// 그린 그림·쓴 답이 그대로 남아 다시 낼 수 있다. 기한 자동 제출을 잃으면 같은 그림을 다시 보낸다(빈 캔버스가 아님). 판은 끝까지 간다.
// 실제 화면(RoomRoute)을 loopback 망·고정 시계로 몬다 — 개발 서버에서 /src 를 import.
import { expect, test, type Page } from '@playwright/test';
import { bootDev, devServer } from '../helpers/dev';

let dev: Awaited<ReturnType<typeof devServer>>;
test.beforeAll(async () => {
  dev = await devServer();
});
test.afterAll(async () => {
  await dev?.close();
});

/** 4인 방(방장 + 학생 3), 학생2 화면을 띄우고 시작한 뒤 캔버스에 획 하나. 학생2 의 0단계 칸 chainIdx 와 어두운 픽셀 수를 돌려준다. */
async function setup(page: Page) {
  await bootDev(page, dev.url);
  return page.evaluate(async () => {
    const im = (p: string) => import(/* @vite-ignore */ p);
    const w = window as any;
    const { createLoopback } = await im('/src/net/loopback.ts');
    const { createHost } = await im('/src/net/host-session.ts');
    const { joinRoom } = await im('/src/net/client-session.ts');
    const { RoomRoute } = await im('/src/app/room.tsx');
    const { POOL } = await im('/src/data/words.ts');
    w.__now = 100000;
    const now = () => w.__now;
    const net = createLoopback();
    const hr = await createHost({ network: net, hostName: '방장', pool: POOL, settings: { category: '속담', mode: 'A', drawSeconds: 30, review: 'manual', sound: false, level: 'e34' }, now });
    const code = hr.host.code;
    const c2 = (await joinRoom({ network: net, code, name: '학생2', now })).client;
    const c3 = (await joinRoom({ network: net, code, name: '학생3', now })).client;
    const c4 = (await joinRoom({ network: net, code, name: '학생4', now })).client;
    const el = document.getElementById('app')!;
    w.__render(null, el);
    w.__render(w.__h(RoomRoute, { room: { client: c2, host: null, code }, onHome: () => {}, onResume: async () => null }), el);
    hr.host.start();
    await new Promise((r) => setTimeout(r, 150));
    const dark = (c: HTMLCanvasElement | OffscreenCanvas) => {
      const d = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! < 100 && d[i + 1]! < 100 && d[i + 2]! < 100 && d[i + 3]! > 200) n++;
      return n;
    };
    const png = () => new Promise<Blob>((r) => Object.assign(document.createElement('canvas'), { width: 8, height: 6 }).toBlob((b) => r(b!), 'image/png'));
    // 방장이 받은 그림(base64)의 어두운 픽셀 수
    const hostDark = async (chainIdx: number, step: number) => {
      const key = [...hr.host.images.keys()].find((k: string) => k.endsWith(`-${chainIdx}-${step}`));
      if (!key) return -1;
      const blob = await (await fetch(`data:application/octet-stream;base64,${hr.host.images.get(key)}`)).blob();
      const bmp = await createImageBitmap(blob);
      const oc = new OffscreenCanvas(bmp.width, bmp.height);
      oc.getContext('2d')!.drawImage(bmp, 0, 0);
      return dark(oc);
    };
    const cut = async (fn: () => Promise<void> | void) => {
      const pid = c2.conn.local;
      net.mute(pid, true); // 채널은 열린 채 말이 사라짐(아직 끊김 모름)
      await fn();
      await new Promise((r) => setTimeout(r, 150)); // 그림 내보내기·base64 는 비동기 — 죽은 채널로 다 나간 뒤
      net.mute(pid, false);
      net.cut(pid);
      await new Promise((r) => setTimeout(r, 800)); // 다시 붙기 → rejoin → sync(submitted false)
    };
    const others = [hr.me, c3, c4];
    Object.assign(w, { __t: { hr, c2, others, dark, png, hostDark, cut } });
    const cv = el.querySelector('canvas')!;
    const rc = cv.getBoundingClientRect();
    const ev = (type: string, x: number, y: number) => cv.dispatchEvent(new PointerEvent(type, { clientX: rc.left + x, clientY: rc.top + y, pointerId: 1, bubbles: true }));
    ev('pointerdown', 50, 50);
    ev('pointermove', 250, 250);
    ev('pointerup', 250, 250);
    return { chainIdx: c2.view.cell.chainIdx as number, before: dark(cv) as number };
  });
}

const canvasDark = (page: Page) =>
  page.evaluate(() => {
    const t = (window as any).__t;
    const cv = document.querySelector('#app canvas') as HTMLCanvasElement | null;
    return { submitted: t.c2.view.submitted as boolean, dark: cv ? (t.dark(cv) as number) : -1 };
  });

test('잃은 그림·답은 화면에 남아 다시 내고 판이 끝까지 간다', async ({ page }) => {
  const s = await setup(page);
  expect(s.before).toBeGreaterThan(1000);
  // 0단계 그림: 죽은 채널로 '다 그렸어요'
  await page.evaluate(() => (window as any).__t.cut(() => (document.querySelector('#app button.submit') as HTMLButtonElement).click()));
  const a = await canvasDark(page);
  expect(a.submitted).toBe(false);
  expect(a.dark).toBeGreaterThan(s.before * 0.95); // 같은 그림이 그대로(다시 마운트되면 0). 기다리기→그리기로 캔버스가 다시 맞춰져 픽셀 몇 개는 달라진다
  await expect(page.locator('#app button.submit')).toBeEnabled(); // 보내기 잠금이 풀림
  await page.locator('#app button.submit').click();
  await expect.poll(() => page.evaluate(() => (window as any).__t.c2.view.submitted)).toBe(true);
  await page.evaluate(async () => {
    const t = (window as any).__t;
    for (const c of t.others) await c.submitDrawing(await t.png());
  });
  await expect.poll(() => page.evaluate(() => (window as any).__t.hr.host.view.step)).toBe(1);
  expect(await page.evaluate((i) => (window as any).__t.hostDark(i, 0), s.chainIdx)).toBeGreaterThan(1000);

  // 1단계 답: 죽은 채널로 '답 보내기'
  const ANSWER = '사라지면 안 되는 답';
  await page.locator('#answer').fill(ANSWER);
  await page.evaluate(() => (window as any).__t.cut(() => (document.querySelector('#app form button.submit') as HTMLButtonElement).click()));
  expect(await page.evaluate(() => (window as any).__t.c2.view.submitted)).toBe(false);
  await expect(page.locator('#answer')).toHaveValue(ANSWER); // 쓴 답이 그대로(정지 없이 다시 낼 수 있음)
  await page.getByRole('button', { name: '답 보내기' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__t.c2.view.submitted)).toBe(true);
  await page.evaluate(async () => {
    for (const c of (window as any).__t.others) c.submitGuess('다른 답');
  });
  await expect.poll(() => page.evaluate(() => (window as any).__t.hr.host.view.step)).toBe(2);
  const kept = await page.evaluate(() => {
    const g = (window as any).__t.hr.host.game;
    return g.chains.flatMap((c: any) => c.entries).some((e: any) => e.text === '사라지면 안 되는 답');
  });
  expect(kept).toBe(true);

  // 나머지 2·3단계 → 결과 보기
  await page.evaluate(async () => {
    const t = (window as any).__t;
    for (const c of [t.c2, ...t.others]) await c.submitDrawing(await t.png());
  });
  await expect.poll(() => page.evaluate(() => (window as any).__t.hr.host.view.step)).toBe(3);
  await page.evaluate(() => {
    const t = (window as any).__t;
    for (const c of [t.c2, ...t.others]) c.submitGuess('끝 답');
  });
  await expect.poll(() => page.evaluate(() => (window as any).__t.hr.host.view.phase)).toBe('review');
});

test('기한 자동 제출을 잃고 유예 안에 다시 붙으면 같은 그림을 다시 보낸다 — 빈 캔버스 자동 제출 없음', async ({ page }) => {
  const s = await setup(page);
  expect(s.before).toBeGreaterThan(1000);
  await page.evaluate(() =>
    (window as any).__t.cut(async () => {
      (window as any).__now += 30_500; // 기한(30초) 지남 · 방장 유예(3초) 안
      await new Promise((r) => setTimeout(r, 700)); // 화면이 0초를 보고 죽은 채널로 자동 제출
      if (!(window as any).__t.c2.view.submitted) throw new Error('자동 제출이 안 됨');
    }),
  );
  // 재합류 sync 가 submitted false 를 주면 화면이 같은 그림으로 다시 자동 제출한다
  await expect.poll(() => page.evaluate((i) => (window as any).__t.hostDark(i, 0), s.chainIdx), { timeout: 5000 }).toBeGreaterThan(1000);
  expect(await page.evaluate(() => (window as any).__t.c2.view.submitted)).toBe(true);
  const entry = await page.evaluate((i) => (window as any).__t.hr.host.game.chains[i].entries[0].status, s.chainIdx);
  expect(entry).toBe('done');
});
