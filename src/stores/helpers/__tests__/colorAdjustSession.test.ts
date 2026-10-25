import {
  buildColorAdjustSessionTargets,
  isEligibleColorAdjustLayer,
  summarizeEligibleColorAdjustTargets,
} from '@/stores/helpers/colorAdjustSession';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';

const stops = [{ position: 0, color: '#ff0000' }, { position: 1, color: '#0000ff' }];
const image = new ImageData(2, 2);
const createLayer = (id: string, overrides: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  layerType: 'normal',
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'source-over',
  order: 0,
  imageData: image,
  framebuffer: null,
  alignment: createDefaultLayerAlignment(),
  ...overrides,
} as Layer);
const ccLayer = (id: string, overrides: Partial<Layer> = {}): Layer => createLayer(id, {
  layerType: 'color-cycle',
  imageData: null,
  colorCycleData: { gradient: stops } as Layer['colorCycleData'],
  ...overrides,
});
const capture = (layers: Layer[], activeLayerId: string, selectedLayerIds = [activeLayerId]) => {
  const state = { layers, activeLayerId, selectedLayerIds, project: { width: 2, height: 2 } } as AppState;
  const snapshotLayerImageData = jest.fn(() => image);
  const cloneColorCycleData = jest.fn((data: Layer['colorCycleData'] | undefined) => data ?? null);
  const resolveColorCycleGradient = jest.fn(() => stops);
  const captureColorCycleRuntimeSnapshot = jest.fn((state: AppState, layer: Layer) => ({ paint: new Uint8Array([1, 0, 0, 0]), layerId: layer.id, width: state.project?.width }));
  const resolveSelectionBounds = jest.fn(() => null);
  const result = buildColorAdjustSessionTargets({
    state,
    snapshotLayerImageData,
    cloneColorCycleData,
    resolveColorCycleGradient,
    captureColorCycleRuntimeSnapshot,
    resolveSelectionBounds,
  });
  return { result, snapshotLayerImageData, cloneColorCycleData, resolveColorCycleGradient, captureColorCycleRuntimeSnapshot, resolveSelectionBounds };
};

describe('Colour Adjust target lock authorization', () => {
  it.each(['normal', 'color-cycle'] as const)('excludes a locked %s from UI eligibility and summary', (type) => {
    const layer = type === 'normal' ? createLayer('locked', { locked: true }) : ccLayer('locked', { locked: true });
    expect(isEligibleColorAdjustLayer(layer)).toBe(false);
    expect(summarizeEligibleColorAdjustTargets(layer.id, [layer.id], [layer])).toEqual({ hasValidLayer: false, count: 0, label: 'Layer' });
  });

  it('retains eligible hidden targets and excludes only locked members of a mixed UI selection', () => {
    const hidden = createLayer('hidden', { visible: false });
    const hiddenCc = ccLayer('hidden-cc', { visible: false });
    const locked = ccLayer('locked', { locked: true });
    expect(isEligibleColorAdjustLayer(hidden)).toBe(true);
    expect(isEligibleColorAdjustLayer(hiddenCc)).toBe(true);
    expect(summarizeEligibleColorAdjustTargets(locked.id, [locked.id, hidden.id, hiddenCc.id], [hidden, locked, hiddenCc])).toEqual({ hasValidLayer: true, count: 2, label: '2 Layers' });
  });

  it.each(['normal', 'color-cycle'] as const)('rejects locked %s before any source or runtime snapshot side effect', (type) => {
    const layer = type === 'normal' ? createLayer('locked', { locked: true }) : ccLayer('locked', { locked: true });
    const q = capture([layer], layer.id);
    expect(q.result.eligibleLayerIds).toEqual([]);
    expect(q.result.firstLayerId).toBeNull();
    expect(q.result.hasColorCycleTarget).toBe(false);
    expect(q.result.originalImageDataByLayerId.size).toBe(0);
    expect(q.result.originalColorCycleDataByLayerId.size).toBe(0);
    expect(q.result.originalColorCycleSnapshotByLayerId.size).toBe(0);
    for (const callback of [q.snapshotLayerImageData, q.cloneColorCycleData, q.resolveColorCycleGradient, q.captureColorCycleRuntimeSnapshot, q.resolveSelectionBounds]) expect(callback).not.toHaveBeenCalled();
  });

  it('captures unlocked mixed targets while excluding a locked active member and preserving source fallback', () => {
    const lockedNormal = createLayer('locked-normal', { locked: true });
    const lockedCc = ccLayer('locked-cc', { locked: true });
    // Session snapshot owns the existing framebuffer fallback even without imageData.
    const fallback = createLayer('fallback', { imageData: null, visible: false });
    const cc = ccLayer('cc');
    const q = capture([lockedNormal, lockedCc, fallback, cc], lockedNormal.id, [lockedNormal.id, lockedCc.id, fallback.id, cc.id]);
    expect(q.result.eligibleLayerIds).toEqual([fallback.id, cc.id]);
    expect(q.result.firstLayerId).toBe(fallback.id);
    expect(q.result.firstOriginalImageData).toBe(image);
    expect(q.result.distinctLayerTypes).toEqual(new Set(['normal', 'color-cycle']));
    expect([...q.result.originalImageDataByLayerId.keys()]).toEqual([fallback.id]);
    expect([...q.result.originalColorCycleDataByLayerId.keys()]).toEqual([cc.id]);
    expect([...q.result.originalColorCycleSnapshotByLayerId.keys()]).toEqual([cc.id]);
    expect(q.snapshotLayerImageData).toHaveBeenCalledTimes(1);
    expect(q.snapshotLayerImageData).toHaveBeenCalledWith(fallback);
    expect(q.captureColorCycleRuntimeSnapshot).toHaveBeenCalledTimes(1);
    expect(q.captureColorCycleRuntimeSnapshot.mock.calls[0][1]).toBe(cc);
  });
});
