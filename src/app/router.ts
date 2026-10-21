// 해시 라우터. 게임 중(lock)엔 브라우저 뒤로가기로 화면이 바뀌지 않는다 — 나가기 버튼만.
import { useEffect, useRef, useState } from 'preact/hooks';

export type Route = 'home' | 'create' | 'join' | 'room' | 'teacher' | 'pass';
const NAMED = ['create', 'join', 'room', 'teacher', 'pass'];

/** '#/create' → 'create'. 그 밖('', '#/', 교사 링크 '#l=…' 등)은 홈. */
export function parseRoute(hash: string): Route {
  const name = hash.startsWith('#/') ? hash.slice(2) : '';
  return NAMED.includes(name) ? (name as Route) : 'home';
}

export const hrefOf = (r: Route): string => (r === 'home' ? '#/' : `#/${r}`);

export function go(r: Route): void {
  location.hash = hrefOf(r);
}

/** 현재 경로. lock 이 있으면 다른 해시로 바뀌어도(뒤로가기) 그 경로를 다시 쌓고 화면을 유지한다. onHash 는 모든 해시 변경에 불린다(교사 링크 감지). */
export function useRoute(lock: Route | null, onHash?: (hash: string) => void): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  const lockRef = useRef(lock);
  lockRef.current = lock;
  const hashRef = useRef(onHash);
  hashRef.current = onHash;
  useEffect(() => {
    const on = () => {
      const l = lockRef.current;
      if (l && parseRoute(location.hash) !== l) {
        history.pushState(null, '', hrefOf(l));
        return;
      }
      hashRef.current?.(location.hash);
      setRoute(parseRoute(location.hash));
    };
    // 해시 없는 항목('/')으로 되돌아갈 때는 hashchange 가 안 올 수 있어 popstate 도 듣는다(둘 다 와도 무해).
    addEventListener('hashchange', on);
    addEventListener('popstate', on);
    on(); // 첫 렌더와 리스너 등록 사이에 바뀐 해시를 놓치지 않게
    return () => {
      removeEventListener('hashchange', on);
      removeEventListener('popstate', on);
    };
  }, []);
  return route;
}
