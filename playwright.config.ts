import { defineConfig, devices } from '@playwright/test';

// e2e must never hit the public 0.peerjs.com: build against the local peer server.
const signalingEnv = {
  VITE_SIGNALING_HOST: '127.0.0.1',
  VITE_SIGNALING_PORT: '9000',
  VITE_SIGNALING_SECURE: 'false',
};

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 1,
  use: { baseURL: 'http://127.0.0.1:5173/' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node scripts/peer-server.mjs',
      url: 'http://127.0.0.1:9000/peerjs/id',
      reuseExistingServer: false,
    },
    {
      command: 'npm run build && npx vite preview --host 127.0.0.1 --port 5173 --strictPort',
      url: 'http://127.0.0.1:5173/',
      env: signalingEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
