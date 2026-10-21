import { DEFAULT_COLOR, DEFAULT_WIDTH, PEN_COLORS, PEN_WIDTHS } from './palette';

// points are flat [x0, y0, x1, y1, ...] in 800×600 model coordinates.
export type Stroke = { color: string; width: number; points: number[] };
export type Op = Stroke | 'clear';

export const UNDO_LIMIT = 50;

// Undo replays strokes; no image snapshots are kept.
export class Drawing {
  ops: Op[] = [];
  /** ops below this index can no longer be undone */
  floor = 0;
  active: Stroke | null = null;
  activeId: number | null = null;
  color: string = PEN_COLORS[DEFAULT_COLOR].hex;
  width: number = PEN_WIDTHS[DEFAULT_WIDTH].px;
  disabled = false;

  setTool(color: string, width: number) {
    this.color = color;
    this.width = width;
  }

  /**
   * Only the first pointer draws; later pointers (second finger, palm) are ignored.
   * A new primary pointer means the old one's pointerup was lost: close it instead of staying stuck.
   */
  down(id: number, x: number, y: number, primary = false): boolean {
    if (this.disabled) return false;
    if (primary && this.activeId !== null) this.finish();
    if (this.activeId !== null) return false;
    this.activeId = id;
    this.active = { color: this.color, width: this.width, points: [x, y] };
    return true;
  }

  move(id: number, x: number, y: number): boolean {
    if (this.disabled || id !== this.activeId || !this.active) return false;
    this.active.points.push(x, y);
    return true;
  }

  up(id: number) {
    if (id === this.activeId) this.finish();
  }

  /** Closes the in-progress stroke (pointerup, export at the deadline, lock). */
  finish() {
    if (this.active) this.push(this.active);
    this.active = null;
    this.activeId = null;
  }

  undo(): boolean {
    this.finish();
    if (this.ops.length <= this.floor) return false;
    this.ops.pop();
    return true;
  }

  clear(): boolean {
    this.finish();
    if (this.visible().length === 0) return false;
    this.push('clear');
    return true;
  }

  setDisabled(v: boolean) {
    if (v) this.finish();
    this.disabled = v;
  }

  /** Strokes after the last clear, plus the in-progress one. */
  visible(): Stroke[] {
    const out: Stroke[] = [];
    for (const op of this.ops) {
      if (op === 'clear') out.length = 0;
      else out.push(op);
    }
    if (this.active) out.push(this.active);
    return out;
  }

  private push(op: Op) {
    this.ops.push(op);
    if (this.ops.length - this.floor > UNDO_LIMIT) this.floor++;
    // Strokes hidden behind a clear that can no longer be undone are dead weight.
    const c = this.floor > 0 ? this.ops.lastIndexOf('clear', this.floor - 1) : -1;
    if (c >= 0) {
      this.ops.splice(0, c + 1);
      this.floor -= c + 1;
    }
  }
}
