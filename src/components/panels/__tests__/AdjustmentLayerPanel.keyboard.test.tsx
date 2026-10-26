import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import AdjustmentLayerPanel from '@/components/panels/AdjustmentLayerPanel';
import historyManager from '@/history/historyService';
import { createDefaultAdjustmentEffect } from '@/lib/adjustmentLayers';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const initialState = useAppStore.getState();
const initialResizeObserver = global.ResizeObserver;
const literalPixels = [128, 64, 32, 255, 0, 0, 0, 0];

const hue = (id = 'keyboard-adjustment') => {
  const effect = useAppStore.getState().layers.find(layer => layer.id === id)?.adjustmentData?.effect;
  if (effect?.id !== 'hue-sat') throw new Error('Expected actual Hue/Sat owner');
  return effect.settings.hue;
};

const setup = (initialHue = 0) => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = 2; framebuffer.height = 1;
  const pixels = new ImageData(new Uint8ClampedArray(literalPixels), 2, 1);
  framebuffer.getContext('2d')!.putImageData(pixels, 0, 0);
  const normal: Layer = {
    id: 'keyboard-source', name: 'Source', order: 0, layerType: 'normal',
    visible: true, locked: false, opacity: 1, blendMode: 'source-over',
    alignment: createDefaultLayerAlignment(), imageData: pixels, framebuffer,
  };
  const adjustment = (id: string, order: number, value: number): Layer => {
    const effect = createDefaultAdjustmentEffect('hue-sat');
    if (effect.id !== 'hue-sat') throw new Error('Expected Hue/Sat defaults');
    return { ...normal, id, name: id, order, layerType: 'adjustment', imageData: null,
      framebuffer: document.createElement('canvas'),
      adjustmentData: { effect: { ...effect, settings: { ...effect.settings, hue: value } } } };
  };
  const layers = [normal, adjustment('keyboard-adjustment', 1, initialHue), adjustment('keyboard-other', 2, 0)];
  act(() => {
    useAppStore.setState(state => ({
      layers, layerGroups: [], hiddenLayerGroupIds: [], activeLayerId: 'keyboard-adjustment',
      selectedLayerIds: ['keyboard-adjustment'], referenceLayerId: null,
      selectionStart: null, selectionEnd: null, selectionMask: null,
      selectionMaskBounds: null, selectionMaskLayerId: null, selectionVectorPath: null,
      project: {
        ...state.project, id: 'keyboard-project', name: 'Keyboard history', width: 2, height: 1,
        layers, backgroundColor: 'transparent', createdAt: new Date(), updatedAt: new Date(),
        customBrushes: [], defaultCustomBrushId: null, palette: state.palette,
      },
    }));
  });
  historyManager.clear();
  return normal;
};

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(async () => {
  cleanup();
  await act(async () => { await Promise.resolve(); });
  historyManager.clear();
  act(() => { useAppStore.setState(initialState); });
  jest.restoreAllMocks();
});

afterAll(() => { global.ResizeObserver = initialResizeObserver; });

describe('AdjustmentLayerPanel actual controlled Radix keyboard history', () => {
  it.each([['Home', -180], ['End', 180], ['ArrowRight', 1], ['ArrowLeft', -1]] as const)(
    '%s commits the edited value once and preserves real Undo/Redo', async (key, expected) => {
      setup(); render(<AdjustmentLayerPanel />);
      const thumb = screen.getByRole('slider', { name: 'Hue adjustment' });
      expect(thumb.tagName).not.toBe('INPUT');
      await act(async () => {
        thumb.focus(); fireEvent.keyDown(thumb, { key }); fireEvent.keyUp(thumb, { key });
        await Promise.resolve();
      });
      expect(hue()).toBe(expected);
      expect(thumb).toHaveAttribute('aria-valuenow', String(expected));
      const entries = historyManager.entries();
      expect(entries).toHaveLength(1);
      const command = entries[0];
      expect(command.label).toBe('Edit adjustment layer');
      for (let cycle = 0; cycle < 2; cycle += 1) {
        await act(async () => { expect(await historyManager.undo()).toBe(command); });
        expect(hue()).toBe(0);
        await act(async () => { expect(await historyManager.redo()).toBe(command); });
        expect(hue()).toBe(expected);
        expect(hue('keyboard-other')).toBe(0);
        const source = useAppStore.getState().layers.find(layer => layer.id === 'keyboard-source')!;
        expect([...source.imageData!.data]).toEqual(literalPixels);
        const context = source.framebuffer.getContext('2d') as CanvasRenderingContext2D;
        expect([...context.getImageData(0, 0, 2, 1).data]).toEqual(literalPixels);
        expect(historyManager.entries().map(entry => entry.id)).toEqual([command.id]);
      }
    },
  );

  it('does not record an unchanged keyboard endpoint', async () => {
    setup(180); render(<AdjustmentLayerPanel />);
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Hue adjustment' }), { key: 'End' });
      await Promise.resolve();
    });
    expect(hue()).toBe(180);
    expect(historyManager.entries()).toHaveLength(0);
  });

  it('keeps the queued commit on the edited owner when same-turn cleanup changes the active layer', async () => {
    setup();
    const commit = useAppStore.getState().commitAdjustmentLayerEdit;
    const calls: string[] = [];
    act(() => { useAppStore.setState({ commitAdjustmentLayerEdit: id => { calls.push(id); commit(id); } }); });
    render(<AdjustmentLayerPanel />);
    act(() => {
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Hue adjustment' }), { key: 'Home' });
      useAppStore.setState({ activeLayerId: 'keyboard-other', selectedLayerIds: ['keyboard-other'] });
    });
    await act(async () => { await Promise.resolve(); });
    expect(hue()).toBe(-180);
    expect(hue('keyboard-other')).toBe(0);
    expect(calls).not.toContain('keyboard-other');
    expect(historyManager.entries()).toHaveLength(1);
    expect(useAppStore.getState().activeLayerId).toBe('keyboard-other');
    expect(useAppStore.getState().selectedLayerIds).toEqual(['keyboard-other']);
  });
});
