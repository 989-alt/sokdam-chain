// 방 설정 선택지와 화면 문구(방 만들기·대기실 공용).
import type { Category } from '../../engine';
import { categoryOf, type Settings } from '../../net/protocol';
import { HAS_SFX } from '../shared/sound';

export const CATEGORIES: readonly Category[] = ['속담', '관용표현', '사자성어', '상식용어'];
export const LEVELS = [
  { v: 'e34', label: '초등 3~4' },
  { v: 'e56', label: '초등 5~6' },
  { v: 'm', label: '중등' },
] as const;
export const DRAW_SECONDS = [30, 60, 90, 120] as const;
export const REVIEW_SECONDS = [3, 5, 8] as const;

export const DEFAULT_SETTINGS: Settings = { category: '속담', level: 'e34', mode: 'A', drawSeconds: 60, review: 'timer', reviewSeconds: 5, sound: true, listSource: 'default' };

/** 대기실 설정 요약 칩. category 가 없는 settings(옛 방장)는 '속담'. */
export function settingsSummary(s: Settings, hasSfx = HAS_SFX): string[] {
  const category = categoryOf(s);
  return [
    ...(s.listSource === 'teacher-only' ? ['선생님 목록만'] : [category ?? '', LEVELS.find((l) => l.v === s.level)?.label ?? '모든 수준'].filter(Boolean)),
    ...(s.listSource === 'teacher-add' ? ['선생님 목록 포함'] : []),
    s.mode === 'A' ? '글자로 시작' : '뜻으로 시작',
    `그리기 ${s.drawSeconds}초`,
    s.review === 'timer' ? `${s.reviewSeconds}초마다 자동 넘김` : '방장이 넘김',
    ...(hasSfx ? [s.sound ? '소리 켬' : '소리 끔'] : []), // 효과음 파일이 없으면 소리 설정은 아무것도 안 한다
  ];
}
