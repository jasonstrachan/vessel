import {
  mergeTransferredColorCycleGradientDefs,
  type TransferredColorCycleGradientDef,
} from '@/stores/helpers/colorCycleGradientDefTransfer';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';
import { EXHAUSTED_COLOR_CYCLE_DEF_ID, MAX_COLOR_CYCLE_DEF_ID } from '@/utils/colorCycleDefIds';

describe('colorCycleGradientDefTransfer', () => {
  const createLayer = (overrides?: Partial<Layer>): Layer => ({
    id: 'layer-1',
    name: 'Layer 1',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order: 0,
    imageData: null,
    framebuffer: document.createElement('canvas'),
    alignment: createDefaultLayerAlignment(),
    layerType: 'color-cycle',
    colorCycleData: {
      gradientDefs: [],
      slotPalettes: [],
      gradientDefStore: [],
      nextGradientDefId: 1,
    },
    version: 1,
    ...(overrides ?? {}),
  });

  const transferredDef = (id: number, hash: string, slot = 9): TransferredColorCycleGradientDef => ({
    id,
    kind: 'linear',
    stops: [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ],
    hash,
    source: 'manual',
    createdAtMs: 1,
    slot,
  });

  it.each([1, 7])('keeps copied sampled-path playback independent when source definition %s matches existing colours', async (sourceId) => {
    const { ColorCycleAnimator } = await import('@/lib/ColorCycleAnimator');
    const { createDefPaletteCache } = await import('@/hooks/brushEngine/colorCycleDefPaletteCache');
    const rgba = btoa(String.fromCharCode(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255));
    const def = { ...transferredDef(1, 'same-source'), sampledPath: { rgba, offset: 0 } };
    const layer = createLayer({ colorCycleData: { gradientDefStore: [def] } });
    const result = mergeTransferredColorCycleGradientDefs({ layer,
      defs: [{ ...def, id: sourceId }], defIds: new Uint16Array([sourceId]),
    });
    const incomingId = result.remappedDefIds![0];
    const animator = new ColorCycleAnimator({ width: 2, height: 1, forceCanvas2D: true });
    try {
      animator.setIndexBufferFromArray(new Uint8Array([1, 1]), new Uint8Array(2),
        new Uint8Array([17, 34]), new Uint8Array([5, 5]), new Uint8Array(2));
      animator.setDefIdData(new Uint16Array([1, incomingId]));
      animator.setDefPaletteCache(createDefPaletteCache(result.layer.colorCycleData!.gradientDefStore!, 1));
      (animator as unknown as { renderFrame(offset: number, time: number): void }).renderFrame(0, 1);
      const pixels = animator.getImageData().data;
      expect([...pixels.slice(4)]).not.toEqual([...pixels.slice(0, 4)]);
      expect(incomingId).not.toBe(1);
      expect(layer.colorCycleData?.gradientDefStore).toEqual([def]);
    } finally { animator.cleanup(); }
  });

  it('falls back to the first free def id when a preferred legacy id collides after Uint16 overflow', () => {
    const sourceDefId = 7;
    const layer = createLayer({
      colorCycleData: {
        gradientDefs: [],
        slotPalettes: [],
        gradientDefStore: [
          transferredDef(1, 'linear:a', 1),
          transferredDef(3, 'linear:b', 3),
          transferredDef(sourceDefId, 'linear:occupied', sourceDefId),
          transferredDef(MAX_COLOR_CYCLE_DEF_ID, 'linear:max', 11),
        ],
        nextGradientDefId: MAX_COLOR_CYCLE_DEF_ID + 1,
      },
    });

    const result = mergeTransferredColorCycleGradientDefs({
      layer,
      defs: [transferredDef(sourceDefId, 'linear:incoming', 12)],
      defIds: new Uint16Array([sourceDefId, sourceDefId, 0, 0]),
    });

    expect(Array.from(result.remappedDefIds ?? [])).toEqual([2, 2, 0, 0]);
    expect(result.layer.colorCycleData?.gradientDefStore).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: sourceDefId, hash: 'linear:occupied' }),
        expect.objectContaining({ id: 2, hash: 'linear:incoming', slot: 12 }),
      ])
    );
    expect(result.layer.colorCycleData?.nextGradientDefId).toBe(4);
  });

  it('reports exhaustion when no Uint16 def ids remain for a colliding transferred def', () => {
    const sourceDefId = MAX_COLOR_CYCLE_DEF_ID;
    const usedDefs = Array.from({ length: MAX_COLOR_CYCLE_DEF_ID }, (_, index) =>
      transferredDef(index + 1, `linear:${index + 1}`)
    );
    const layer = createLayer({
      colorCycleData: {
        gradientDefs: [],
        slotPalettes: [],
        gradientDefStore: usedDefs,
        nextGradientDefId: MAX_COLOR_CYCLE_DEF_ID + 1,
      },
    });

    const result = mergeTransferredColorCycleGradientDefs({
      layer,
      defs: [transferredDef(sourceDefId, 'linear:incoming-exhausted', 14)],
      defIds: new Uint16Array([sourceDefId, 0]),
    });

    expect(Array.from(result.remappedDefIds ?? [])).toEqual([0, 0]);
    expect(result.changed).toBe(true);
    expect(result.layer.colorCycleData?.gradientDefStore).toHaveLength(MAX_COLOR_CYCLE_DEF_ID);
    expect(result.layer.colorCycleData?.nextGradientDefId).toBe(EXHAUSTED_COLOR_CYCLE_DEF_ID);
  });
});
