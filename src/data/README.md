# src/data

- `words.json` — **임시 목록, 검수 전**(설계문서 §7-4). 42개(수준별 14개). 뜻·예문은 새로 썼다. 수업 전 사용자 검수 필요. 600개 본 목록은 후속 작업.
- `schema.ts` — `Word` 타입, `validateWords(json)` 런타임 검증.
- `banned-words.ts` — 금지어 `string[]`. 완벽 차단 아님, 1차 방어.
- `filter.ts` — `filter(text)` 금지어 부분을 ● 로 가림(길이 보존).
