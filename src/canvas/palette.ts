// The one place pen values live. Mirrors tokens.json `pen.*` and `color.canvas.surface`
// (theme-independent, 800×600 model px). Canvas 2D needs real color values, not CSS vars.
export const MODEL_W = 800;
export const MODEL_H = 600;

export const CANVAS_SURFACE = '#FFFFFF';

export const PEN_COLORS = [
  { name: '검정', hex: '#1A1A1A' },
  { name: '빨강', hex: '#E03131' },
  { name: '주황', hex: '#F76707' },
  { name: '노랑', hex: '#FCC419' },
  { name: '초록', hex: '#2F9E44' },
  { name: '파랑', hex: '#1C7ED6' },
  { name: '보라', hex: '#7048E8' },
  { name: '갈색', hex: '#A0522D' },
] as const;

export const PEN_WIDTHS = [
  { name: '가는 마커', px: 4 },
  { name: '보통 마커', px: 10 },
  { name: '굵은 마커', px: 22 },
] as const;

export const DEFAULT_COLOR = 0;
export const DEFAULT_WIDTH = 1;

// Eraser = white pen, fixed width regardless of the width selection.
export const ERASER = { color: CANVAS_SURFACE, px: 36 } as const;
