import type React from 'react';
import type { Tool } from '@/types';
import BrushCursor, { type BrushCursorHandle } from './BrushCursor';
import { DrawingCanvasOverlays } from './DrawingCanvasOverlays';
import type { BrushCursorDescriptor } from './useDrawingCanvasCursorModel';

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
  cursorDescriptor,
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
    onPointerDown={onPointerDown}
    onPointerUp={onPointerUp}
    onPointerMove={onPointerMove}
    onPointerEnter={onPointerEnter}
    onPointerLeave={onPointerLeave}
    onPointerCancel={onPointerCancel}
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
      descriptor={cursorDescriptor}
      zoom={canvasZoom || 1}
      visible={brushCursorVisible}
    />
  </div>
);
