import { BANNED_WORDS } from './banned-words';

// 금지어를 품은 일반 낱말(정규화 형태). 이 범위에 걸친 매칭은 가리지 않는다(오탐 방지 경계 규칙).
const ALLOWED = ['시발점', '시발역', '시발택시', '등신대', '씨바지'];

const KEEP = /[가-힣ㄱ-ㅎㅏ-ㅣa-z]/;
// 2글자 이하 한글 음절 항목은 공백을 넘어 잡지 않는다("초등 신입생"의 등신 같은 낱말 경계 오탐 방지).
const inOneToken = (b: string) => /^[가-힣]{1,2}$/.test(b);

/** 이름·답의 금지어 부분을 글자 수만큼 ● 로 가린다. 길이 보존. 정규화 뒤 매칭하고 원문 위치로 되돌린다. */
export function filter(text: string): string {
  if (!text.trim()) return text;
  const chars = [...text];
  // pos[k] = 정규화 문자열 k번째 글자의 원문 위치. ASCII 만 소문자로 바꿔 글자 수가 변하지 않게 한다.
  const pos: number[] = [];
  let norm = '';
  chars.forEach((c, i) => {
    const l = c >= 'A' && c <= 'Z' ? c.toLowerCase() : c;
    if (KEEP.test(l)) {
      norm += l;
      pos.push(i);
    }
  });
  const allowed = new Array<boolean>(norm.length).fill(false);
  for (const a of ALLOWED) {
    for (let k = norm.indexOf(a); k !== -1; k = norm.indexOf(a, k + 1)) allowed.fill(true, k, k + a.length);
  }
  const out = [...chars];
  let hit = false;
  for (const b of BANNED_WORDS) {
    for (let k = norm.indexOf(b); k !== -1; k = norm.indexOf(b, k + 1)) {
      const from = pos[k]!;
      const to = pos[k + b.length - 1]!;
      if (allowed.slice(k, k + b.length).some(Boolean)) continue;
      if (inOneToken(b) && /\s/.test(chars.slice(from, to + 1).join(''))) continue;
      for (let j = k; j < k + b.length; j++) out[pos[j]!] = '●';
      hit = true;
    }
  }
  return hit ? out.join('') : text;
}
