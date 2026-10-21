// 화면 단위 e2e: vite 개발 서버를 띄워 페이지에서 /src 모듈을 직접 import 한다(loopback 망·고정 시계로 끊김·긴 제시를 재현).
// 빌드 미리보기(playwright webServer)로는 fallbackNote·잃은 제출 같은 망 상태를 만들 수 없어서다.
import type { Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

export async function devServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const srv: ViteDevServer = await createServer({ configFile: './vite.config.ts', server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await srv.listen();
  const a = srv.httpServer!.address();
  if (!a || typeof a === 'string') throw new Error('개발 서버 주소 없음');
  return { url: `http://127.0.0.1:${a.port}`, close: () => srv.close() };
}

/** 앱을 한 번 띄워 preact 를 앱과 같은 사본으로 window.__h·__render 에 둔다(사본이 다르면 훅이 깨진다). */
export async function bootDev(page: Page, url: string): Promise<void> {
  await page.goto(`${url}/#/`);
  await page.evaluate(async () => {
    const u = performance
      .getEntriesByType('resource')
      .map((x) => x.name)
      .find((n) => n.includes('/preact.js?'))!;
    const { h, render } = await import(/* @vite-ignore */ u);
    Object.assign(window, { __h: h, __render: render });
  });
}
