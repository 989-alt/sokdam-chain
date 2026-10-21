// 방 설정 선택지와 화면 문구(방 만들기·대기실 공용).
import type { Settings } from '../../net/protocol';

export const LEVELS = [
  { v: 'e34', label: '초등 3~4' },
  { v: 'e56', label: '초등 5~6' },
  { v: 'm', label: '중학' },
] as const;
export const DRAW_SECONDS = [30, 60, 90, 120] as const;
export const REVIEW_SECONDS = [3, 5, 8] as const;

export const DEFAULT_SETTINGS: Settings = { level: 'e34', mode: 'A', drawSeconds: 60, review: 'timer', reviewSeconds: 5, sound: true, listSource: 'default' };

/** 대기실 설정 요약 칩. */
export function settingsSummary(s: Settings): string[] {
  return [
    s.listSource === 'teacher-only' ? '선생님 목록만' : (LEVELS.find((l) => l.v === s.level)?.label ?? '모든 수준'),
    ...(s.listSource === 'teacher-add' ? ['선생님 목록 더함'] : []),
    s.mode === 'A' ? '속담으로 시작' : '뜻으로 시작',
    `그리기 ${s.drawSeconds}초`,
    s.review === 'timer' ? `${s.reviewSeconds}초 뒤 자동 넘김` : '방장이 넘김',
    s.sound ? '소리 켬' : '소리 끔',
  ];
}
