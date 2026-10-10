import { createStore } from 'zustand/vanilla';

import { ColorCycleLayerDocument } from '@/lib/colorCycle/document';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { createLayerColorCycleSlotActions } from '@/stores/layers/layerColorCycleSlotActions';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

jest.mock('@/stores/ccRuntime', () => ({ syncPlaybackColorCycleLayers: jest.fn() }));
jest.mock('@/hooks/brushEngine/ccGradientApplyScheduler', () => ({
  ...jest.requireActual('@/hooks/brushEngine/ccGradientApplyScheduler'),
  requestGradientApply: jest.fn(),
}));

it('scheduled project GC preserves distinct canonical owners with colliding local definition ids', () => {
  jest.useFakeTimers();
  const manager = getColorCycleBrushManager();
  const layers: Layer[] = ['#ff0000', '#0000ff'].map((color, index) => {
    const id = `slot-gc-canonical-${index}`;
    const stops = [{ position: 0, color }, { position: 1, color }];
    const layer: Layer = {
      id, name: id, visible: true, opacity: 1, blendMode: 'source-over', locked: false,
      transparencyLocked: false, order: index, imageData: null,
      framebuffer: document.createElement('canvas'), alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle', version: 1,
      colorCycleData: {
        gradientDefs: [], slotPalettes: [1, 2].map(slot => ({ slot, stops })),
        gradientDefStore: [1, 2].map(defId => ({
          id: defId, slot: defId, kind: 'linear', stops, hash: `${color}-${defId}`,
          source: 'manual', createdAtMs: 0,
        })),
      },
    };
    manager.registerDocument(id, new ColorCycleLayerDocument({
      layerId: id, width: 2, height: 1, hasContent: true,
      paintBuffer: new Uint8Array([1, 1]).buffer,
      gradientIdBuffer: new Uint8Array([2, 2]).buffer,
      gradientDefIdBuffer: new Uint16Array([2, 2]).buffer,
      sources: { brushStateSnapshot: false, topLevelBuffers: false, legacyStateRefs: false },
    }));
    return layer;
  });
  try {
    const store = createStore<AppState>()(() => ({ layers, project: null }) as AppState);
    const actions = createLayerColorCycleSlotActions({
      set: store.setState, get: store.getState, syncPercentOffsetsFromPixels: next => next,
    });
    actions.scheduleColorCycleSlotRebuild('selection-extract');
    jest.advanceTimersByTime(250);
    store.getState().layers.forEach((layer, index) => {
      expect(layer.colorCycleData?.gradientDefStore?.find(def => def.id === 2)?.slot).toBe(2);
      expect(layer.colorCycleData?.slotPalettes).toEqual([layers[index].colorCycleData?.slotPalettes?.[1]]);
      expect(layer.colorCycleData?.gradientDefStore?.find(def => def.id === 1)?.slot).toBeUndefined();
      expect(layer.colorCycleData).not.toHaveProperty('gradientDefIdBuffer');
      expect(Array.from(new Uint16Array(manager.getDocument(layer.id)!.read().snapshot.gradientDefIdBuffer!))).toEqual([2, 2]);
    });
  } finally {
    layers.forEach(layer => manager.documents.delete(layer.id));
    jest.useRealTimers();
  }
});
