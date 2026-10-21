import { useEffect, useRef, useState } from 'preact/hooks';
import type { Drawing } from './model';
import { DEFAULT_COLOR, DEFAULT_WIDTH, ERASER, MODEL_H, MODEL_W, PEN_COLORS, PEN_WIDTHS } from './palette';
import { drawStroke, paint } from './render';

type Props = {
  /** Owned by the caller; export with `exportDrawing(drawing)`. */
  drawing: Drawing;
  /** After submit: input and tools are ignored. */
  disabled?: boolean;
};

// Function and base layout only; T06 applies tokens/icons via these class names.
const toolStyle = { minWidth: '56px', minHeight: '56px' };

export function DrawingCanvas({ drawing, disabled = false }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [colorIdx, setColorIdx] = useState(DEFAULT_COLOR);
  const [widthIdx, setWidthIdx] = useState(DEFAULT_WIDTH);
  const [eraser, setEraser] = useState(false);

  const repaint = () => {
    const c = canvasRef.current;
    if (c && c.width > 0) paint(c.getContext('2d')!, drawing.visible(), c.width / MODEL_W);
  };

  // 4:3 letterbox inside the stage; backing store follows CSS size × DPR, strokes stay in model coords.
  useEffect(() => {
    const stage = stageRef.current!;
    const c = canvasRef.current!;
    const fit = () => {
      const w = Math.min(stage.clientWidth, (stage.clientHeight * MODEL_W) / MODEL_H);
      c.style.width = `${w}px`;
      c.style.height = `${(w * MODEL_H) / MODEL_W}px`;
      c.width = Math.round(w * devicePixelRatio);
      c.height = Math.round((w * MODEL_H * devicePixelRatio) / MODEL_W);
      repaint();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    fit();
    return () => ro.disconnect();
  }, [drawing]);

  useEffect(() => drawing.setDisabled(disabled), [drawing, disabled]);

  const toModel = (e: PointerEvent): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) * MODEL_W) / r.width, ((e.clientY - r.top) * MODEL_H) / r.height];
  };

  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    const c = canvasRef.current!;
    if (c.getBoundingClientRect().width === 0) return; // avoid NaN points
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // set here, not in an effect: effects run after a frame and a fast tap would get the old tool
    if (eraser) drawing.setTool(ERASER.color, ERASER.px);
    else drawing.setTool(PEN_COLORS[colorIdx]!.hex, PEN_WIDTHS[widthIdx]!.px);
    if (!drawing.down(e.pointerId, ...toModel(e), e.isPrimary)) return;
    try {
      c.setPointerCapture(e.pointerId);
    } catch {
      // capture is a nicety (drawing past the edge); never let it strand the stroke
    }
    drawStroke(c.getContext('2d')!, drawing.active!, 0);
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== drawing.activeId) return;
    e.preventDefault();
    const s = drawing.active!;
    const from = s.points.length / 2;
    const l = e.getCoalescedEvents?.();
    for (const ev of l?.length ? l : [e]) drawing.move(e.pointerId, ...toModel(ev));
    drawStroke(canvasRef.current!.getContext('2d')!, s, from);
  };

  const onUp = (e: PointerEvent) => drawing.up(e.pointerId);

  const act = (fn: () => boolean) => () => {
    if (fn()) repaint();
  };

  return (
    <div
      class="dc-root"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '12px', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
    >
      <div
        ref={stageRef}
        class="dc-stage"
        style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <canvas
          ref={canvasRef}
          class="dc-canvas"
          aria-label="그림 그리는 곳"
          style="touch-action: none; display: block"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onLostPointerCapture={onUp}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
      <div class="dc-tools" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
        <div class="dc-row" role="group" aria-label="마커 색" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          {PEN_COLORS.map((c, i) => (
            <button
              type="button"
              class="swatch"
              aria-label={c.name}
              aria-pressed={!eraser && i === colorIdx}
              disabled={disabled}
              style={{ ...toolStyle, background: c.hex }}
              onClick={() => {
                setColorIdx(i);
                setEraser(false);
              }}
            />
          ))}
        </div>
        <div class="dc-row" role="group" aria-label="마커 굵기" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          {PEN_WIDTHS.map((w, i) => (
            <button
              type="button"
              class="tool"
              aria-label={w.name}
              aria-pressed={!eraser && i === widthIdx}
              disabled={disabled}
              style={toolStyle}
              onClick={() => {
                setWidthIdx(i);
                setEraser(false);
              }}
            >
              <i class="dot" aria-hidden="true" style={{ display: 'inline-block', width: `${w.px}px`, height: `${w.px}px`, borderRadius: '50%', background: 'currentColor' }} />
            </button>
          ))}
          <button type="button" class="tool" aria-label="지우개" aria-pressed={eraser} disabled={disabled} style={toolStyle} onClick={() => setEraser(true)}>
            지우개
          </button>
          <button type="button" class="tool wide" aria-label="되돌리기" disabled={disabled} style={toolStyle} onClick={act(() => drawing.undo())}>
            되돌리기
          </button>
          <button type="button" class="tool wide danger" aria-label="전체 지우기" disabled={disabled} style={toolStyle} onClick={act(() => drawing.clear())}>
            전체 지우기
          </button>
        </div>
      </div>
    </div>
  );
}
