import { sampleColorAdjustTarget } from '@/hooks/canvas/handlers/colorAdjustTargetSampling';

const mockPick = jest.fn();
const mockComposite = jest.fn();
const state = {
  colorAdjust: { active: true, isPickingTarget: true },
  project: { width: 10, height: 10 },
  compositeLayersToCanvasSync: mockComposite,
  pickColorAdjustTarget: mockPick,
};
jest.mock('@/stores/appStoreAccess', () => ({ getAppStoreState: () => state }));

describe('canvas target sampling', () => {
  beforeEach(() => {
    mockPick.mockReset();
    mockComposite.mockReset().mockReturnValue(true);
  });

  it('refreshes and reads only the exact clicked pixel on every pick', () => {
    const canvas = document.createElement('canvas');
    const read = jest.fn()
      .mockReturnValueOnce({ data: new Uint8ClampedArray([0, 255, 0, 255]) })
      .mockReturnValueOnce({ data: new Uint8ClampedArray([0, 0, 255, 128]) });
    jest.spyOn(canvas, 'getContext').mockImplementation((() => ({ getImageData: read })) as unknown as HTMLCanvasElement['getContext']);
    sampleColorAdjustTarget({ x: 5.9, y: 4.2 }, canvas);
    expect(read).toHaveBeenCalledWith(5, 4, 1, 1);
    expect(mockPick).toHaveBeenLastCalledWith('rgba(0, 255, 0, 1)');
    sampleColorAdjustTarget({ x: 5.9, y: 4.2 }, canvas);
    expect(mockComposite).toHaveBeenCalledTimes(2);
    expect(mockPick).toHaveBeenLastCalledWith(`rgba(0, 0, 255, ${128 / 255})`);
  });

  it('keeps picking when there is no pixel or composition is unavailable', () => {
    const canvas = document.createElement('canvas');
    jest.spyOn(canvas, 'getContext').mockImplementation((() => ({
      getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) }),
    })) as unknown as HTMLCanvasElement['getContext']);
    sampleColorAdjustTarget({ x: 5, y: 4 }, canvas);
    expect(mockPick).not.toHaveBeenCalled();
    mockComposite.mockReturnValue(false);
    sampleColorAdjustTarget({ x: 5, y: 4 }, canvas);
    expect(mockPick).not.toHaveBeenCalled();
    mockComposite.mockClear();
    sampleColorAdjustTarget({ x: 10, y: 4 }, canvas);
    expect(mockComposite).not.toHaveBeenCalled();
  });
});
