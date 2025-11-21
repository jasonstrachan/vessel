import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, type Layer, type Project } from '@/types';
import MinimalLayerList from '@/components/MinimalLayerList';

jest.mock('@/components/panels/AlignmentPanel', () => ({
  LayerAlignmentControls: () => <div data-testid="alignment-controls" />,
}));

jest.mock('@/utils/colorAnalyzer', () => ({
  ThrottledColorAnalyzer: jest.fn().mockImplementation(() => ({
    analyze: (_canvas: HTMLCanvasElement, callback: (swatches: unknown[]) => void) => callback([]),
    dispose: jest.fn(),
  })),
}));

jest.mock('@/components/ui/ProgressSlider', () => (props: any) => {
  const { value, onChange, min = 0, max = 1, step = 1 } = props;
  return (
    <input
      data-testid="progress-slider"
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
});

const createLayer = (id: string, order: number, visible = true): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  return {
    id,
    name: id,
    order,
    visible,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    layerType: 'normal',
    framebuffer: canvas,
    imageData: new ImageData(4, 4),
    alignment: { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };
};

const createProject = (layers: Layer[]): Project => ({
  id: 'p1',
  name: 'demo',
  width: 10,
  height: 10,
  backgroundColor: '#000',
  layers,
  customBrushes: [],
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('MinimalLayerList visibility toggling', () => {
  beforeEach(() => {
    const layers = [createLayer('layer-1', 1, true), createLayer('layer-2', 0, true)];
    const project = createProject(layers);

    useAppStore.setState((state) => ({
      ...state,
      project,
      layers,
      activeLayerId: 'layer-1',
      selectedLayerIds: ['layer-1', 'layer-2'],
      brushSettings: { ...state.brushSettings, brushShape: BrushShape.ROUND },
    }));
  });

  afterEach(() => {
    useAppStore.setState({ layers: [], project: null, activeLayerId: null, selectedLayerIds: [] });
  });

  it('toggles visibility for all selected layers when one eye is clicked', () => {
    render(<MinimalLayerList />);

    const eyeButtons = screen.getAllByRole('button').filter((btn) => btn.innerHTML.includes('svg'));
    expect(eyeButtons.length).toBeGreaterThan(0);

    fireEvent.click(eyeButtons[0]);

    const visibleStates = useAppStore.getState().layers.map((l) => l.visible);
    expect(visibleStates).toEqual([false, false]);
  });

  it('toggles only the clicked layer when it is the sole selection', () => {
    useAppStore.setState({ selectedLayerIds: ['layer-1'] });
    render(<MinimalLayerList />);

    const eyeButtons = screen.getAllByRole('button').filter((btn) => btn.innerHTML.includes('svg'));
    fireEvent.click(eyeButtons[0]);

    const layers = useAppStore.getState().layers;
    expect(layers.find((l) => l.id === 'layer-1')?.visible).toBe(false);
    expect(layers.find((l) => l.id === 'layer-2')?.visible).toBe(true);
  });
});
