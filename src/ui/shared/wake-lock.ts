// 화면 꺼짐 방지(PRD §8). 지원 기기만, 실패는 조용히 무시. 탭이 다시 보이면 다시 요청한다(브라우저가 숨김 때 자동 해제하므로).
import { useEffect } from 'preact/hooks';

type Sentinel = { release(): Promise<void> };
type Nav = { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };
type Doc = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

/** 요청을 걸고 해제 함수를 돌려준다. nav·doc 은 테스트에서 모킹. */
export function keepAwake(nav: Nav = navigator as Nav, doc: Doc = document): () => void {
  let lock: Sentinel | null = null;
  let stopped = false;
  const request = async () => {
    if (stopped || !nav.wakeLock || doc.visibilityState !== 'visible') return;
    try {
      const l = await nav.wakeLock.request('screen');
      if (stopped) void l.release().catch(() => {});
      else lock = l;
    } catch {
      /* 미지원·거부·배터리 절약 — 진행에는 지장 없음 */
    }
  };
  const onVisible = () => void request();
  doc.addEventListener('visibilitychange', onVisible);
  void request();
  return () => {
    stopped = true;
    doc.removeEventListener('visibilitychange', onVisible);
    void lock?.release().catch(() => {});
    lock = null;
  };
}

/** active 인 동안 화면 꺼짐 방지. 대기실·플레이(T05)와 돌려쓰기(T07)가 쓴다. */
export function useWakeLock(active: boolean): void {
  useEffect(() => (active ? keepAwake() : undefined), [active]);
}
