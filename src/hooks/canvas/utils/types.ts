import type React from 'react';
import type { BrushSettings, Project, Layer } from '../../../types';
import type { InteractionAction, InteractionState } from '../../useCanvasInteraction';
import type { CanvasStateMachine } from '@/hooks/useCanvasStateMachine';
import type { DrawingHandlers } from '@/hooks/useDrawingHandlers';
import type { SimplePan } from '@/hooks/useSimplePan';
import type { ToolStateMachine } from '@/hooks/useToolStateMachine';
import type { BrushEngine } from '@/hooks/useBrushEngineSimplified';

// Type definitions for dependencies (avoiding circular imports)
export interface FloatingPaste {
  active: boolean;
  imageData: ImageData | null;
  position: { x: number; y: number };
  originalPosition: { x: number; y: number };
  width: number;
  height: number;
  sourceLayerId?: string | null;
}

export interface CanvasState {
  width: number;
  height: number;
  scale: number;
  zoom: number;
}

export interface ToolsState {
  currentTool: string;
  brushSettings: BrushSettings;
  fillSettings: {
    threshold: number;
    contiguous: boolean;
  };
  eraserSettings?: {
    opacity?: number;
  };
  shapeMode: boolean;
}

export interface EventHandlerDependencies {
  // Canvas refs
  canvasRef: React.RefObject<HTMLCanvasElement>;
  wrapperRef: React.RefObject<HTMLDivElement>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement>;
  compositeCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  
  // State refs
  isBusyRef: React.MutableRefObject<boolean>;
  isMouseDownRef: React.MutableRefObject<boolean>;
  isSpacePressedRef: React.MutableRefObject<boolean>;
  drawAnimationFrameRef: React.MutableRefObject<number | null>;
  pointerMoveThrottled: React.MutableRefObject<number>;
  
  // Store state
  project: Project | null;
  canvas: CanvasState | null;
  tools: ToolsState;
  layers: Layer[];
  activeLayerId: string | null;
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
  floatingPaste: FloatingPaste | null;
  
  // Store actions
  setSelectionBounds: (start: { x: number; y: number }, end: { x: number; y: number }) => void;
  clearSelection: () => void;
  setCurrentTool: (tool: string) => void;
  setCurrentOffscreenCanvas: (canvas: HTMLCanvasElement | null) => void;
  compositeLayersToCanvas: (canvas: HTMLCanvasElement) => void;
  saveCanvasState: (canvas: HTMLCanvasElement, tool: string, action: string) => void;
  updateLayer: (layerId: string, updates: Partial<Layer>) => void;
  
  // Floating paste actions
  setFloatingPaste: (paste: FloatingPaste | null) => void;
  updateFloatingPastePosition: (x: number, y: number) => void;
  commitFloatingPaste: () => Promise<void>;
  cancelFloatingPaste: () => void;
  
  // Drawing state
  isDraggingFloatingPaste: boolean;
  setIsDraggingFloatingPaste: React.Dispatch<React.SetStateAction<boolean>>;
  floatingPasteDragStart: React.MutableRefObject<{ x: number; y: number } | null>;
  floatingPasteOriginalPos: React.MutableRefObject<{ x: number; y: number } | null>;
  
  // Cursor state
  setCursorStyle: React.Dispatch<React.SetStateAction<string>>;
  setShowBrushCursor: React.Dispatch<React.SetStateAction<boolean>>;
  setMousePosition: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  
  // Hooks
  interaction: {
    state: InteractionState;
    dispatch: React.Dispatch<InteractionAction>;
    refs: {
      selectionStart: React.MutableRefObject<{ x: number; y: number } | null>;
      drawAnimationFrame: React.MutableRefObject<number | null>;
      lastDrawPos: React.MutableRefObject<{ x: number; y: number } | null>;
      drawingCanvas: React.MutableRefObject<HTMLCanvasElement | null>;
      drawingCanvasHasContent: React.MutableRefObject<boolean>;
      isCapturing: React.MutableRefObject<boolean>;
    };
  };
  stateMachine: CanvasStateMachine;
  pan: SimplePan;
  toolStateMachine: ToolStateMachine;
  drawingHandlers: DrawingHandlers;
  brushEngine: BrushEngine | null;
  
  // Helper functions
  sampleColorAtPosition: (x: number, y: number) => string;
  sampleColorsAlongLine: (startX: number, startY: number, endX: number, endY: number, numSamples: number) => string[];
  getMousePos: (
    event: React.MouseEvent<Element> | React.PointerEvent<Element> | React.WheelEvent<Element>
  ) => { x: number; y: number };
  
  // Drawing state management
  compositeCanvasDirtyRef: React.MutableRefObject<boolean>;
  setNeedsRedraw: React.Dispatch<React.SetStateAction<number>>;
  
  // View transform and drawing functions
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  draw: (ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }) => void;
  drawingAnimationFrameRef: React.MutableRefObject<number | null>;
  previewAnimationFrameRef?: React.MutableRefObject<number | null>;
  
  // Optional cursor style defaults
  defaultCursorStyle?: string;
  restartColorCycleAnimation?: () => void;

  // Optional feedback hook for surfacing errors/warnings
  feedback?: (message: string) => void;

  // Angle snap refs (persist across re-renders for brush/shape snapping)
  snapStrokeStartRef?: React.MutableRefObject<{ x: number; y: number } | null>;
  snapShiftAnchorRef?: React.MutableRefObject<{ x: number; y: number } | null>;
  snapLastBrushSampleRef?: React.MutableRefObject<{ x: number; y: number } | null>;
}

export interface PointerHandlers {
  handlePointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerEnter: () => void;
  handlePointerLeave: () => void;
  handlePointerCancel: (event: React.PointerEvent<HTMLCanvasElement>) => void;
}

export interface KeyboardHandlers {
  handleKeyDown: (event: KeyboardEvent) => void;
  handleKeyUp: (event: KeyboardEvent) => void;
  handleBlur: (event: React.FocusEvent) => void;
}

export interface WheelHandlers {
  handleWheel: (event: WheelEvent) => void;
}

export interface ClipboardHandlers {
  handlePaste: (event: ClipboardEvent) => Promise<void>;
}

export interface EventHandlers extends PointerHandlers, KeyboardHandlers, WheelHandlers, ClipboardHandlers {}
