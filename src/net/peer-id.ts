// 방 코드·peer ID·참가자 ID. 시그널링 서버가 보는 값이라 개인정보를 넣지 않는다(PRD §7.8).
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** 숫자 6자리, 선행 0 허용. */
export const randomRoomCode = (): string => String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, '0');

export const hostPeerId = (code: string): string => `sokdam-${code}`;

export const isRoomCode = (code: string): boolean => /^\d{6}$/.test(code);

/** 무작위 ID(학생 peer ID·참가자 pid·이미지 ID). 기본 20자. */
export function randomId(len = 20): string {
  const b = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join('');
}
