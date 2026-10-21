// 그리기 남은 시간 표시. ms 는 세션(방장 시계 보정)이나 돌려쓰기 로컬 시계가 준다.
export type TimerView = { secs: number; level: 'ok' | 'warn' | 'danger'; frac: number };

export function timerView(ms: number | null, total: number): TimerView {
  const secs = ms == null ? total : Math.max(0, Math.ceil(ms / 1000));
  return { secs, level: secs <= 10 ? 'danger' : secs <= 20 ? 'warn' : 'ok', frac: total > 0 ? Math.min(1, secs / total) : 0 };
}
