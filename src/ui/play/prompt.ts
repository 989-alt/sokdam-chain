// 그리기·답 쓰기 화면의 "제시" 문구. 순수 함수라 T07 돌려쓰기도 같은 결과를 쓴다.
import type { Input } from '../../engine';

export const FALLBACK_NOTE = '앞사람 것이 없어서 그 앞 내용을 보여줘요';
export const ANSWER_MAX = 40;
/** 이 글자 수를 넘으면 제시 패널 글자를 줄여 두 줄로 접는다(제시 패널 높이 고정 — 캔버스 예산). */
const LONG = 12;

export type PromptView = { label: string; text: string | null; imgId: string | null; hint: string | null; long: boolean };

/** 그리기 제시. first = 체인 0단계(A 속담 원문 / B 뜻). 대체 입력이면 hint 자리에 대체 안내. */
export function drawPrompt(input: Input, first: boolean): PromptView {
  const text = input.kind === 'image' ? null : (input.text ?? '');
  const label =
    input.kind === 'meaning' ? '이 뜻을 그림으로 그려요' : input.kind === 'image' ? '앞 그림을 보고 그려요' : first ? '이 말을 그림으로 그려요' : '앞 사람 답을 보고 그려요';
  const hint = input.fallbackNote ? FALLBACK_NOTE : first ? null : '원래 속담은 결과 보기에서 나와요';
  return { label, text, imgId: input.kind === 'image' ? (input.imgId ?? null) : null, hint, long: (text?.length ?? 0) > LONG };
}

/** 답 쓰기 제출 버튼: 빈 답은 한 번 확인한 뒤에만 보낸다. */
export function guessAction(text: string, confirming: boolean): 'submit' | 'confirm' {
  return text.trim() || confirming ? 'submit' : 'confirm';
}
