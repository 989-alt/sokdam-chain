import { BANNED_WORDS } from './banned-words';

// 금지어를 품은 일반 낱말(정규화 형태). 이 범위에 걸친 매칭은 가리지 않는다(오탐 방지 경계 규칙).
const ALLOWED = ['시발점', '시발역', '시발택시', '등신대'];

const KEEP = /[가-힣ㄱ-ㅎㅏ-ㅣa-z]/;

/** 이름·답의 금지어 부분을 글자 수만큼 ● 로 가린다. 길이 보존. 정규화 뒤 매칭하고 원문 위치로 되돌린다. */
export function filter(text: string): string {
  if (!text.trim()) return text;
  const chars = [...text.toLowerCase()];
  // pos[k] = 정규화 문자열 k번째 글자의 원문 위치
  const pos: number[] = [];
  let norm = '';
  chars.forEach((c, i) => {
    if (KEEP.test(c)) {
      norm += c;
      pos.push(i);
    }
  });
  const allowed = new Array<boolean>(norm.length).fill(false);
  for (const a of ALLOWED) {
    for (let k = norm.indexOf(a); k !== -1; k = norm.indexOf(a, k + 1)) allowed.fill(true, k, k + a.length);
  }
  const out = [...text];
  let hit = false;
  for (const b of BANNED_WORDS) {
    for (let k = norm.indexOf(b); k !== -1; k = norm.indexOf(b, k + 1)) {
      if (allowed.slice(k, k + b.length).some(Boolean)) continue;
      for (let j = k; j < k + b.length; j++) out[pos[j]!] = '●';
      hit = true;
    }
  }
  return hit ? out.join('') : text;
}
