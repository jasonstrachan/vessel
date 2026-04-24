import { applyRuntimeToBrush } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import type { CCRuntimeSnapshot } from '@/hooks/brushEngine/ccGradientRuntime';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';

const createSnapshot = (
  overrides: Partial<CCRuntimeSnapshot> = {}
): CCRuntimeSnapshot => ({
  layerId: 'layer-1',
  paintSlot: 0,
  slotPalettes: [
    {
      slot: 0,
      stops: [
        { position: 0, color: '#ff0000' },
        { position: 1, color: '#00ff00' },
      ],
    },
  ],
  ...overrides,
});

describe('applyRuntimeToBrush', () => {
  it('commits and flushes before applying changed slot palettes', () => {
    type BrushMock = {
      setGradientSlotStops: jest.Mock;
      setActiveGradientSlot: jest.Mock;
      commitCurrentStroke: jest.Mock;
      flush: jest.Mock;
    };
    const brush = {
      setGradientSlotStops: jest.fn(),
      setActiveGradientSlot: jest.fn(),
      commitCurrentStroke: jest.fn(),
      flush: jest.fn(),
    } as unknown as BrushMock & ColorCycleBrushImplementation;

    const initialSnapshot = createSnapshot();
    applyRuntimeToBrush(brush, 'layer-1', initialSnapshot);

    brush.setGradientSlotStops.mockClear();
    brush.setActiveGradientSlot.mockClear();
    brush.commitCurrentStroke.mockClear();
    brush.flush.mockClear();

    applyRuntimeToBrush(
      brush,
      'layer-1',
      createSnapshot({
        slotPalettes: [
          {
            slot: 0,
            stops: [
              { position: 0, color: '#0000ff' },
              { position: 1, color: '#00ffff' },
            ],
          },
        ],
      })
    );

    expect(brush.commitCurrentStroke).toHaveBeenCalledWith('layer-1');
    expect(brush.setGradientSlotStops).toHaveBeenCalledWith(
      'layer-1',
      0,
      expect.arrayContaining([
        expect.objectContaining({ color: '#0000ff' }),
      ]),
      undefined,
    );
    expect(brush.flush).toHaveBeenCalledWith('layer-1');
  });

  it('does not finalize the live stroke for sampled temp palette preview updates', () => {
    type BrushMock = {
      setGradientSlotStops: jest.Mock;
      setActiveGradientSlot: jest.Mock;
      commitCurrentStroke: jest.Mock;
      flush: jest.Mock;
    };
    const brush = {
      setGradientSlotStops: jest.fn(),
      setActiveGradientSlot: jest.fn(),
      commitCurrentStroke: jest.fn(),
      flush: jest.fn(),
    } as unknown as BrushMock & ColorCycleBrushImplementation;

    applyRuntimeToBrush(brush, 'layer-1', createSnapshot({
      paintSlot: TEMP_SAMPLE_SLOT,
      slotPalettes: [
        {
          slot: TEMP_SAMPLE_SLOT,
          stops: [
            { position: 0, color: '#111111' },
            { position: 1, color: '#eeeeee' },
          ],
        },
      ],
    }));

    brush.setGradientSlotStops.mockClear();
    brush.setActiveGradientSlot.mockClear();
    brush.commitCurrentStroke.mockClear();
    brush.flush.mockClear();

    applyRuntimeToBrush(brush, 'layer-1', createSnapshot({
      paintSlot: TEMP_SAMPLE_SLOT,
      slotPalettes: [
        {
          slot: TEMP_SAMPLE_SLOT,
          stops: [
            { position: 0, color: '#aa3300' },
            { position: 1, color: '#ffee99' },
          ],
        },
      ],
    }));

    expect(brush.commitCurrentStroke).not.toHaveBeenCalled();
    expect(brush.setGradientSlotStops).toHaveBeenCalledWith(
      'layer-1',
      TEMP_SAMPLE_SLOT,
      expect.arrayContaining([
        expect.objectContaining({ color: '#aa3300' }),
      ]),
      undefined,
    );
    expect(brush.flush).toHaveBeenCalledWith('layer-1');
  });
});
