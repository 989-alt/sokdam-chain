// 그리기·답 쓰기 화면의 "제시" 문구. 순수 함수라 T07 돌려쓰기도 같은 결과를 쓴다.
import type { Category, Input } from '../../engine';

export const FALLBACK_NOTE = '앞사람 것이 없어서 그 앞 내용을 보여줘요';
export const ANSWER_MAX = 40;
/** 이 글자 수를 넘으면 제시 패널 글자를 줄여 두 줄로 접는다(제시 패널 높이 고정 — 캔버스 예산). */
const LONG = 12;

export type PromptView = { label: string; text: string | null; imgId: string | null; hint: string | null; long: boolean };

// 묶음 조사표(PRD §4.1 — 고정 4개). null = 교사 목록만(묶음 모름) → '제시어'.
const TOPIC: Record<Category, string> = { 속담: '속담은', 관용표현: '관용표현은', 사자성어: '사자성어는', 상식용어: '상식용어는' };
// 답 쓰기 안내(사용자 승인 2026-10-22, Q5): 상식용어만 '낱말을'.
const OBJECT: Record<Category, string> = { 속담: '속담을', 관용표현: '관용표현을', 사자성어: '사자성어를', 상식용어: '낱말을' };

/** 답 쓰기 안내. 교사 목록만(묶음 없음)은 GuessScreen 이 옛 사용자 확정 문구를 그대로 쓴다. */
export const askText = (c: Category): string => `이 그림이 나타내는 ${OBJECT[c]} 써 보세요`;

/** 그리기 제시. first = 체인 0단계(A 제시어 원문 / B 뜻). 대체 입력이면 hint 자리에 대체 안내. */
export function drawPrompt(input: Input, first: boolean, category: Category | null): PromptView {
  const text = input.kind === 'image' ? null : (input.text ?? '');
  const label =
    input.kind === 'meaning'
      ? '이 뜻을 그림으로 그려 보세요'
      : input.kind === 'image'
        ? '앞사람 그림을 보고 이어 그려 보세요'
        : first
          ? '이 말을 그림으로 그려 보세요'
          : '앞사람 답을 그림으로 그려 보세요';
  const hint = input.fallbackNote ? FALLBACK_NOTE : first ? null : `원래 ${category ? TOPIC[category] : '제시어는'} 결과 볼 때 나와요`;
  return { label, text, imgId: input.kind === 'image' ? (input.imgId ?? null) : null, hint, long: (text?.length ?? 0) > LONG };
}

/** 답 쓰기 제출 버튼: 빈 답은 한 번 확인한 뒤에만 보낸다. */
export function guessAction(text: string, confirming: boolean): 'submit' | 'confirm' {
  return text.trim() || confirming ? 'submit' : 'confirm';
}
