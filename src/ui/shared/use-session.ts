import { useEffect, useState } from 'preact/hooks';

/** HostSession·ClientSession 의 subscribe 를 상태로. 세션이 없으면 null. */
export function useSubscribe<V>(s: { subscribe(cb: (v: V) => void): () => void } | null | undefined): V | null {
  const [v, setV] = useState<V | null>(null);
  useEffect(() => {
    if (!s) return setV(null);
    return s.subscribe((x) => setV(x));
  }, [s]);
  return v;
}
