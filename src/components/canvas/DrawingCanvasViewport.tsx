import type React from 'react';
import type { BrushShape, Tool } from '@/types';
import BrushCursor, { type BrushCursorHandle } from './BrushCursor';
import { DrawingCanvasOverlays } from './DrawingCanvasOverlays';

export interface DrawingCanvasViewportProps {
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onBlur: (event: React.FocusEvent) => void;
  onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onPointerCancel: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  canvasStyle: React.CSSProperties;
  overlayCanvasStyle: React.CSSProperties;
  cursorStyle: string;
  project: { width: number; height: number } | null;
  floatingPaste: unknown;
  canvasZoom: number;
  offsetX: number;
  offsetY: number;
  currentTool: Tool;
  isSpacePressed: boolean;
  displayProjectName: string;
  brushCursorHandleRef: React.RefObject<BrushCursorHandle | null>;
  cursorSize: number;
  brushShapeForCursor: BrushShape;
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
  canvasStyle,
  overlayCanvasStyle,
  cursorStyle,
  project,
  floatingPaste,
  canvasZoom,
  offsetX,
  offsetY,
  currentTool,
  isSpacePressed,
  displayProjectName,
  brushCursorHandleRef,
  cursorSize,
  brushShapeForCursor,
  brushCursorVisible,
}: DrawingCanvasViewportProps) => (
  <div
    ref={wrapperRef}
    className="w-full h-full relative"
    style={{
      overflow: 'hidden',
      cursor: cursorStyle,
      outline: 'none',
      boxShadow: 'none'
    }}
    tabIndex={0}
    role="region"
    aria-label="Drawing canvas workspace"
    onBlur={onBlur}
  >
    <canvas
      ref={canvasRef}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerMove={onPointerMove}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerCancel={onPointerCancel}
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
      project={project}
      floatingPaste={floatingPaste}
      canvasZoom={canvasZoom || 1}
      offsetX={offsetX}
      offsetY={offsetY}
      currentTool={currentTool}
      isSpacePressed={isSpacePressed}
      displayProjectName={displayProjectName}
    />

    <BrushCursor
      ref={brushCursorHandleRef}
      size={cursorSize}
      brushShape={brushShapeForCursor}
      zoom={canvasZoom || 1}
      visible={brushCursorVisible}
    />
  </div>
);
