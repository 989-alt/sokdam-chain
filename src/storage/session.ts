// localStorage 접근 유일 지점(PRD §7.7). 학생 기기만, 키 하나, 개인정보 없음.
export const KEY = 'sokdam.session';
export const TTL_MS = 3 * 60 * 60 * 1000;

export type SavedSession = { roomCode: string; pid: string; hostPeerId: string; savedAt: number };

// 사파리 개인 모드 등은 접근만으로 throw — 저장 실패는 재접속 불가일 뿐 게임은 계속된다.
const store = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function saveSession(s: Omit<SavedSession, 'savedAt'>, now = Date.now()): void {
  try {
    store()?.setItem(KEY, JSON.stringify({ roomCode: s.roomCode, pid: s.pid, hostPeerId: s.hostPeerId, savedAt: now }));
  } catch {
    /* 저장 불가 — 무시 */
  }
}

/** 3시간 지났거나 깨진 값이면 지우고 null. */
export function loadSession(now = Date.now()): SavedSession | null {
  let s: Partial<SavedSession> | null = null;
  try {
    const raw = store()?.getItem(KEY);
    if (!raw) return null;
    s = JSON.parse(raw);
  } catch {
    /* 깨진 값 */
  }
  const ok =
    !!s &&
    typeof s.roomCode === 'string' &&
    typeof s.pid === 'string' &&
    typeof s.hostPeerId === 'string' &&
    typeof s.savedAt === 'number' &&
    now - s.savedAt >= 0 &&
    now - s.savedAt < TTL_MS;
  if (!ok) {
    clearSession();
    return null;
  }
  return s as SavedSession;
}

export function clearSession(): void {
  try {
    store()?.removeItem(KEY);
  } catch {
    /* 무시 */
  }
}
