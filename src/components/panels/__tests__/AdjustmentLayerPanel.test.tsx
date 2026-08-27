import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import type { Layer } from '@/types';

const hueSliderProps = jest.fn();

jest.mock('@/components/ui/HueSlider', () => ({
  HueSlider: ({
    value,
    onValueChange,
    onValueCommit,
    'aria-label': ariaLabel,
  }: {
    value: number[];
    onValueChange: (value: number[]) => void;
    onValueCommit: (value: number[]) => void;
    'aria-label': string;
  }) => {
    hueSliderProps({ value, onValueChange, onValueCommit, ariaLabel });
    return (
      <input
        type="range"
        min={-180}
        max={180}
        value={value[0]}
        aria-label={ariaLabel}
        onChange={(event) => onValueChange([Number(event.target.value)])}
        onPointerUp={() => onValueCommit(value)}
      />
    );
  },
}));

jest.mock('@/components/ui/ProgressSlider', () => ({
  __esModule: true,
  default: ({
    value,
    min,
    max,
    onChange,
    onCommit,
    'aria-label': ariaLabel,
  }: {
    value: number;
    min: number;
    max: number;
    onChange: (value: number) => void;
    onCommit: () => void;
    'aria-label': string;
  }) => (
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(Number(event.target.value))}
      onPointerUp={onCommit}
    />
  ),
}));

const adjustmentLayer = {
  id: 'adjustment-1',
  name: 'Hue/Sat 1',
  layerType: 'adjustment',
  visible: true,
  opacity: 1,
  order: 1,
  adjustmentData: {
    effect: {
      id: 'hue-sat',
      settings: {
        hue: 0,
        saturation: 0,
        vibrance: 0,
        lightness: 0,
        contrast: 0,
        red: 0,
        green: 0,
        blue: 0,
        hueRangeEnabled: false,
        hueRangeStart: 0,
        hueRangeEnd: 360,
      },
    },
  },
} as Layer;

const paintLayer = {
  id: 'paint-1',
  name: 'Portrait',
  layerType: 'normal',
  visible: true,
  opacity: 1,
  order: 0,
} as Layer;

const store = {
  activeLayerId: adjustmentLayer.id,
  layers: [paintLayer, adjustmentLayer],
  layerGroups: [],
  beginAdjustmentLayerEdit: jest.fn(),
  updateAdjustmentLayerEffect: jest.fn(),
  commitAdjustmentLayerEdit: jest.fn(),
  updateLayer: jest.fn(),
};

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: <T,>(selector: (state: typeof store) => T): T => selector(store),
}));

import AdjustmentLayerPanel from '@/components/panels/AdjustmentLayerPanel';

describe('AdjustmentLayerPanel hue control', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses one colour-strip slider for hue preview and commit', () => {
    render(<AdjustmentLayerPanel />);

    expect(screen.queryByText('Hue Range')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Enable adjustment hue range')).not.toBeInTheDocument();

    const hueSlider = screen.getByRole('slider', { name: 'Hue adjustment' });
    fireEvent.change(hueSlider, { target: { value: '89' } });

    expect(store.beginAdjustmentLayerEdit).toHaveBeenCalledWith(adjustmentLayer.id);
    expect(store.updateAdjustmentLayerEffect).toHaveBeenCalledWith(
      adjustmentLayer.id,
      expect.objectContaining({
        id: 'hue-sat',
        settings: expect.objectContaining({
          hue: 89,
          hueRangeEnabled: false,
          hueRangeStart: 0,
          hueRangeEnd: 360,
        }),
      }),
    );

    fireEvent.pointerUp(hueSlider);
    expect(store.commitAdjustmentLayerEdit).toHaveBeenCalledWith(adjustmentLayer.id);
    expect(hueSliderProps).toHaveBeenCalledWith(expect.objectContaining({
      value: [0],
      ariaLabel: 'Hue adjustment',
    }));
  });

  it('replaces the instructional copy with a layer-target dropdown', () => {
    render(<AdjustmentLayerPanel />);

    expect(screen.queryByText(/Layer opacity controls strength/)).not.toBeInTheDocument();
    expect(screen.getByText('Affects')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All lower layers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Portrait' }));

    expect(store.beginAdjustmentLayerEdit).toHaveBeenCalledWith(adjustmentLayer.id);
    expect(store.updateLayer).toHaveBeenCalledWith(adjustmentLayer.id, {
      adjustmentData: expect.objectContaining({
        targetLayerIds: [paintLayer.id],
      }),
    });
    expect(store.commitAdjustmentLayerEdit).toHaveBeenCalledWith(adjustmentLayer.id);
  });
});
