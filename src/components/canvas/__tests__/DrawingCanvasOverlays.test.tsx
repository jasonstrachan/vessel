import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DrawingCanvasOverlays } from '../DrawingCanvasOverlays';

const setZoom = jest.fn();

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      setZoom,
      ui: {
        grid: {
          enabled: false,
          rows: 8,
          columns: 8,
        },
      },
    };

    return selector ? selector(state) : state;
  },
}));

describe('DrawingCanvasOverlays', () => {
  beforeEach(() => {
    setZoom.mockClear();
  });

  it('resets canvas zoom to 100% when the zoom badge is double-clicked', () => {
    render(
      <DrawingCanvasOverlays
        project={null}
        floatingPaste={null}
        canvasZoom={2.5}
        offsetX={0}
        offsetY={0}
        currentTool="brush"
        isSpacePressed={false}
        displayProjectName="Demo"
      />
    );

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Reset canvas zoom to 100%' }));

    expect(setZoom).toHaveBeenCalledWith(1);
  });

  it('keeps zoom badge pointer and click events out of the canvas handlers', () => {
    const handlePointerDown = jest.fn();
    const handleClick = jest.fn();
    const handleDoubleClick = jest.fn();

    render(
      <div
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <DrawingCanvasOverlays
          project={null}
          floatingPaste={null}
          canvasZoom={2.5}
          offsetX={0}
          offsetY={0}
          currentTool="brush"
          isSpacePressed={false}
          displayProjectName="Demo"
        />
      </div>
    );

    const zoomButton = screen.getByRole('button', { name: 'Reset canvas zoom to 100%' });
    fireEvent.pointerDown(zoomButton);
    fireEvent.click(zoomButton);
    fireEvent.doubleClick(zoomButton);

    expect(handlePointerDown).not.toHaveBeenCalled();
    expect(handleClick).not.toHaveBeenCalled();
    expect(handleDoubleClick).not.toHaveBeenCalled();
    expect(setZoom).toHaveBeenCalledWith(1);
  });
});
