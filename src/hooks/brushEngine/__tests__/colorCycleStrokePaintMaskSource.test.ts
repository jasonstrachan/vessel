import studioExtension from '@/extensions/studioExtension';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { createColorCycleStrokePaintMask, prepareColorCycleStrokePaintMask } from '../colorCycleStrokePaintMask';

jest.mock('@/extensions/studioExtension', () => ({ __esModule: true, default: { createColorCycleStrokePaintMask: jest.fn() } }));
jest.mock('@/stores/appStoreAccess', () => ({ getAppStoreState: jest.fn() }));

it('snapshots only the target layer and excludes fully erased/hidden authored pixels', () => {
  const erase = { data: new Uint8ClampedArray(16), width: 4, height: 1 };
  erase.data[7] = 255;
  erase.data[11] = 128;
  const soft = { data: new Uint8ClampedArray(16).fill(255), width: 4, height: 1 };
  soft.data[15] = 0;
  (getAppStoreState as jest.Mock).mockReturnValue({
    currentBrushPreset: { id: 'color-cycle-stroke' }, tools: { currentTool: 'brush', brushSettings: {} },
    layers: [{ id: 'other', colorCycleData: {} }, { id: 'target', colorCycleData: {
      eraseMaskImageData: erase, softEdgeMaskImageData: soft, softEdgeMaskEnabled: true,
    } }],
  });
  const factory = studioExtension.createColorCycleStrokePaintMask as jest.Mock;
  let captured: { width: number; height: number; data: Uint8Array };
  factory.mockImplementation(context => { captured = context.readSourceCoverage(); return null; });
  const paint = new Uint8Array([11, 22, 33, 44]);
  createColorCycleStrokePaintMask('target', 4, 1, paint);
  paint.fill(0);
  expect(captured!).toEqual({ width: 4, height: 1, data: new Uint8Array([1, 0, 1, 0]) });
});

it('prepares the real round tip, excluding bounding-box corners', () => {
  const prepareStamp = jest.fn();
  prepareColorCycleStrokePaintMask({ acceptsPixel: () => true, prepareStamp }, 16, 16, 10, 'round', 32, 32);
  const f = prepareStamp.mock.calls[0][0].footprint;
  const at = (x: number, y: number) => f.data[(y - f.originY) * f.size + x - f.originX];
  expect(at(16, 16)).toBe(1);
  expect(at(11, 11)).toBe(0);
});

it('prepares the full minimum pixelated tip even at size one', () => {
  const prepareStamp = jest.fn();
  prepareColorCycleStrokePaintMask({ acceptsPixel: () => true, prepareStamp }, 16, 16, 1, 'diamond9', 32, 32);
  const f = prepareStamp.mock.calls[0][0].footprint;
  const at = (x: number, y: number) => f.data[(y - f.originY) * f.size + x - f.originX];
  expect(at(11, 15)).toBe(1);
  expect(at(19, 15)).toBe(1);
  expect(at(11, 11)).toBe(0);
});


describe('settled selection at Color Cycle stroke start', () => {
  const state = {
    currentBrushPreset: { id: 'color-cycle-stroke' },
    tools: { currentTool: 'brush', brushSettings: {} },
    layers: [{ id: 'target', colorCycleData: {} }],
    selectionStart: null as { x: number; y: number } | null,
    selectionEnd: null as { x: number; y: number } | null,
    selectionMask: null as ImageData | null,
    selectionMaskBounds: null as { x: number; y: number; width: number; height: number } | null,
    selectionMaskLayerId: 'other',
  };
  const factory = studioExtension.createColorCycleStrokePaintMask as jest.Mock;

  beforeEach(() => {
    state.selectionStart = null;
    state.selectionEnd = null;
    state.selectionMask = null;
    state.selectionMaskBounds = null;
    factory.mockReset().mockReturnValue(null);
    (getAppStoreState as jest.Mock).mockReturnValue(state);
  });

  it('keeps an unrestricted stroke unrestricted when neither selection nor Studio mask exists', () => {
    expect(createColorCycleStrokePaintMask('target', 4, 2, new Uint8Array(8))).toBeNull();
  });

  it('honors selection when the optional Studio factory is absent', () => {
    const original = studioExtension.createColorCycleStrokePaintMask;
    studioExtension.createColorCycleStrokePaintMask = undefined;
    try {
      state.selectionStart = { x: 1, y: 0 };
      state.selectionEnd = { x: 3, y: 2 };
      const mask = createColorCycleStrokePaintMask('target', 4, 2, new Uint8Array(8));
      expect(mask).not.toBeNull();
      expect(mask?.acceptsPixel(0, 0)).toBe(false);
      expect(mask?.acceptsPixel(1, 0)).toBe(true);
    } finally {
      studioExtension.createColorCycleStrokePaintMask = original;
    }
  });

  it.each([false, true])('clips the half-open rectangle with reversed endpoints %s', (reversed) => {
    state.selectionStart = reversed ? { x: 3, y: 2 } : { x: 1, y: 0 };
    state.selectionEnd = reversed ? { x: 1, y: 0 } : { x: 3, y: 2 };
    const mask = createColorCycleStrokePaintMask('target', 4, 2, new Uint8Array(8));
    expect(mask).not.toBeNull();
    expect(Array.from({ length: 8 }, (_, i) => mask?.acceptsPixel(i % 4, Math.floor(i / 4))))
      .toEqual([false, true, true, false, false, true, true, false]);
    state.selectionStart!.x = 0;
    state.selectionEnd!.x = 4;
    expect(mask?.acceptsPixel(0, 0)).toBe(false);
  });

  it('snapshots binary mask membership before rectangle and ignores its source layer', () => {
    const data = new Uint8ClampedArray(16);
    data.set([12, 34, 56, 1, 255, 255, 255, 0, 0, 0, 0, 80, 12, 34, 56, 255]);
    state.selectionMask = { width: 2, height: 2, data, colorSpace: 'srgb' };
    state.selectionMaskBounds = { x: 1, y: 0, width: 2, height: 2 };
    state.selectionStart = { x: 0, y: 0 };
    state.selectionEnd = { x: 4, y: 2 };
    const mask = createColorCycleStrokePaintMask('target', 4, 2, new Uint8Array(8));
    expect(mask).not.toBeNull();
    expect(Array.from({ length: 8 }, (_, i) => mask?.acceptsPixel(i % 4, Math.floor(i / 4))))
      .toEqual([false, true, false, false, false, true, true, false]);
    data.fill(255);
    state.selectionMaskBounds.x = 0;
    expect(mask?.acceptsPixel(2, 0)).toBe(false);
    expect(mask?.acceptsPixel(0, 0)).toBe(false);
  });

  it('keeps fully outside or empty selection coverage empty', () => {
    state.selectionStart = { x: 7, y: 0 };
    state.selectionEnd = { x: 9, y: 2 };
    const outside = createColorCycleStrokePaintMask('target', 4, 2, new Uint8Array(8));
    expect(outside).not.toBeNull();
    expect(outside?.acceptsPixel(3, 0)).toBe(false);
    state.selectionMask = { width: 1, height: 1, data: new Uint8ClampedArray(4), colorSpace: 'srgb' };
    state.selectionMaskBounds = { x: 1, y: 0, width: 1, height: 1 };
    const empty = createColorCycleStrokePaintMask('target', 4, 2, new Uint8Array(8));
    expect(empty?.acceptsPixel(1, 0)).toBe(false);
  });

  it('intersects Studio membership and forwards stamp preparation with its receiver', () => {
    state.selectionStart = { x: 1, y: 0 };
    state.selectionEnd = { x: 3, y: 2 };
    const studioMask = {
      acceptsPixel: jest.fn((x: number, y: number) => x !== 2 && y === 0),
      prepareStamp: jest.fn(),
    };
    factory.mockReturnValue(studioMask);
    const mask = createColorCycleStrokePaintMask('target', 4, 2, new Uint8Array(8));
    expect(mask?.acceptsPixel(0, 0)).toBe(false);
    expect(mask?.acceptsPixel(1, 0)).toBe(true);
    expect(mask?.acceptsPixel(2, 0)).toBe(false);
    expect(mask?.acceptsPixel(1, 1)).toBe(false);
    const stamp = { x: 2, y: 1, size: 2 };
    mask?.prepareStamp?.(stamp);
    expect(studioMask.prepareStamp).toHaveBeenCalledWith(stamp);
    expect(studioMask.prepareStamp.mock.contexts[0]).toBe(studioMask);
  });
});
