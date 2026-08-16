import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TxtShapeOverlay } from '@/components/canvas/TxtShapeOverlay';
import { txtShapeBrushPreset } from '@/presets/brushPresets';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, type Project } from '@/types';

const initialState = useAppStore.getState();

const createProject = (): Project => ({
  id: 'txt-project',
  name: 'TXT Project',
  width: 200,
  height: 100,
  layers: [],
  layerGroups: [],
  backgroundColor: 'transparent',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  customBrushes: [],
  txtShapes: [],
});

describe('TxtShapeOverlay', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      value: MouseEvent,
    });
    useAppStore.setState(initialState, true);
    const state = useAppStore.getState();
    useAppStore.setState({
      project: createProject(),
      currentBrushPreset: txtShapeBrushPreset,
      palette: {
        ...state.palette,
        foregroundColor: '#101010',
        backgroundColor: '#f0f0f0',
      },
      tools: {
        ...state.tools,
        currentTool: 'brush',
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: BrushShape.TXT_SHAPE,
          size: 20,
          txtContent: 'PORTRAIT',
          txtFontFamily: 'monospace',
          txtTextAlign: 'left',
          txtColorSource: 'palette',
        },
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: jest.fn(),
    });
  });

  afterAll(() => {
    useAppStore.setState(initialState, true);
  });

  it('creates a semantic text box with its complete initial selection as canonical state', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 100;
    const canvasRef = { current: canvas };
    render(<TxtShapeOverlay canvasRef={canvasRef} zoom={1} offsetX={0} offsetY={0} />);

    const overlay = screen.getByTestId('txt-shape-overlay');
    jest.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(overlay, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 110, clientY: 60 });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 110, clientY: 60 });

    const shape = useAppStore.getState().project?.txtShapes?.[0];
    expect(shape).toEqual(expect.objectContaining({
      x: 10,
      y: 10,
      height: 50,
      content: 'PORTRAIT',
      color: '#101010',
      selectionColor: '#101010',
      selectionBackgroundColor: '#f0f0f0',
      selections: [{ start: 0, end: 8 }],
    }));
    expect(shape?.width).toBeCloseTo(100);
    expect(screen.getByRole('textbox', { name: 'TXT Shape text' })).toHaveTextContent('PORTRAIT');
  });

  it('treats a background click as deselection rather than creating a tiny box', () => {
    const canvasRef = { current: document.createElement('canvas') };
    render(<TxtShapeOverlay canvasRef={canvasRef} zoom={1} offsetX={0} offsetY={0} />);
    const overlay = screen.getByTestId('txt-shape-overlay');
    jest.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(overlay, { pointerId: 2, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(overlay, { pointerId: 2, clientX: 20, clientY: 20 });

    expect(useAppStore.getState().project?.txtShapes).toEqual([]);
  });

  it('loads an existing box into the controls without overwriting its document state', async () => {
    const existing = {
      id: 'txt-existing',
      x: 10,
      y: 10,
      width: 100,
      height: 50,
      content: 'EXISTING TEXT',
      fontFamily: 'serif' as const,
      fontSize: 31,
      lineHeight: 1.2,
      textAlign: 'right' as const,
      colorSource: 'manual' as const,
      color: '#123456',
      selectionColor: '#abcdef',
      selectionBackgroundColor: '#654321',
      selections: [{ start: 0, end: 8 }],
      createdAt: 1,
      updatedAt: 1,
    };
    useAppStore.setState((state) => ({
      project: state.project ? { ...state.project, txtShapes: [existing] } : null,
    }));
    const canvasRef = { current: document.createElement('canvas') };
    render(<TxtShapeOverlay canvasRef={canvasRef} zoom={1} offsetX={0} offsetY={0} />);

    fireEvent.pointerDown(document.querySelector('[data-txt-shape-id="txt-existing"]')!);

    await waitFor(() => {
      expect(useAppStore.getState().tools.brushSettings).toEqual(expect.objectContaining({
        txtContent: 'EXISTING TEXT',
        txtFontFamily: 'serif',
        size: 31,
      }));
      expect(useAppStore.getState().project?.txtShapes?.[0]).toEqual(existing);
    });
  });
});
