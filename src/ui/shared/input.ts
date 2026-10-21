// 이름·방 코드 입력 규칙(방 만들기·방 들어가기·돌려쓰기 공용).
import { filter } from '../../data/filter';

export const NAME_MAX = 12;
export const CODE_LEN = 6;

/** 입력값을 12글자(코드포인트)까지 자른다. maxLength 는 UTF-16 단위라 이모지 붙여넣기에서 어긋난다. */
export const clampName = (raw: string): string => [...raw].slice(0, NAME_MAX).join('');

/** 보낼 이름. 빈 값·공백만이면 null. */
export const nameToSend = (raw: string): string | null => clampName(raw).trim() || null;

/** 금지어가 있으면 가려진 미리보기, 없으면 null. */
export function maskedPreview(raw: string): string | null {
  const n = clampName(raw).trim();
  const f = filter(n);
  return f !== n ? f : null;
}

/** 숫자만 남기고 6자리까지. */
export const cleanCode = (raw: string): string => raw.replace(/\D/g, '').slice(0, CODE_LEN);
