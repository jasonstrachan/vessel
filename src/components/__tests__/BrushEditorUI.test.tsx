/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import type { BrushSettings, CustomBrush, CustomBrushColorCycleV3 } from '@/types';

const makeCustomBrush = (): CustomBrush => {
  const imageData = new ImageData(16, 16);
  imageData.data.set([40, 80, 160, 128, 120, 180, 60, 255]);
  return {
    id: 'custom-1', name: 'Custom One', imageData, thumbnail: '',
    width: 16, height: 16, createdAt: 0,
  };
};

// Heavy mocking to avoid real store/effects
const mockState = {
  brushEditor: {
    status: 'EDITING',
    editingBrushId: 'custom-1',
    editingBounds: { x: 0, y: 0, width: 16, height: 16 },
    hueShift: 0,
    lightness: 0,
    saturation: 100,
  },
  tools: {
    brushSettings: {
      brushShape: 'custom',
      selectedCustomBrush: 'custom-1',
      size: 4,
      hueShift: 0,
      lightnessAdjust: 0,
      saturationAdjust: 100,
      currentBrushTip: undefined as BrushSettings['currentBrushTip'],
    },
  },
  project: {
    id: 'p1',
    name: 'demo',
    width: 32,
    height: 32,
    backgroundColor: '#000',
    layers: [],
    customBrushes: [makeCustomBrush()] as CustomBrush[],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  listCustomBrushes: () => mockState.project.customBrushes,
  setBrushEditorHue: jest.fn(),
  setBrushEditorLightness: jest.fn(),
  setBrushEditorSaturation: jest.fn(),
  saveBrushEdit: jest.fn(),
  startBrushEdit: jest.fn(),
  refreshCurrentBrushTipFromSource: jest.fn(),
  updateCurrentBrushTip: jest.fn(),
  getCustomBrushById: () => mockState.project.customBrushes[0],
  getCustomBrushByIdUnsafe: (id: string) => mockState.project.customBrushes.find(brush => brush.id === id) ?? null,
  currentOffscreenCanvas: null as HTMLCanvasElement | null,
  pushKeyboardScope: jest.fn(),
  popKeyboardScope: jest.fn(),
};
const mockSetState = jest.fn((updater) => {
  const next = typeof updater === 'function' ? updater(mockState) : updater;
  Object.assign(mockState, next);
});
const mockGetState = jest.fn(() => mockState);

jest.mock('@/stores/useAppStore', () => {
  const useAppStore = (selector: any) => selector(mockGetState());
  (useAppStore as any).getState = mockGetState;
  (useAppStore as any).setState = mockSetState;
  (useAppStore as any).subscribe = jest.fn();
  return { useAppStore };
});

jest.mock('@/hooks/useKeyboardScope', () => ({
  useKeyboardScope: jest.fn(),
}));

jest.mock('@/hooks/useBrushEngineSimplified', () => ({
  useBrushEngineSimplified: () => ({
    resetStroke: jest.fn(),
    drawBrush: jest.fn(),
  }),
}));

type SliderMockProps = {
  value?: number[];
  onValueChange?: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
};

const sliderMock = (testId: string) => {
  const SliderMock = ({ value = [0], onValueChange, min = -180, max = 180, step = 1 }: SliderMockProps) => (
    <input
      data-testid={testId}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value[0] ?? 0}
      onChange={(e) => onValueChange?.([Number(e.target.value)])}
    />
  );
  SliderMock.displayName = `${testId}-mock`;
  return SliderMock;
};

jest.mock('@/components/ui/HueSlider', () => ({ HueSlider: sliderMock('hue-slider') }));
jest.mock('@/components/ui/LightnessSlider', () => ({ LightnessSlider: sliderMock('lightness-slider') }));
jest.mock('@/components/ui/SaturationSlider', () => ({ SaturationSlider: sliderMock('saturation-slider') }));

jest.mock('@/components/BrushEditorUI', () => {
  // Re-export the default component to keep import paths intact
  const actual = jest.requireActual('@/components/BrushEditorUI');
  return actual;
});

import BrushEditorUI from '@/components/BrushEditorUI';

describe('BrushEditorUI sliders (mocked store)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.project.customBrushes = [makeCustomBrush()];
    mockState.currentOffscreenCanvas = null;
    mockState.brushEditor.status = 'EDITING';
    mockState.brushEditor.editingBrushId = 'custom-1';
    mockState.brushEditor.hueShift = 0;
    mockState.brushEditor.lightness = 0;
    mockState.brushEditor.saturation = 100;
    mockState.tools.brushSettings.selectedCustomBrush = 'custom-1';
    mockState.tools.brushSettings.currentBrushTip = undefined;
  });

  it.each([0, 35])('preserves the saved indexed-tip metadata during active editor adjustment at Lightness%s', lightness => {
    const brush = makeCustomBrush();
    const colorCycle: CustomBrushColorCycleV3 = {
      schemaVersion: 3, payloadKind: 'indexed-tip', source: 'color-cycle-layer',
      mapWidth: 16, mapHeight: 16, sourceCycleLength: 256,
      paintIndexMap: Uint16Array.from({ length: 256 }, (_, i) => i),
      alphaMask: Uint8Array.from({ length: 256 }, (_, i) => brush.imageData.data[i * 4 + 3]),
      gradient: [{ position: 0, color: '#204080' }, { position: 1, color: '#b8e060' }],
      speed: 0.17, phaseMode: 'global', phaseJitter: 0,
    };
    brush.colorCycle = colorCycle;
    mockState.project.customBrushes = [brush];
    mockState.brushEditor.lightness = lightness;
    mockState.tools.brushSettings.currentBrushTip = {
      brushId: brush.id, imageData: brush.imageData, width: 16, height: 16,
      isColorizable: false, colorCycle,
    };

    render(<BrushEditorUI />);

    const calls = mockState.updateCurrentBrushTip.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const tip = calls[calls.length - 1][0] as NonNullable<BrushSettings['currentBrushTip']>;
    expect(tip.brushId).toBe(brush.id);
    expect(tip.colorCycle).toBe(colorCycle);
    expect(tip.colorCycle).toEqual(brush.colorCycle);
    expect(tip.imageData.data[3]).toBe(128);
    expect(tip.imageData.data[7]).toBe(255);
    expect(Array.from(colorCycle.paintIndexMap)).toEqual(Array.from({ length: 256 }, (_, i) => i));
  });

  it('retries actual editor activation when the selected temporary tip becomes a saved asset', () => {
    const brush = makeCustomBrush();
    mockState.brushEditor.status = 'IDLE';
    mockState.project.customBrushes = [];
    const canvas = document.createElement('canvas');
    mockState.currentOffscreenCanvas = canvas;
    mockState.tools.brushSettings.currentBrushTip = {
      brushId: brush.id, imageData: brush.imageData, width: 16, height: 16, isColorizable: false,
    };
    const { rerender } = render(<BrushEditorUI />);
    expect(mockState.startBrushEdit).toHaveBeenCalledTimes(1);

    mockState.project.customBrushes = [brush];
    rerender(<BrushEditorUI />);

    expect(mockState.startBrushEdit).toHaveBeenCalledTimes(2);
    expect(mockState.startBrushEdit).toHaveBeenLastCalledWith(brush.id, canvas);
  });

  it('does not retry temporary-tip activation when only an unrelated saved asset arrives', () => {
    mockState.brushEditor.status = 'IDLE';
    mockState.project.customBrushes = [];
    mockState.currentOffscreenCanvas = document.createElement('canvas');
    const { rerender } = render(<BrushEditorUI />);
    expect(mockState.startBrushEdit).toHaveBeenCalledTimes(1);

    mockState.project.customBrushes = [{ ...makeCustomBrush(), id: 'unrelated' }];
    rerender(<BrushEditorUI />);

    expect(mockState.startBrushEdit).toHaveBeenCalledTimes(1);
  });

  it('updates hue/lightness/saturation and mirrors into brush settings', () => {
    render(<BrushEditorUI />);

    fireEvent.change(screen.getByTestId('hue-slider'), { target: { value: '45' } });
    fireEvent.change(screen.getByTestId('lightness-slider'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('saturation-slider'), { target: { value: '80' } });

    expect(mockState.setBrushEditorHue).toHaveBeenCalledWith(45);
    expect(mockState.setBrushEditorLightness).toHaveBeenCalledWith(10);
    expect(mockState.setBrushEditorSaturation).toHaveBeenCalledWith(80);
  });
});
