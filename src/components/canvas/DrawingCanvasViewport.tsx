import type React from 'react';
import type { Tool } from '@/types';
import BrushCursor, { type BrushCursorHandle } from './BrushCursor';
import { DrawingCanvasOverlays } from './DrawingCanvasOverlays';
import type { BrushCursorDescriptor } from './useDrawingCanvasCursorModel';
import { useVesselMultiplayerSnapshot } from '@/collaboration/vesselMultiplayerSession';

export interface DrawingCanvasViewportProps {
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onBlur: (event: React.FocusEvent) => void;
  onPointerDown: (event: React.PointerEvent<Element>) => void;
  onPointerUp: (event: React.PointerEvent<Element>) => void;
  onPointerMove: (event: React.PointerEvent<Element>) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onPointerCancel: (event: React.PointerEvent<Element>) => void;
  onDoubleClick: (event: React.MouseEvent<Element>) => void;
  canvasStyle: React.CSSProperties;
  overlayCanvasStyle: React.CSSProperties;
  viewportStyle: React.CSSProperties;
  cursorStyle: string;
  project: { width: number; height: number } | null;
  floatingPaste: unknown;
  canvasZoom: number;
  offsetX: number;
  offsetY: number;
  currentTool: Tool;
  isSpacePressed: boolean;
  displayProjectName: string;
  sampleColorAtPosition: (x: number, y: number) => string;
  brushCursorHandleRef: React.RefObject<BrushCursorHandle | null>;
  cursorDescriptor: BrushCursorDescriptor;
  brushCursorVisible: boolean;
}

export const DrawingCanvasViewport = ({
  wrapperRef,
  canvasRef,
  overlayCanvasRef,
  onBlur,
  onPointerDown,
  onPointerUp,
  onPointerMove,
  onPointerEnter,
  onPointerLeave,
  onPointerCancel,
  onDoubleClick,
  canvasStyle,
  overlayCanvasStyle,
  viewportStyle,
  cursorStyle,
  project,
  floatingPaste,
  canvasZoom,
  offsetX,
  offsetY,
  currentTool,
  isSpacePressed,
  displayProjectName,
  sampleColorAtPosition,
  brushCursorHandleRef,
  cursorDescriptor,
  brushCursorVisible,
}: DrawingCanvasViewportProps) => {
  const multiplayer = useVesselMultiplayerSnapshot();
  const showParticipantCursor = multiplayer.status === 'active' || multiplayer.status === 'stopping';

  return (
  <div
    ref={wrapperRef}
    className="w-full h-full relative"
    style={{
      ...viewportStyle,
      overflow: 'hidden',
      cursor: cursorStyle,
      outline: 'none',
      boxShadow: 'none'
    }}
    tabIndex={0}
    role="region"
    aria-label="Drawing canvas workspace"
    onBlur={onBlur}
    onPointerDown={onPointerDown}
    onPointerUp={onPointerUp}
    onPointerMove={onPointerMove}
    onPointerEnter={onPointerEnter}
    onPointerLeave={onPointerLeave}
    onPointerCancel={onPointerCancel}
    onDoubleClick={onDoubleClick}
  >
    <canvas
      ref={canvasRef}
      onContextMenu={(event) => event.preventDefault()}
      tabIndex={-1}
      aria-label="Drawing surface"
      style={canvasStyle}
    />

    <canvas
      ref={overlayCanvasRef}
      style={overlayCanvasStyle}
    />

    <DrawingCanvasOverlays
      canvasRef={canvasRef}
      project={project}
      floatingPaste={floatingPaste}
      canvasZoom={canvasZoom || 1}
      offsetX={offsetX}
      offsetY={offsetY}
      currentTool={currentTool}
      isSpacePressed={isSpacePressed}
      displayProjectName={displayProjectName}
      sampleColorAtPosition={sampleColorAtPosition}
    />

    <BrushCursor
      ref={brushCursorHandleRef}
      descriptor={cursorDescriptor}
      zoom={canvasZoom || 1}
      visible={brushCursorVisible}
      participant={showParticipantCursor ? { label: 'JASON', color: '#52e5ff' } : undefined}
    />
  </div>
  );
};
