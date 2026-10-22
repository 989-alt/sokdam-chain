// 본 목록 합치기 로더 (PRD §7.3). 묶음마다 파일 하나(제작 T15 ×4) → 이어 붙여 검증한 POOL 하나.
import commonTerm from './words/common-term.json';
import fourChar from './words/four-char.json';
import idiom from './words/idiom.json';
import proverb from './words/proverb.json';
import { validateWords } from './schema';

export const FILES = { proverb, idiom, 'four-char': fourChar, 'common-term': commonTerm } as const;
/** 400개 전체에서 id·text 유일 — validateWords 가 합친 목록에서 한 번에 본다. */
export const POOL = validateWords([...proverb, ...idiom, ...fourChar, ...commonTerm]);
