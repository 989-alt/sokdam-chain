import type { Stroke } from './model';
import { CANVAS_SURFACE } from './palette';

/** Clears to white and replays strokes; `scale` = backing px per model px. */
export function paint(ctx: CanvasRenderingContext2D, strokes: Stroke[], scale: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = CANVAS_SURFACE;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  for (const s of strokes) drawStroke(ctx, s, 0);
}

/** Draws the stroke from point index `from` (minus one, to join) to its end. */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, from: number) {
  const p = s.points;
  if (p.length === 2) {
    // zero-length lines don't render a round cap everywhere; draw the dot explicitly
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(p[0]!, p[1]!, s.width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const i0 = Math.max(0, from - 1) * 2;
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(p[i0]!, p[i0 + 1]!);
  for (let i = i0 + 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
  ctx.stroke();
}
