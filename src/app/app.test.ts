import { describe, expect, it } from 'vitest';
import { encodeList } from '../teacher/list';
import { parseRoute } from './router';
import { readTeacherHash } from './teacher-state';

describe('router', () => {
  it('parses named routes; anything else is home', () => {
    expect(parseRoute('#/create')).toBe('create');
    expect(parseRoute('#/room')).toBe('room');
    expect(parseRoute('')).toBe('home');
    expect(parseRoute('#/nope')).toBe('home');
    expect(parseRoute('#l=abc')).toBe('home');
  });
});

describe('teacher hash', () => {
  it('ignores non-list hashes, reads valid list, reports broken one', () => {
    expect(readTeacherHash('#/create')).toBeNull();
    const enc = encodeList('only', [{ t: '가는 말이 고와야 오는 말이 곱다', m: '내가 잘해야 남도 잘한다', e: '' }]);
    if (!enc.ok) throw new Error('encode');
    expect(readTeacherHash(enc.hash)).toEqual({ list: { mode: 'only', items: [{ t: '가는 말이 고와야 오는 말이 곱다', m: '내가 잘해야 남도 잘한다', e: '' }] } });
    expect(readTeacherHash('#l=%%%')).toHaveProperty('error');
  });
});
