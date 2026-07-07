import {
  __resetGradientApplySchedulerForTests,
  applyRuntimeToBrush,
  createColorCycleGradientApplyBrushContext,
  flushGradientApply,
  setGradientApplyBrushGetter,
  setGradientApplyDocumentVersionGetter,
  setGradientApplyStateGetter,
  type ColorCycleGradientApplyBrush,
} from '@/hooks/brushEngine/ccGradientApplyScheduler';
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
  beforeEach(() => {
    __resetGradientApplySchedulerForTests();
  });

  afterEach(() => {
    __resetGradientApplySchedulerForTests();
  });

  it('creates a minimal bound gradient-apply context from a runtime brush', () => {
    const calls: Array<{ method: string; layerId?: string; slot?: number }> = [];
    const runtimeBrush = {
      extraEngineMethod: jest.fn(),
      commitCurrentStroke(this: { marker: string }, layerId?: string) {
        calls.push({ method: `commit:${this.marker}`, layerId });
      },
      flush(this: { marker: string }, layerId?: string) {
        calls.push({ method: `flush:${this.marker}`, layerId });
      },
      setGradientSlotStops(
        this: { marker: string },
        layerId: string,
        slot: number,
      ) {
        calls.push({ method: `slotStops:${this.marker}`, layerId, slot });
      },
      setActiveGradientSlot(
        this: { marker: string },
        layerId: string,
        slot: number,
      ) {
        calls.push({ method: `activeSlot:${this.marker}`, layerId, slot });
      },
      marker: 'runtime',
    };

    const context = createColorCycleGradientApplyBrushContext(runtimeBrush);

    expect(context).not.toBe(runtimeBrush);
    expect(Object.keys(context ?? {}).sort()).toEqual([
      'commitCurrentStroke',
      'flush',
      'setActiveGradientSlot',
      'setGradientSlot',
      'setGradientSlotStops',
    ]);
    expect('extraEngineMethod' in (context ?? {})).toBe(false);

    context?.commitCurrentStroke?.('layer-1');
    context?.flush?.('layer-1');
    context?.setGradientSlotStops?.('layer-1', 3, []);
    context?.setActiveGradientSlot?.('layer-1', 3);

    expect(calls).toEqual([
      { method: 'commit:runtime', layerId: 'layer-1' },
      { method: 'flush:runtime', layerId: 'layer-1' },
      { method: 'slotStops:runtime', layerId: 'layer-1', slot: 3 },
      { method: 'activeSlot:runtime', layerId: 'layer-1', slot: 3 },
    ]);
  });

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
    } as unknown as BrushMock & ColorCycleGradientApplyBrush;

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
    } as unknown as BrushMock & ColorCycleGradientApplyBrush;

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

  it('reapplies unchanged palette signatures when the source document version changes', () => {
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
    } as unknown as BrushMock & ColorCycleGradientApplyBrush;

    applyRuntimeToBrush(brush, 'versioned-layer', createSnapshot({
      layerId: 'versioned-layer',
      builtFromVersion: 1,
    }));

    brush.setGradientSlotStops.mockClear();
    brush.setActiveGradientSlot.mockClear();
    brush.commitCurrentStroke.mockClear();
    brush.flush.mockClear();

    applyRuntimeToBrush(brush, 'versioned-layer', createSnapshot({
      layerId: 'versioned-layer',
      builtFromVersion: 1,
    }));

    expect(brush.setGradientSlotStops).not.toHaveBeenCalled();
    expect(brush.setActiveGradientSlot).not.toHaveBeenCalled();

    applyRuntimeToBrush(brush, 'versioned-layer', createSnapshot({
      layerId: 'versioned-layer',
      builtFromVersion: 2,
    }));

    expect(brush.setGradientSlotStops).toHaveBeenCalledWith(
      'versioned-layer',
      0,
      expect.arrayContaining([
        expect.objectContaining({ color: '#ff0000' }),
      ]),
      undefined,
    );
    expect(brush.setActiveGradientSlot).toHaveBeenCalledWith('versioned-layer', 0);
  });

  it('stamps flush-built snapshots with the current document version', () => {
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
    } as unknown as BrushMock & ColorCycleGradientApplyBrush;
    const layer = {
      id: 'flush-versioned-layer',
      layerType: 'color-cycle',
      colorCycleData: {
        paintSlot: 0,
        slotPalettes: [{
          slot: 0,
          stops: [
            { position: 0, color: '#ff0000' },
            { position: 1, color: '#00ff00' },
          ],
        }],
      },
    };
    let documentVersion = 7;

    setGradientApplyStateGetter(() => ({
      layers: [layer],
      tools: { brushSettings: {} },
    } as never));
    setGradientApplyBrushGetter(() => brush);
    setGradientApplyDocumentVersionGetter(() => documentVersion);

    flushGradientApply('flush-versioned-layer');

    brush.setGradientSlotStops.mockClear();
    brush.setActiveGradientSlot.mockClear();
    flushGradientApply('flush-versioned-layer');

    expect(brush.setGradientSlotStops).not.toHaveBeenCalled();
    expect(brush.setActiveGradientSlot).not.toHaveBeenCalled();

    documentVersion = 8;
    flushGradientApply('flush-versioned-layer');

    expect(brush.setGradientSlotStops).toHaveBeenCalledWith(
      'flush-versioned-layer',
      0,
      expect.arrayContaining([
        expect.objectContaining({ color: '#ff0000' }),
      ]),
      'hard',
    );
  });
});
