import { describe, expect, it } from 'vitest';
import { clampName, cleanCode, maskedPreview, nameToSend } from './input';
import { joinFailMessage } from './messages';

describe('name input', () => {
  it('blank or spaces-only is not sendable; trims', () => {
    expect(nameToSend('')).toBeNull();
    expect(nameToSend('   ')).toBeNull();
    expect(nameToSend('  민수 ')).toBe('민수');
  });
  it('clamps to 12 code points', () => {
    expect(clampName('가나다라마바사아자차카타파하')).toBe('가나다라마바사아자차카타');
    expect([...clampName('😀'.repeat(20))].length).toBe(12);
  });
  it('previews masking only when a banned word is present', () => {
    expect(maskedPreview('바보민수')).toBe('●●민수');
    expect(maskedPreview('민수')).toBeNull();
  });
});

describe('room code input', () => {
  it('keeps digits only, 6 max', () => {
    expect(cleanCode('12a 3-4５56789')).toBe('123456');
    expect(cleanCode('04 82')).toBe('0482');
  });
});

describe('join fail messages', () => {
  it('maps net reasons', () => {
    expect(joinFailMessage('full')).toBe('방이 꽉 찼어요');
    expect(joinFailMessage('started')).toBe('이미 시작한 방이에요');
    expect(joinFailMessage('version')).toBe('앱을 새로고침해 주세요');
    expect(joinFailMessage('no-room')).toBe('방을 찾을 수 없어요. 코드를 다시 확인해 주세요');
    expect(joinFailMessage('timeout')).toBe(joinFailMessage('no-room'));
    expect(joinFailMessage('server-error')).toContain('연결할 수 없어요');
  });
});
