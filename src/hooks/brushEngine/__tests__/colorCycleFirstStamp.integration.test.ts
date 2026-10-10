import { ColorCycleBrushCanvas2D } from '@/hooks/brushEngine/ColorCycleBrushCanvas2D';
import {
  ColorCycleLayerDocument,
  createEmptyColorCycleLayerDocumentState,
} from '@/lib/colorCycle/document';
import { useAppStore } from '@/stores/useAppStore';

const makeCanvas = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  return canvas;
};

describe('first Color Cycle stamp presentation', () => {
  it.each(['square', 'round', 'diamond', 'triangle'] as const)(
    'keeps the first %s stamp through direct presentation and commit',
    (shape) => {
      const canvas = makeCanvas();
      const brush = new ColorCycleBrushCanvas2D(canvas, { brushSize: 6, forceCanvas2D: true });
      const layerId = `first-${shape}`;
      const state = createEmptyColorCycleLayerDocumentState({ layerId, width: 32, height: 32 });
      const document = new ColorCycleLayerDocument(state);
      useAppStore.getState().clearSelection();
      useAppStore.getState().setBrushSettings({ colorCyclePencilEnabled: false, colorCycleBristlesEnabled: false });
      brush.setColorCycleLayerDocument(layerId, document);
      brush.setLayerId(layerId);
      brush.setActiveLayer(layerId);
      brush.setStampShape(shape);
      brush.setGradient([{ position: 0, color: '#ff0000' }, { position: 1, color: '#ff0000' }], layerId);
      try {
        const before = document.read();
        brush.startStroke(layerId);
        brush.paint(16, 16, layerId, 1);
        brush.renderDirectToCanvas(canvas, layerId);
        expect(document.read().version).toBe(before.version);
        expect(new Uint8Array(before.snapshot.paintBuffer!).every(value => value === 0)).toBe(true);
        brush.endStroke(layerId);
        const read = document.read();
        expect(new Uint8Array(read.snapshot.paintBuffer ?? new ArrayBuffer(0)).some(value => value > 0)).toBe(true);
        expect(read.snapshot.hasContent).toBe(true);
      } finally {
        brush.cleanup();
      }
    },
  );

  it('starts from the latest committed pixels without mutating their pinned document read', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas, { brushSize: 6, forceCanvas2D: true });
    const layerId = 'first-on-restored-content';
    const state = createEmptyColorCycleLayerDocumentState({ layerId, width: 32, height: 32 });
    new Uint8Array(state.paintBuffer!)[0] = 99;
    state.hasContent = true;
    const document = new ColorCycleLayerDocument(state);
    brush.setColorCycleLayerDocument(layerId, document);
    brush.setLayerId(layerId);
    brush.setActiveLayer(layerId);
    brush.setGradient([{ position: 0, color: '#ff0000' }, { position: 1, color: '#ff0000' }], layerId);
    try {
      const before = document.read();
      brush.startStroke(layerId);
      brush.paint(16, 16, layerId, 1);
      brush.renderDirectToCanvas(canvas, layerId);
      brush.endStroke(layerId);
      const paint = new Uint8Array(document.read().snapshot.paintBuffer!);
      expect(paint[0]).toBe(99);
      expect(paint[16 * 32 + 16]).toBeGreaterThan(0);
      expect(new Uint8Array(before.snapshot.paintBuffer!)[16 * 32 + 16]).toBe(0);
      expect(document.read().version).toBeGreaterThan(before.version);
    } finally {
      brush.cleanup();
    }
  });
});
