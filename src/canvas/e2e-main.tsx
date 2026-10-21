// Test-only entry for e2e.html.
import { render } from 'preact';
import { DrawingCanvas } from './DrawingCanvas';
import { exportDrawing } from './export';
import { Drawing } from './model';

const drawing = new Drawing();
Object.assign(window, { __dc: { drawing, exportDrawing } });
render(<DrawingCanvas drawing={drawing} />, document.getElementById('app')!);
