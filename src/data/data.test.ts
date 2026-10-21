import { describe, expect, it } from 'vitest';
import words from './words.json';
import { validateWords } from './schema';
import { filter } from './filter';
import { BANNED_WORDS } from './banned-words';

describe('validateWords', () => {
  it('words.json 통과', () => {
    expect(validateWords(words)).toHaveLength(words.length);
  });
  const ok = { id: 'x1', text: '발이 넓다', meaning: '뜻', example: '예문', level: 'e34', type: '관용표현' };
  it('잘못된 level 거부', () => {
    expect(() => validateWords([{ ...ok, level: 'h' }])).toThrow(/level/);
  });
  it('잘못된 type·빈 필드·추가 필드·중복·길이 거부', () => {
    expect(() => validateWords([{ ...ok, type: '격언' }])).toThrow(/type/);
    expect(() => validateWords([{ ...ok, meaning: ' ' }])).toThrow(/meaning/);
    expect(() => validateWords([{ ...ok, source: '교과서' }])).toThrow(/여섯/);
    expect(() => validateWords([ok, { ...ok, text: '다른' }])).toThrow(/id 중복/);
    expect(() => validateWords([ok, { ...ok, id: 'x2' }])).toThrow(/text 중복/);
    expect(() => validateWords([{ ...ok, example: '가'.repeat(81) }])).toThrow(/80/);
    expect(() => validateWords({})).toThrow();
    expect(() => validateWords([{ ...ok, example: '' }])).toThrow(/example/); // 본 목록은 예문 필수
    expect(validateWords([{ ...ok, id: 't-1', example: '' }])).toHaveLength(1); // 교사 항목은 비워도 됨
    expect(() => validateWords([{ ...ok, id: 't-1', example: '가'.repeat(81) }])).toThrow(/80/);
  });
});

describe('filter', () => {
  it('매칭 부분만 ● 로, 길이 보존', () => {
    expect(filter('바보야')).toBe('●●야');
    expect(filter('바보야').length).toBe(3);
  });
  it('정규화 — 공백·특수문자·숫자 끼워도 잡고 원문 위치에 가림', () => {
    expect(filter('씨 발 놈')).toBe('씨 발 놈'); // 2글자 항목은 공백을 넘어 잡지 않음(트레이드오프)
    expect(filter('바보야!')).toBe('●●야!');
    expect(filter('씨1발!')).toBe('●1●!');
    expect(filter('병.신 같은')).toBe('●.● 같은');
    expect(filter('FUCK you')).toBe('●●●● you');
  });
  it('초성 축약형', () => {
    expect(filter('ㅅㅂ')).toBe('●●');
    expect(filter('ㅈ ㄴ 웃겨')).toBe('● ● 웃겨');
  });
  it('오탐 방지 — 일반 낱말은 그대로', () => {
    for (const s of ['시발점', '시발역에서 출발', '등신대 사진', '허리띠를 졸라매다', '영향을 미친다', '새끼 고양이', '불이 꺼져 있다', '보지 마', '발이 넓다', '바다 보러 가자',
      '아니 미안해', '초등 신입생', '질병 신고', '개시 발표', '출시 발표', '야, 동물원 가자', '위기가 닥쳐왔다',
      '가게 바 보다', '고추씨 발라', '아저씨바지', '뒤로 돌아 이쪽으로']) {
      expect(filter(s)).toBe(s);
    }
  });
  it('허용 낱말 밖 같은 금지어는 여전히 가림', () => {
    expect(filter('시발점 시발')).toBe('시발점 ●●');
  });
  it('3글자 이상·초성·영문 항목은 공백 넘어도 잡음', () => {
    expect(filter('개 새끼')).toBe('● ●●');
    expect(filter('ㅅ ㅂ')).toBe('● ●');
    expect(filter('f u c k')).toBe('● ● ● ●');
  });
  it('소문자화가 글자 수를 바꾸는 문자에도 위치 어긋나지 않음', () => {
    expect(filter('İ바보')).toBe('İ●●');
    expect(filter('İ FUCK')).toBe('İ ●●●●');
  });
  it('빈 입력·공백은 그대로', () => {
    expect(filter('')).toBe('');
    expect(filter('   ')).toBe('   ');
  });
  it('이름 전체가 가려져도 ●●● 그대로 반환(입장 막지 않음)', () => {
    expect(filter('멍청이')).toBe('●●●');
  });
  it('words.json 낱말은 필터에 걸리지 않음', () => {
    for (const w of words) for (const s of [w.text, w.meaning, w.example]) expect(filter(s)).toBe(s);
  });
  it('목록은 정규화 형태', () => {
    for (const b of BANNED_WORDS) expect(b).toMatch(/^[가-힣ㄱ-ㅎㅏ-ㅣa-z]+$/);
  });
  it('성능 — 1000회 < 1초', () => {
    const s = '오늘 우리 모둠은 가는 말이 고와야 오는 말이 곱다를 그렸다 바보';
    const t = performance.now();
    for (let i = 0; i < 1000; i++) filter(s);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});
