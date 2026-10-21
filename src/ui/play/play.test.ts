import { describe, expect, it, vi } from 'vitest';
import { ANSWER_MAX, drawPrompt, FALLBACK_NOTE, guessAction } from './prompt';
import { playSfx, sfxUrl } from './sfx';
import { timerView } from './timer';

describe('drawPrompt', () => {
  it('A 0단계: 속담 원문, 힌트 없음', () => {
    expect(drawPrompt({ kind: 'text', text: '원숭이도 나무에서 떨어진다' }, true)).toMatchObject({ label: '이 말을 그림으로 그려요', text: '원숭이도 나무에서 떨어진다', hint: null, imgId: null, long: true });
  });
  it('B 0단계: 뜻만(원문 필드 없음)', () => {
    const v = drawPrompt({ kind: 'meaning', text: '아무리 잘하는 사람도 실수한다.' }, true);
    expect(v.label).toBe('이 뜻을 그림으로 그려요');
    expect(v.text).toBe('아무리 잘하는 사람도 실수한다.');
  });
  it('앞 답 / 대체 안내 / 앞 그림', () => {
    expect(drawPrompt({ kind: 'text', text: '바나나' }, false)).toMatchObject({ label: '앞 사람 답을 보고 그려요', hint: '원래 속담은 결과 보기에서 나와요', long: false });
    expect(drawPrompt({ kind: 'text', text: '바나나', fallbackNote: true }, false).hint).toBe(FALLBACK_NOTE);
    expect(drawPrompt({ kind: 'image', imgId: 'r1-0-0', fallbackNote: true }, false)).toMatchObject({ label: '앞 그림을 보고 그려요', text: null, imgId: 'r1-0-0', hint: '앞사람 것이 없어서 그 앞 내용을 보여줘요' });
  });
});

describe('guessAction', () => {
  it('빈 답은 한 번 확인 뒤 보낸다', () => {
    expect(guessAction('', false)).toBe('confirm');
    expect(guessAction('   ', false)).toBe('confirm');
    expect(guessAction('', true)).toBe('submit');
    expect(guessAction('발이 넓다', false)).toBe('submit');
    expect(ANSWER_MAX).toBe(40);
  });
});

describe('timerView', () => {
  it('남은 초는 올림, 0 아래로 안 감, 20초 주황·10초 빨강', () => {
    expect(timerView(59_001, 60)).toEqual({ secs: 60, level: 'ok', frac: 1 });
    expect(timerView(20_000, 60).level).toBe('warn');
    expect(timerView(20_001, 60).level).toBe('ok');
    expect(timerView(10_000, 60).level).toBe('danger');
    expect(timerView(-500, 60)).toEqual({ secs: 0, level: 'danger', frac: 0 });
    expect(timerView(null, 90).secs).toBe(90);
    expect(timerView(30_000, 60).frac).toBe(0.5);
  });
});

describe('sfx', () => {
  const files = { '../../../assets/sfx/submit.mp3': '/a/submit.mp3', '../../../assets/sfx/turn.ogg': '/a/turn.ogg' };
  it('이름으로 파일을 찾고 없으면 null', () => {
    expect(sfxUrl('submit', files)).toBe('/a/submit.mp3');
    expect(sfxUrl('turn', files)).toBe('/a/turn.ogg');
    expect(sfxUrl('warn', files)).toBeNull();
    expect(sfxUrl('submit', {})).toBeNull();
  });
  it('켜져 있을 때만 재생, 재생 거부·생성 실패는 삼킨다, 파일 없으면 건너뜀', async () => {
    const play = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    const make = vi.fn(() => ({ play }) as unknown as HTMLAudioElement);
    playSfx('submit', false, files, make);
    expect(make).not.toHaveBeenCalled();
    playSfx('submit', true, files, make);
    expect(make).toHaveBeenCalledWith('/a/submit.mp3');
    await Promise.resolve();
    playSfx('warn', true, files, make);
    expect(make).toHaveBeenCalledTimes(1);
    expect(() =>
      playSfx('turn', true, files, () => {
        throw new Error('no Audio');
      }),
    ).not.toThrow();
  });
});
