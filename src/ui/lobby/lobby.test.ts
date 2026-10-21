import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, settingsSummary } from './labels';
import { startReason } from './LobbyScreen';

const p = (slot: number, connected = true) => ({ slot, name: `n${slot}`, connected });

describe('lobby', () => {
  it('start reason below 4 says 4명부터 and lists disconnected names', () => {
    expect(startReason([p(0), p(1), p(2, false)])).toBe('4명부터 시작할 수 있어요 · 지금 3명 · 연결 끊김: n2');
    expect(startReason([p(0), p(1), p(2), p(3)])).toContain('최대 6명');
  });
  it('summary reflects teacher-only and manual review', () => {
    const s = settingsSummary({ ...DEFAULT_SETTINGS, level: null, listSource: 'teacher-only', review: 'manual', sound: false });
    expect(s).toEqual(['선생님 목록만', '속담으로 시작', '그리기 60초', '방장이 넘김', '소리 끔']);
  });
});
