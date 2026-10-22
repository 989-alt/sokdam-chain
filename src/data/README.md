# src/data

- `words/<묶음>.json` — 본 목록. 묶음마다 파일 하나, 각 100개(PRD §7.3).

  | 묶음 | 파일 | `type` | `id` | e34 | e56 | m |
  | --- | --- | --- | --- | --- | --- | --- |
  | 속담 | `proverb.json` | `속담` | `pv-001`~ | 35 | 35 | 30 |
  | 관용표현 | `idiom.json` | `관용표현` | `id-001`~ | 35 | 35 | 30 |
  | 사자성어 | `four-char.json` | `사자성어` | `fc-001`~ | 25 | 35 | 40 |
  | 상식용어 | `common-term.json` | `상식용어` | `ct-001`~ | 30 | 35 | 35 |

  400개 전체에서 `id`·`text` 유일, `meaning` ≤60자(원문이 들어가면 안 됨), `example` ≤80자. 수업 전 사용자 검수(H4).
- `words.ts` — 4 파일을 이어 붙여 `validateWords` 를 거친 `POOL`(앱이 쓰는 유일한 목록)과 파일별 `FILES`.
- `schema.ts` — `Word` 타입, `validateWords(json)` 런타임 검증. 교사 목록 항목(`t-` id)만 type `선생님 목록`·빈 예문 허용.
- `banned-words.ts` — 금지어 `string[]`. 완벽 차단 아님, 1차 방어.
- `filter.ts` — `filter(text)` 금지어 부분을 ● 로 가림(길이 보존).

## 낱말 고치기

JSON 만 고친다(코드 변경 없음). 묶음 파일은 그 묶음 제작 task(T15-words-<묶음>)를 재개해서 고친다 — 다른 task 가 직접 고치지 않는다.
고친 뒤 `npx vitest run src/data` 로 개수·분포·유일·길이를 확인한다(`data.test.ts`). 파일을 더하거나 묶음을 바꾸면 `words.ts`·`schema.ts` 의 `TYPES`·`data.test.ts` 의 SPEC 을 같이 고친다.
