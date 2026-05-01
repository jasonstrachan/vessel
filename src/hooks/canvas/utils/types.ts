import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { BrushSettings, PaletteState, PolygonGradientState, Project, Layer } from '../../../types';
import type { InteractionAction, InteractionState } from '../../useCanvasInteraction';
import type { CanvasStateMachine } from '@/hooks/useCanvasStateMachine';
import type { DrawingHandlers } from '@/hooks/useDrawingHandlers';
import type { SimplePan } from '@/hooks/useSimplePan';
import type { ToolStateMachine } from '@/hooks/useToolStateMachine';
import type { BrushEngine } from '@/hooks/useBrushEngineSimplified';
import type { TransferredColorCycleGradientDef } from '@/stores/helpers/colorCycleGradientDefTransfer';
import type { TransferredColorCycleSlotPalette } from '@/stores/helpers/colorCycleGradientDefTransfer';
import type {
  computeLines2Defaults,
  prepareContourLinesBasis,
} from '@/utils/contourLines';

// Type definitions for dependencies (avoiding circular imports)
export interface FloatingPaste {
  active: boolean;
  imageData: ImageData | null;
  position: { x: number; y: number };
  originalPosition: { x: number; y: number };
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  rotation: number;
  sourceLayerId?: string | null;
  colorCycleIndices?: Uint8Array | null;
  colorCycleGradientIds?: Uint8Array | null;
  colorCycleSlotPalettes?: TransferredColorCycleSlotPalette[] | null;
  colorCycleGradientDefIds?: Uint16Array | null;
  colorCycleGradientDefs?: TransferredColorCycleGradientDef[] | null;
  colorCycleSpeed?: Uint8Array | null;
  colorCycleFlow?: Uint8Array | null;
  colorCyclePhase?: Uint8Array | null;
}

export interface CanvasState {
  width: number;
  height: number;
  scale: number;
  zoom: number;
}

export type RecolorSamplingState = AppState['recolorSampling'];
export type RectangleBrushState = AppState['rectangleBrushState'];
type CustomBrushCaptureState = AppState['tools']['customBrushCapture'];

export interface ToolsState {
  currentTool: string;
  selectionMode: AppState['tools']['selectionMode'];
  brushSettings: BrushSettings;
  fillSettings: {
    threshold: number;
    contiguous: boolean;
    eraseInstead: boolean;
  };
  wandSettings: {
    threshold: number;
    contiguous: boolean;
  };
  eraserSettings?: {
    opacity?: number;
  };
  shapeMode: boolean;
  customBrushCapture: CustomBrushCaptureState;
}

export type ContourLinesStage =
  | 'idle'
  | 'awaitingAnchorA'
  | 'awaitingAngle'
  | 'awaitingConvergenceA'
  | 'awaitingConvergenceB';

export type ContourLinesBasis = ReturnType<typeof prepareContourLinesBasis> | null;

export interface ContourLinesState {
  stage: ContourLinesStage;
  shapePoints: Array<{ x: number; y: number }>;
  fillColor?: string;
  sessionId?: number | null;
  basis?: ContourLinesBasis;
  spacingA?: number | null;
  spacingB?: number | null;
  previewSpacing?: number | null;
  variant?: 'legacy' | 'lines2';
  lineAngle?: number | null;
  convergenceA?: { x: number; y: number } | null;
  convergenceB?: { x: number; y: number } | null;
  centroid?: { x: number; y: number } | null;
  spacingReferenceDistance?: number | null;
  spacingReferenceSpacing?: number | null;
  randomSeed?: number | null;
}

export interface Lines2DefaultsCache {
  key: string;
  defaults: ReturnType<typeof computeLines2Defaults>;
}

export interface SelectionPathSession {
  active: boolean;
  points: Array<{ x: number; y: number }>;
}

export interface SelectionRuntimeState {
  pendingSelectionHistory: {
    before: import('@/history/selectionState').SelectionSnapshot;
    description: string;
    meta?: Record<string, unknown>;
  } | null;
  freehandSession: SelectionPathSession;
  clickLineSession: SelectionPathSession;
  marqueeAutoPan: {
    frameId: number | null;
    screenPos: { x: number; y: number } | null;
  };
}

export interface CustomFreehandCaptureRuntimeState {
  active: boolean;
  pointerId: number | null;
  points: Array<{ x: number; y: number }>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

export interface EventHandlerDynamicDeps {
  project: Project | null;
  canvas: CanvasState | null;
  tools: ToolsState;
  layers: Layer[];
  activeLayerId: string | null;
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
  selectionMask: ImageData | null;
  selectionMaskBounds: { x: number; y: number; width: number; height: number } | null;
  floatingPaste: FloatingPaste | null;
  isDraggingFloatingPaste: boolean;
  palette: PaletteState;
  polygonGradientState: PolygonGradientState;
  recolorSampling: RecolorSamplingState;
  currentBrushPresetId: string | null;
}

export interface EventHandlerDependencies {
  // Canvas refs
  canvasRef: React.RefObject<HTMLCanvasElement>;
  wrapperRef: React.RefObject<HTMLDivElement>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement>;
  compositeCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  dynamicDepsRef: React.MutableRefObject<EventHandlerDynamicDeps>;
  
  // State refs
  isBusyRef: React.MutableRefObject<boolean>;
  isMouseDownRef: React.MutableRefObject<boolean>;
  isSpacePressedRef: React.MutableRefObject<boolean>;
  suppressBootstrapUntilPointerUpRef: React.MutableRefObject<boolean>;
  mousePositionRef?: React.MutableRefObject<{ x: number; y: number }>;
  isZoomingRef?: React.MutableRefObject<boolean>;
  zoomEndTimeoutRef?: React.MutableRefObject<number | null>;
  drawAnimationFrameRef: React.MutableRefObject<number | null>;
  pointerMoveThrottled: React.MutableRefObject<number>;
  
  // Store state snapshot (access via dynamicDepsRef)
  project: Project | null;
  canvas: CanvasState | null;
  tools: ToolsState;
  layers: Layer[];
  activeLayerId: string | null;
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
  selectionMask: ImageData | null;
  selectionMaskBounds: { x: number; y: number; width: number; height: number } | null;
  floatingPaste: FloatingPaste | null;
  isDraggingFloatingPaste: boolean;
  palette: PaletteState;
  polygonGradientState: PolygonGradientState;
  recolorSampling: RecolorSamplingState;
  currentBrushPresetId: string | null;

  // Store actions
  setSelectionBounds: (start: { x: number; y: number }, end: { x: number; y: number }, source?: string) => void;
  clearSelection: () => void;
  setCurrentTool: (tool: string) => void;
  setActiveColor: (color: string) => void;
  setCurrentOffscreenCanvas: (canvas: HTMLCanvasElement | null) => void;
  compositeLayersToCanvas: (canvas: HTMLCanvasElement) => void;
  updateLayer: (layerId: string, updates: Partial<Layer>, options?: { skipColorCycleSync?: boolean }) => void;
  setBrushSettings: (settings: Partial<BrushSettings>) => void;
  updateRecolorSampling: (partial: Partial<RecolorSamplingState>) => void;
  stopRecolorSampling: () => void;
  setRectangleBrushState: (partial: Partial<RectangleBrushState>) => void;
  setCustomBrushFreehandPath: (payload: CustomBrushCaptureState['freehandPath'] | null) => void;
  extractSelectionToFloatingPaste: () => boolean;
  
  // Floating paste actions
  setFloatingPaste: (paste: FloatingPaste | null) => void;
  updateFloatingPastePosition: (x: number, y: number) => void;
  commitFloatingPaste: () => Promise<void>;
  cancelFloatingPaste: () => void;
  
  // Drawing state
  setIsDraggingFloatingPaste: React.Dispatch<React.SetStateAction<boolean>>;
  floatingPasteDragStart: React.MutableRefObject<{ x: number; y: number } | null>;
  floatingPasteOriginalPos: React.MutableRefObject<{ x: number; y: number } | null>;
  
  // Cursor state
  setCursorStyle: React.Dispatch<React.SetStateAction<string>>;
  setShowBrushCursor: React.Dispatch<React.SetStateAction<boolean>>;
  setCursorPosition: (screenX: number, screenY: number) => void;
  isPointerInsideCanvas?: () => boolean;
  
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
  setLayersNeedRecomposition?: (needs: boolean) => void;
  
  // View transform and drawing functions
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  draw: (ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }) => void;
  setZoom?: (zoom: number) => void;
  setPan?: (offsetX: number, offsetY: number, options?: { silent?: boolean }) => void;
  drawingAnimationFrameRef: React.MutableRefObject<number | null>;
  previewAnimationFrameRef?: React.MutableRefObject<number | null>;
  
  // Optional cursor style defaults
  defaultCursorStyle?: string;
  restartColorCycleAnimation?: () => void;
  pauseAnimationForPan?: () => void;
  resumeAnimationAfterPan?: () => Promise<void> | void;

  // Optional feedback hook for surfacing errors/warnings
  feedback?: (message: string) => void;
  selectionClipboardRef?: React.MutableRefObject<AppState['selectionClipboard']>;
  getViewportPastePosition?: (contentWidth: number, contentHeight: number) => { x: number; y: number } | null;

  // Preview session coordination
  previewSessionIdRef: React.MutableRefObject<number>;
  newPreviewSession: () => number;
  isCurrentPreviewSession: (sessionId: number) => boolean;

  // Angle snap refs (persist across re-renders for brush/shape snapping)
  snapStrokeStartRef?: React.MutableRefObject<{ x: number; y: number } | null>;
  snapShiftAnchorRef?: React.MutableRefObject<{ x: number; y: number } | null>;
  snapLastBrushSampleRef?: React.MutableRefObject<{ x: number; y: number } | null>;

  // Contour-lines state (persist across renders)
  contourLinesStateRef: React.MutableRefObject<ContourLinesState>;
  contourLinesDefaultsCacheRef: React.MutableRefObject<Lines2DefaultsCache | null>;
  contourLinesFinalizingRef: React.MutableRefObject<boolean>;
  selectionRuntimeRef: React.MutableRefObject<SelectionRuntimeState>;
  customFreehandCaptureRuntimeRef: React.MutableRefObject<CustomFreehandCaptureRuntimeState>;
}

// Canonical dependency contract for handler modules (alias to avoid churn).
export type HandlerDeps = EventHandlerDependencies;

export interface PointerHandlers {
  handlePointerDown: (event: React.PointerEvent<Element>) => void;
  handlePointerMove: (event: React.PointerEvent<Element>) => void;
  handlePointerUp: (event: React.PointerEvent<Element>) => void;
  handlePointerEnter: () => void;
  handlePointerLeave: () => void;
  handlePointerCancel: (event: React.PointerEvent<Element>) => void;
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
