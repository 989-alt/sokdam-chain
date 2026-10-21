import { type Page, expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { type ViteDevServer, createServer } from 'vite';

// The canvas isn't mounted by App yet, so this spec serves the test-only page
// src/canvas/e2e.html from its own Vite dev server.
test.describe.configure({ mode: 'serial' });

let server: ViteDevServer;
let url: string;

test.beforeAll(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 5199 },
  });
  await server.listen();
  url = new URL('src/canvas/e2e.html', server.resolvedUrls!.local[0]).href;
});

test.afterAll(async () => {
  await server?.close();
});

test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

async function open(page: Page) {
  await page.goto(url);
  await expect(page.locator('canvas')).toBeVisible();
  await expect.poll(() => page.locator('canvas').evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(0);
}

const strokes = (page: Page) => page.evaluate(() => (window as any).__dc.drawing.visible().length as number);

async function exportInfo(page: Page) {
  return page.evaluate(async () => {
    const dc = (window as any).__dc;
    const t0 = performance.now();
    const blob: Blob = await dc.exportDrawing(dc.drawing);
    const ms = performance.now() - t0;
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const px = Array.from(ctx.getImageData(5, 5, 1, 1).data);
    return { type: blob.type, size: blob.size, ms, w: bmp.width, h: bmp.height, px };
  });
}

async function boxRatio(page: Page) {
  const b = (await page.locator('canvas').boundingBox())!;
  const vp = page.viewportSize()!;
  return { ratio: b.width / b.height, inside: b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width + 0.5 && b.y + b.height <= vp.height + 0.5 };
}

test('blank export is a valid white WebP 800×600 within 500ms', async ({ page }) => {
  await open(page);
  const e = await exportInfo(page);
  expect(e.type).toBe('image/webp');
  expect(e.size).toBeGreaterThan(0);
  expect([e.w, e.h]).toEqual([800, 600]);
  expect(e.px.slice(0, 3).every((v) => v >= 250)).toBe(true);
  expect(e.px[3]).toBe(255);
  expect(e.ms).toBeLessThan(500);
});

test('mouse and touch both draw; touch drag does not scroll the page', async ({ page }) => {
  await open(page);
  const b = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(b.x + 50, b.y + 50);
  await page.mouse.down();
  await page.mouse.move(b.x + 150, b.y + 120, { steps: 5 });
  await page.mouse.up();
  expect(await strokes(page)).toBe(1);

  await page.touchscreen.tap(b.x + 200, b.y + 200);
  expect(await strokes(page)).toBe(2);

  // touch drag via CDP (page.touchscreen has no move)
  const cdp = await page.context().newCDPSession(page);
  const pt = (x: number, y: number) => [{ x: b.x + x, y: b.y + y }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(300, 300) });
  for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(300, 300 - i * 40) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await strokes(page)).toBe(3);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  const e = await exportInfo(page);
  expect(e.size).toBeGreaterThan(0);
  expect(e.ms).toBeLessThan(500);
});

test('4:3 letterbox in both orientations; rotation keeps strokes', async ({ page }) => {
  await open(page);
  let r = await boxRatio(page);
  expect(Math.abs(r.ratio - 4 / 3)).toBeLessThan(0.01);
  expect(r.inside).toBe(true);

  const b = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 200, b.y + 200, { steps: 4 });
  await page.mouse.up();
  expect(await strokes(page)).toBe(1);

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect.poll(async () => (await boxRatio(page)).inside).toBe(true);
  r = await boxRatio(page);
  expect((await page.locator('canvas').boundingBox())!.width).toBeLessThan(b.width);
  expect(Math.abs(r.ratio - 4 / 3)).toBeLessThan(0.01);
  expect(r.inside).toBe(true);
  expect(await strokes(page)).toBe(1);
  // repainted after resize: stroke pixels present on the visible canvas, not just in the model
  const inked = await page.locator('canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 100) return true;
    return false;
  });
  expect(inked).toBe(true);
  const e = await exportInfo(page);
  expect([e.w, e.h]).toEqual([800, 600]);
});

test('falls back to PNG when toBlob cannot make WebP', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb, _type, q) {
      orig.call(this, cb, 'image/png', q);
    };
  });
  await open(page);
  const e = await exportInfo(page);
  expect(e.type).toBe('image/png');
  expect(e.size).toBeGreaterThan(0);
});

test('tool buttons have aria-labels and are at least 48px', async ({ page }) => {
  await open(page);
  const buttons = page.locator('.dc-tools button');
  expect(await buttons.count()).toBe(14);
  for (const btn of await buttons.all()) {
    expect(await btn.getAttribute('aria-label')).toBeTruthy();
    const bb = (await btn.boundingBox())!;
    expect(bb.width).toBeGreaterThanOrEqual(48);
    expect(bb.height).toBeGreaterThanOrEqual(48);
  }
  // undo/clear go through the UI too
  const b = (await page.locator('canvas').boundingBox())!;
  await page.mouse.click(b.x + 30, b.y + 30);
  expect(await strokes(page)).toBe(1);
  await page.getByRole('button', { name: '전체 지우기' }).click();
  expect(await strokes(page)).toBe(0);
  await page.getByRole('button', { name: '되돌리기' }).click();
  expect(await strokes(page)).toBe(1);
});
