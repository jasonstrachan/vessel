import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DrawingCanvasOverlays } from '../DrawingCanvasOverlays';

const setZoom = jest.fn();
const canvasRef = React.createRef<HTMLCanvasElement>();
const stopVesselMultiplayerSession = jest.fn();
let multiplayer = {
  sessionId: null as string | null,
  projectId: null as string | null,
  status: 'idle' as 'idle' | 'active' | 'stopping' | 'stopped' | 'error',
  humanLayerId: null,
  aiLayerId: null,
  activeGestureId: null,
  aiCursor: null as null | { x: number; y: number; visible: boolean; drawing: boolean },
  stopReason: null,
  error: null as string | null,
  bridgeStatus: 'connected' as 'connected' | 'connecting' | 'disconnected',
  aiState: 'watching',
  aiModel: 'test-model' as string | null,
  lastObservationAt: null as number | null,
  bridgeError: null as string | null,
};

jest.mock('@/collaboration/vesselMultiplayerSession', () => ({
  useVesselMultiplayerSnapshot: () => multiplayer,
  stopVesselMultiplayerSession: (...args: unknown[]) => stopVesselMultiplayerSession(...args),
}));

jest.mock('../SelectionMarqueeHandles', () => () => null);
jest.mock('../GridOverlay', () => () => null);
jest.mock('@/extensions/studioExtension', () => ({
  __esModule: true,
  default: {
    brushPresets: [],
    CanvasOverlay: ({ isSpacePressed }: { isSpacePressed: boolean }) => (
      <button
        type="button"
        className="pointer-events-auto"
        aria-label="Studio extension canvas control"
        data-space-pressed={isSpacePressed}
      >
        Extension
      </button>
    ),
  },
}));

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      setZoom,
      canvas: {
        showPixelGridAtMaxZoom: true,
      },
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
    stopVesselMultiplayerSession.mockClear();
    multiplayer = {
      sessionId: null,
      projectId: null,
      status: 'idle',
      humanLayerId: null,
      aiLayerId: null,
      activeGestureId: null,
      aiCursor: null,
      stopReason: null,
      error: null,
      bridgeStatus: 'connected',
      aiState: 'watching',
      aiModel: 'test-model',
      lastObservationAt: null,
      bridgeError: null,
    };
  });

  it('identifies both painters, positions the AI cursor, and exposes an emergency stop', () => {
    multiplayer = {
      ...multiplayer,
      sessionId: 'portrait-together',
      status: 'active',
      aiCursor: { x: 20, y: 30, visible: true, drawing: true },
    };

    render(
      <DrawingCanvasOverlays
        canvasRef={canvasRef}
        project={{ width: 100, height: 100 }}
        floatingPaste={null}
        canvasZoom={2}
        offsetX={5}
        offsetY={7}
        currentTool="brush"
        isSpacePressed={false}
        displayProjectName="Portrait"
      />
    );

    expect(screen.getByTestId('multiplayer-status')).toHaveTextContent('Jason');
    expect(screen.getByTestId('multiplayer-status')).toHaveTextContent('AI');
    expect(screen.getByTestId('multiplayer-ai-cursor')).toHaveStyle({ left: '45px', top: '67px' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop AI multiplayer painting' }));
    expect(stopVesselMultiplayerSession).toHaveBeenCalledWith({
      sessionId: 'portrait-together',
      reason: 'Stopped from the Vessel canvas',
    });
  });

  it('shows a failed session instead of masking it with healthy bridge state', () => {
    multiplayer = {
      ...multiplayer,
      sessionId: 'portrait-together',
      status: 'error',
      error: 'The Vessel project changed during multiplayer painting',
    };

    render(
      <DrawingCanvasOverlays
        canvasRef={canvasRef}
        project={{ width: 100, height: 100 }}
        floatingPaste={null}
        canvasZoom={1}
        offsetX={0}
        offsetY={0}
        currentTool="brush"
        isSpacePressed={false}
        displayProjectName="Portrait"
      />
    );

    expect(screen.getByTestId('multiplayer-status')).toHaveTextContent('error');
    expect(screen.getByTestId('multiplayer-status')).toHaveAttribute(
      'title',
      'The Vessel project changed during multiplayer painting',
    );
  });

  it('resets canvas zoom to 100% when the zoom badge is double-clicked', () => {
    render(
      <DrawingCanvasOverlays
        canvasRef={canvasRef}
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
          canvasRef={canvasRef}
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

  it('keeps studio extension gestures out of the canvas drawing handlers', () => {
    const handlePointerDown = jest.fn();
    const handlePointerMove = jest.fn();
    const handlePointerUp = jest.fn();

    render(
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <DrawingCanvasOverlays
          canvasRef={canvasRef}
          project={{ width: 100, height: 100 }}
          floatingPaste={null}
          canvasZoom={1}
          offsetX={0}
          offsetY={0}
          currentTool="brush"
          isSpacePressed={false}
          displayProjectName="Demo"
        />
      </div>
    );

    const extensionControl = screen.getByRole('button', { name: 'Studio extension canvas control' });
    fireEvent.pointerDown(extensionControl);
    fireEvent.pointerMove(extensionControl);
    fireEvent.pointerUp(extensionControl);

    expect(handlePointerDown).not.toHaveBeenCalled();
    expect(handlePointerMove).not.toHaveBeenCalled();
    expect(handlePointerUp).not.toHaveBeenCalled();
  });

  it('forwards the Space-pan state to the studio extension overlay', () => {
    render(
      <DrawingCanvasOverlays
        canvasRef={canvasRef}
        project={{ width: 100, height: 100 }}
        floatingPaste={null}
        canvasZoom={1}
        offsetX={0}
        offsetY={0}
        currentTool="brush"
        isSpacePressed
        displayProjectName="Demo"
      />
    );

    expect(screen.getByRole('button', {
      name: 'Studio extension canvas control',
    })).toHaveAttribute('data-space-pressed', 'true');
  });
});
