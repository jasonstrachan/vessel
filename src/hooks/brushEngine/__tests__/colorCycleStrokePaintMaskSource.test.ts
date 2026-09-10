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
