import { describe, expect, it } from 'vitest';
import { Drawing, UNDO_LIMIT } from './model';

function line(d: Drawing, id = 1) {
  d.down(id, 10, 10);
  d.move(id, 20, 20);
  d.up(id);
}

describe('Drawing', () => {
  it('draws only with the first pointer (second finger / palm ignored)', () => {
    const d = new Drawing();
    expect(d.down(1, 0, 0)).toBe(true);
    expect(d.down(2, 50, 50)).toBe(false);
    d.move(2, 60, 60);
    d.move(1, 5, 5);
    d.up(2);
    expect(d.active).not.toBeNull();
    d.up(1);
    expect(d.visible()).toHaveLength(1);
    expect(d.visible()[0]!.points).toEqual([0, 0, 5, 5]);
  });

  it('a new primary pointer closes a stroke whose pointerup was lost', () => {
    const d = new Drawing();
    d.down(1, 0, 0, true);
    expect(d.down(2, 9, 9, false)).toBe(false); // second finger still ignored
    expect(d.down(3, 5, 5, true)).toBe(true);
    d.up(3);
    expect(d.visible()).toHaveLength(2);
    expect(d.activeId).toBeNull();
  });

  it('undo is per stroke and clear-all is undoable', () => {
    const d = new Drawing();
    line(d);
    line(d);
    expect(d.clear()).toBe(true);
    expect(d.visible()).toHaveLength(0);
    expect(d.undo()).toBe(true);
    expect(d.visible()).toHaveLength(2);
    expect(d.undo()).toBe(true);
    expect(d.visible()).toHaveLength(1);
  });

  it('clear on an empty canvas adds no undo step', () => {
    const d = new Drawing();
    expect(d.clear()).toBe(false);
    expect(d.ops).toHaveLength(0);
  });

  it(`caps undo at ${UNDO_LIMIT} and keeps only stroke data`, () => {
    const d = new Drawing();
    for (let i = 0; i < 60; i++) line(d);
    let n = 0;
    while (d.undo()) n++;
    expect(n).toBe(UNDO_LIMIT);
    expect(d.visible()).toHaveLength(10);
    // model = plain stroke points, no image snapshots
    expect(JSON.stringify(d.ops).length).toBeLessThan(2000);
  });

  it('drops strokes behind a clear that fell out of undo range', () => {
    const d = new Drawing();
    for (let i = 0; i < 5; i++) line(d);
    d.clear();
    for (let i = 0; i < UNDO_LIMIT; i++) line(d);
    expect(d.ops).toHaveLength(UNDO_LIMIT);
    expect(d.ops).not.toContain('clear');
    expect(d.visible()).toHaveLength(UNDO_LIMIT);
  });

  it('finish() closes a stroke still in progress (deadline export)', () => {
    const d = new Drawing();
    d.down(1, 1, 1);
    d.move(1, 2, 2);
    d.finish();
    expect(d.active).toBeNull();
    expect(d.visible()).toHaveLength(1);
    expect(d.move(1, 3, 3)).toBe(false);
  });

  it('ignores input while disabled and closes the open stroke on lock', () => {
    const d = new Drawing();
    d.down(1, 1, 1);
    d.setDisabled(true);
    expect(d.visible()).toHaveLength(1);
    expect(d.down(1, 5, 5)).toBe(false);
    expect(d.move(1, 6, 6)).toBe(false);
    expect(d.visible()).toHaveLength(1);
  });

  it('records the current tool on each stroke', () => {
    const d = new Drawing();
    d.setTool('#FFFFFF', 36);
    line(d);
    expect(d.visible()[0]).toMatchObject({ color: '#FFFFFF', width: 36 });
  });
});
