import { describe, expect, it, vi } from 'vitest';
import { ANSWER_MAX, askText, drawPrompt, FALLBACK_NOTE, guessAction } from './prompt';
import { playSfx, sfxUrl } from './sfx';
import { timerView } from './timer';

describe('drawPrompt', () => {
  it('A 0단계: 제시어 원문, 힌트 없음', () => {
    expect(drawPrompt({ kind: 'text', text: '원숭이도 나무에서 떨어진다' }, true, '속담')).toMatchObject({ label: '이 말을 그림으로 그려 보세요', text: '원숭이도 나무에서 떨어진다', hint: null, imgId: null, long: true });
  });
  it('B 0단계: 뜻만(원문 필드 없음)', () => {
    const v = drawPrompt({ kind: 'meaning', text: '아무리 잘하는 사람도 실수한다.' }, true, '속담');
    expect(v.label).toBe('이 뜻을 그림으로 그려 보세요');
    expect(v.text).toBe('아무리 잘하는 사람도 실수한다.');
  });
  it('앞 답 / 대체 안내 / 앞 그림', () => {
    expect(drawPrompt({ kind: 'text', text: '바나나' }, false, '관용표현')).toMatchObject({ label: '앞사람 답을 그림으로 그려 보세요', hint: '원래 관용표현은 결과 볼 때 나와요', long: false });
    expect(drawPrompt({ kind: 'text', text: '바나나', fallbackNote: true }, false, '속담').hint).toBe(FALLBACK_NOTE);
    expect(drawPrompt({ kind: 'image', imgId: 'r1-0-0', fallbackNote: true }, false, '속담')).toMatchObject({ label: '앞사람 그림을 보고 이어 그려 보세요', text: null, imgId: 'r1-0-0', hint: '앞사람 것이 없어서 그 앞 내용을 보여줘요' });
  });
});

describe('묶음 문구', () => {
  it('힌트 조사표 4개 + 교사 목록만은 제시어', () => {
    const hint = (c: Parameters<typeof askText>[0]) => drawPrompt({ kind: 'text', text: '가' }, false, c).hint;
    const topics = ['속담은', '관용표현은', '사자성어는', '상식용어는', '제시어는'];
    expect(['속담', '관용표현', '사자성어', '상식용어', null].map((c) => hint(c as Parameters<typeof askText>[0]))).toEqual(topics.map((t) => `원래 ${t} 결과 볼 때 나와요`));
  });
  it('답 쓰기 안내 — 을/를, 상식용어는 낱말', () => {
    expect(askText('속담')).toBe('이 그림이 나타내는 속담을 써 보세요');
    expect(askText('관용표현')).toBe('이 그림이 나타내는 관용표현을 써 보세요');
    expect(askText('사자성어')).toBe('이 그림이 나타내는 사자성어를 써 보세요');
    expect(askText('상식용어')).toBe('이 그림이 나타내는 낱말을 써 보세요');
    expect(askText(null)).toBe('이 그림이 나타내는 말을 써 보세요');
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
