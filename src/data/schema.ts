// words.json 스키마 (PRD §7.3). 현재 words.json 은 임시 목록, 검수 전(설계문서 §7-4) — 수업 전 사용자 검수 필요.

export const LEVELS = ['e34', 'e56', 'm'] as const;
export const TYPES = ['어휘', '속담', '관용표현', '사자성어'] as const;
export type Level = (typeof LEVELS)[number];
export type WordType = (typeof TYPES)[number];

export interface Word {
  id: string;
  text: string;
  meaning: string;
  example: string;
  level: Level;
  type: WordType;
}

const FIELDS = ['id', 'text', 'meaning', 'example', 'level', 'type'];

/** 낱말 목록 런타임 검증(교사 목록·본 목록 교체 시 재사용). 잘못되면 이유를 담아 throw. */
export function validateWords(json: unknown): Word[] {
  if (!Array.isArray(json)) throw new Error('목록이 배열이 아님');
  const ids = new Set<string>();
  const texts = new Set<string>();
  json.forEach((x: unknown, i) => {
    const at = `#${i}`;
    if (typeof x !== 'object' || x === null || Array.isArray(x)) throw new Error(`${at}: 객체가 아님`);
    const o = x as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length !== FIELDS.length || !FIELDS.every((f) => keys.includes(f))) throw new Error(`${at}: 필드는 ${FIELDS.join('·')} 여섯 개여야 함`);
    // 교사 목록 항목(toWords 가 id 't-<순번>')은 예문을 비워도 된다(PRD §7.6) — 본 목록은 필수
    const optional = (f: string) => f === 'example' && typeof o.id === 'string' && o.id.startsWith('t-');
    for (const f of FIELDS) if (typeof o[f] !== 'string' || (!(o[f] as string).trim() && !optional(f))) throw new Error(`${at}: ${f} 비어 있음`);
    if (!(LEVELS as readonly unknown[]).includes(o.level)) throw new Error(`${at}: level 잘못됨 ${String(o.level)}`);
    if (!(TYPES as readonly unknown[]).includes(o.type)) throw new Error(`${at}: type 잘못됨 ${String(o.type)}`);
    if ((o.meaning as string).length > 60) throw new Error(`${at}: meaning 60자 초과`);
    if ((o.example as string).length > 80) throw new Error(`${at}: example 80자 초과`);
    if (ids.has(o.id as string)) throw new Error(`${at}: id 중복 ${String(o.id)}`);
    if (texts.has(o.text as string)) throw new Error(`${at}: text 중복 ${String(o.text)}`);
    ids.add(o.id as string);
    texts.add(o.text as string);
  });
  return json as Word[];
}
