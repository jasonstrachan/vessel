import { createColorCycleStrokeMaskHealer } from '@/hooks/brushEngine/colorCycleStrokeMaskHeal';
import { ColorCycleBrushCanvas2D } from '@/hooks/brushEngine/ColorCycleBrushCanvas2D';
import { ColorCycleLayerDocument, createEmptyColorCycleLayerDocumentState } from '@/lib/colorCycle/document';
import { useAppStore } from '@/stores/useAppStore';

type Mode = 'plain' | 'pencil' | 'bristles' | 'dither' | 'dither-bristles' | 'dither-gaps';
type Shape = 'square' | 'round' | 'diamond' | 'triangle';

const paintStamp = (shape: Shape, rotation: number, mode: Mode = 'plain', clip = false) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const brush = new ColorCycleBrushCanvas2D(canvas, { brushSize: 20, forceCanvas2D: true });
  const layerId = 'native-rotation';
  const state = createEmptyColorCycleLayerDocumentState({ layerId, width: 64, height: 64 });
  // Every untouched pixel has distinct existing canonical metadata.
  new Uint8Array(state.paintBuffer!).fill(99);
  new Uint16Array(state.gradientDefIdBuffer!).fill(7);
  state.hasContent = true;
  const layerDocument = new ColorCycleLayerDocument(state);
  useAppStore.getState().clearSelection();
  useAppStore.getState().setBrushSettings({
    size: 20,
    colorCyclePencilEnabled: mode === 'pencil',
    colorCyclePencilSensitivity: 50,
    colorCycleBristlesEnabled: mode.includes('bristles'),
    colorCycleBristleStrength: 100,
    colorCycleBristleWidth: 2,
    ditherPatternDiversity: 0,
  });
  if (clip) useAppStore.getState().setSelectionBounds({ x: 32, y: 0 }, { x: 64, y: 64 });
  brush.setColorCycleLayerDocument(layerId, layerDocument);
  brush.setLayerId(layerId);
  brush.setActiveLayer(layerId);
  brush.setStampShape(shape);
  brush.setStampDitherEnabled(mode.startsWith('dither'));
  brush.setStampDitherBgFill(mode !== 'dither-gaps');
  brush.setStampDitherAlgorithm('bayer');
  brush.setGradient([{ position: 0, color: '#ff0000' }, { position: 1, color: '#00ff00' }], layerId);
  try {
    brush.startStroke(layerId);
    brush.paint(32, 32, layerId, 1, rotation);
    brush.renderDirectToCanvas(canvas, layerId);
    brush.endStroke(layerId);
    const read = layerDocument.read().snapshot;
    return {
      paint: new Uint8Array(read.paintBuffer!).slice(),
      def: new Uint16Array(read.gradientDefIdBuffer!).slice(),
      phase: new Uint8Array(read.phaseBuffer!).slice(),
    };
  } finally {
    brush.cleanup();
    useAppStore.getState().clearSelection();
  }
};

describe('native Color Cycle rotation', () => {
  it.each(['square', 'diamond', 'triangle'] as const)('rotates authored %s geometry and metadata together', shape => {
    const straight = paintStamp(shape, 0);
    const turned = paintStamp(shape, Math.PI / 4);
    expect(turned.paint).not.toEqual(straight.paint);
    for (let i = 0; i < turned.paint.length; i += 1) {
      expect(turned.def[i]).toBe(turned.paint[i] === 99 ? 7 : 0);
    }
  });

  it('keeps round geometry independent of rotation', () => {
    expect(paintStamp('round', Math.PI / 4)).toEqual(paintStamp('round', 0));
  });

  it.each(['pencil', 'bristles', 'dither', 'dither-bristles', 'dither-gaps'] as const)(
    'rotates %s while preserving selection and previous ink', mode => {
      const straight = paintStamp('square', 0, mode, true);
      const turned = paintStamp('square', Math.PI / 4, mode, true);
      expect(turned.paint).not.toEqual(straight.paint);
      for (let i = 0; i < turned.paint.length; i += 1) {
        if (i % 64 < 32) {
          expect(turned.paint[i]).toBe(99);
          expect(turned.def[i]).toBe(7);
          expect(turned.phase[i]).toBe(0);
        }
        if (turned.paint[i] !== 99) expect(turned.def[i]).toBe(0);
      }
    },
  );
});

it('heals every rotated native pixel without healing outside the tip', () => {
  const authored = paintStamp('square', Math.PI / 4);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const healed = new Uint8Array(64 * 64);
  const healer = createColorCycleStrokeMaskHealer({
    internalCanvas: canvas,
    layerId: 'native-rotation',
    resolveStampTargetSize: () => 20,
    healColorCycleEraseMask: (_id, mask) => {
      for (let y = 0; y < mask.height; y += 1) {
        for (let x = 0; x < mask.width; x += 1) {
          healed[(mask.bounds.y + y) * 64 + mask.bounds.x + x] = mask.data[y * mask.width + x] ? 1 : 0;
        }
      }
    },
  });
  healer.markPaintedStamp({ x: 32, y: 32, width: 24, height: 24, shape: 'square', pressure: 1, rotation: Math.PI / 4 });
  healer.healPaintedEraseMask();
  expect(healed).toEqual(Uint8Array.from(authored.paint, value => value === 99 ? 0 : 1));
});
