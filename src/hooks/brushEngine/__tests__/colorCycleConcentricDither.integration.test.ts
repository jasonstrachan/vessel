import { ColorCycleBrushCanvas2D } from '@/hooks/brushEngine/ColorCycleBrushCanvas2D';
import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import { ColorCycleLayerDocument, createEmptyColorCycleLayerDocumentState } from '@/lib/colorCycle/document';
import { useAppStore } from '@/stores/useAppStore';

const vertices = [{ x: 4, y: 4 }, { x: 60, y: 4 }, { x: 60, y: 60 }, { x: 4, y: 60 }];

describe('Concentric CC Tonal Dither with an available GPU fill', () => {
  it.each(['bayer', 'atkinson', 'pattern'] as const)(
    'uses the selected %s algorithm and ink count instead of the generic GPU fill',
    async algorithm => {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
      const layerId = 'concentric-dither';
      const layerDocument = new ColorCycleLayerDocument(createEmptyColorCycleLayerDocumentState({
        layerId, width: 64, height: 64,
      }));
      // The generic GPU shader accepts the job, but cannot express these dither settings.
      const gpuFill = jest.spyOn(ColorCycleAnimator.prototype, 'gpuFillShape').mockReturnValue(true);
      try {
        useAppStore.getState().clearSelection();
        brush.setColorCycleLayerDocument(layerId, layerDocument);
        brush.setLayerId(layerId); brush.setActiveLayer(layerId);
        brush.setGradient([{ position: 0, color: '#202040' }, { position: 1, color: '#e0c0a0' }], layerId);
        brush.setGradientBands(64);
        brush.setDitherEnabled(true);
        brush.setPerceptualDither(false);
        brush.setStampDitherAlgorithm(algorithm);
        brush.setStampDitherPatternStyle('lines');
        brush.startStroke(layerId);
        await brush.fillShapeDispatch({
          mode: 'concentric', vertices, layerId,
          options: { ccGradient: true, ditherLevels: 2, ditherPixelSize: 2 },
        });
        brush.endStroke(layerId);
        expect(gpuFill).not.toHaveBeenCalled();
        const painted = new Uint8Array(layerDocument.read().snapshot.paintBuffer!);
        const indices = new Set(painted.filter(Boolean));
        expect(indices.size).toBe(2);
        expect(painted.filter(Boolean).length).toBeGreaterThan(1000);
      } finally {
        gpuFill.mockRestore();
        brush.cleanup();
      }
    },
  );
});
