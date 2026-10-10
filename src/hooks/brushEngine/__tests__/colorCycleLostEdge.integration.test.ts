import { ColorCycleBrushCanvas2D } from '@/hooks/brushEngine/ColorCycleBrushCanvas2D';
import { ColorCycleLayerDocument, createEmptyColorCycleLayerDocumentState } from '@/lib/colorCycle/document';
import type { Layer } from '@/types';
import { useAppStore } from '@/stores/useAppStore';

const channels = ['paintBuffer', 'gradientIdBuffer', 'gradientDefIdBuffer', 'speedBuffer', 'flowBuffer', 'phaseBuffer'] as const;
const draw = (lostEdge: number, mode = 'plain', overlap = false, erased = false) => {
  const originalLayers = useAppStore.getState().layers;
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 96;
  const brush = new ColorCycleBrushCanvas2D(canvas, { brushSize: 30, forceCanvas2D: true });
  const layerId = 'lost-edge';
  if (erased) useAppStore.setState({ layers: [{ id: layerId, layerType: 'color-cycle',
    colorCycleData: { eraseMask: canvas } } as Layer] });
  const initial = createEmptyColorCycleLayerDocumentState({ layerId, width: 128, height: 96 });
  if (overlap) {
    for (const [i, key] of channels.entries()) {
      const values = key === 'gradientDefIdBuffer' ? new Uint16Array(initial[key]!) : new Uint8Array(initial[key]!);
      values.fill([99, 3, 7, 91, 2, 137][i]);
    }
    initial.hasContent = true;
  }
  const layerDocument = new ColorCycleLayerDocument(initial);
  const before = channels.map(key => Array.from(key === 'gradientDefIdBuffer' ? new Uint16Array(initial[key]!) : new Uint8Array(initial[key]!)));
  useAppStore.getState().clearSelection();
  useAppStore.getState().setBrushSettings({ size: 30, lostEdge,
    colorCyclePencilEnabled: mode === 'pencil' || mode === 'empty-pencil', colorCyclePencilSensitivity: mode === 'empty-pencil' ? 0 : 50,
    colorCycleBristlesEnabled: mode === 'bristles', colorCycleBristleStrength: 100,
    colorCycleBristleWidth: 2, ditherPatternDiversity: 0 });
  if (mode === 'clip') useAppStore.getState().setSelectionBounds({ x: 40, y: 0 }, { x: 100, y: 96 });
  brush.setColorCycleLayerDocument(layerId, layerDocument);
  brush.setLayerId(layerId); brush.setActiveLayer(layerId);
  brush.setStampShape('square');
  brush.setStampDitherEnabled(mode.startsWith('dither'));
  brush.setStampDitherBgFill(mode !== 'dither-gaps');
  brush.setStampDitherAlgorithm('bayer');
  brush.setGradient([{ position: 0, color: '#ff0000' }, { position: 1, color: '#00ff00' }], layerId);
  try {
    brush.startStroke(layerId);
    for (let x = 24; x <= 104; x += 4) brush.paint(x, 48, layerId, mode === 'empty-pencil' ? 0.1 : 1, mode === 'rotated' ? Math.PI / 4 : 0);
    brush.endStroke(layerId);
    const snapshot = layerDocument.read().snapshot;
    return { before, mask: brush.getFinalizedStrokePaintMask(layerId), after: channels.map(key => Array.from(key === 'gradientDefIdBuffer' ? new Uint16Array(snapshot[key]!) : new Uint8Array(snapshot[key]!))) };
  } finally {
    brush.cleanup(); useAppStore.getState().clearSelection();
    if (erased) useAppStore.setState({ layers: originalLayers });
  }
};

describe('native Color Cycle Lost Edge', () => {
  it.each(['plain', 'pencil', 'bristles', 'dither', 'dither-gaps', 'rotated', 'clip', 'empty-pencil'])(
    'keeps precise %s healing membership without Lost Edge', mode => {
      const result = draw(0, mode, true, true);
      expect(result.mask).not.toBeNull();
      const mask = result.mask!;
      for (let y = 0; y < mask.height; y += 1) for (let x = 0; x < mask.width; x += 1) {
        const index = (y + mask.bounds.y) * 128 + x + mask.bounds.x;
        expect(Boolean(mask.data[y * mask.width + x])).toBe(result.after[2][index] !== 7);
      }
    },
  );
  it.each(['plain', 'pencil', 'bristles', 'dither', 'dither-gaps', 'rotated', 'clip'])('interrupts the %s contour and preserves prior canonical pixels', mode => {
    const solid = draw(0, mode);
    const interrupted = draw(100, mode);
    const solidCount = solid.after[0].filter(Boolean).length;
    const interruptedCount = interrupted.after[0].filter(Boolean).length;
    expect(interruptedCount).toBeGreaterThan(0);
    expect(interruptedCount).toBeLessThan(solidCount);
    const overlap = draw(100, mode, true);
    expect(overlap.mask).not.toBeNull();
    const mask = overlap.mask!;
    for (let y = 0; y < mask.height; y += 1) for (let x = 0; x < mask.width; x += 1) {
      const index = (y + mask.bounds.y) * 128 + x + mask.bounds.x;
      expect(Boolean(mask.data[y * mask.width + x])).toBe(overlap.after[2][index] !== 7);
    }
    let restored = 0;
    for (let i = 0; i < overlap.after[0].length; i += 1) {
      if (overlap.after[0][i] !== 99) continue;
      for (let channel = 0; channel < channels.length; channel += 1) expect(overlap.after[channel][i]).toBe(overlap.before[channel][i]);
      if (solid.after[0][i]) restored += 1;
    }
    expect(restored).toBeGreaterThan(0);
  });
});
