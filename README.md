# 속담 이어그리기 (sokdam-chain)

Telestrations-style classroom drawing game. Vite + TypeScript + Preact, PeerJS WebRTC, no backend.

## Requirements

- Node.js >= 20 (no `.nvmrc`; `engines.node` in package.json)

## Commands

```bash
npm ci
npm run dev            # http://localhost:5173
npm run build          # VITE_BASE=/<repo>/ npm run build for GitHub Pages
npx vitest run         # unit tests (src/**/*.test.ts)
npx playwright install chromium
npx playwright test    # e2e: starts scripts/peer-server.mjs (9000) + preview (5173)
```

## Pinned versions

- `peerjs` pinned exact at **1.5.5** — latest 1.5.x per `npm view peerjs versions`, checked 2026-10-21.
- `.npmrc` sets `save-exact=true`, so all dependencies are pinned exactly.

## Config

`src/config.ts` is the single place for network settings. Build-time env overrides:

| Var | Default |
| --- | --- |
| `VITE_SIGNALING_HOST` | `0.peerjs.com` |
| `VITE_SIGNALING_PORT` | `443` |
| `VITE_SIGNALING_SECURE` | `true` |
| `VITE_SIGNALING_PATH` | `/` |
| `VITE_BASE` (vite.config) | `/` |

STUN: `stun.l.google.com:19302`, `stun1.l.google.com:19302`. No TURN.
