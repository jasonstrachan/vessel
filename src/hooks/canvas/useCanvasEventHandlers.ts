import { useCallback, useRef, type FocusEvent } from 'react';
import type {
  ContourLinesState,
  EventHandlerDependencies,
  EventHandlerDynamicDeps,
  EventHandlers,
  Lines2DefaultsCache,
} from './utils/types';
import { createPointerHandlers, createDefaultContourLinesState } from './handlers/pointerHandlers';

/**
 * Main orchestrator hook for canvas event handlers
 * Consolidates all event handling logic into modular, testable functions
 */
type EventHandlerDependenciesInput = Omit<
  EventHandlerDependencies,
  | 'contourLinesStateRef'
  | 'contourLinesDefaultsCacheRef'
  | 'contourLinesFinalizingRef'
  | 'dynamicDepsRef'
  | 'project'
  | 'canvas'
  | 'tools'
  | 'layers'
  | 'activeLayerId'
  | 'selectionStart'
  | 'selectionEnd'
  | 'floatingPaste'
> & {
  project: EventHandlerDynamicDeps['project'];
  canvas: EventHandlerDynamicDeps['canvas'];
  tools: EventHandlerDynamicDeps['tools'];
  layers: EventHandlerDynamicDeps['layers'];
  activeLayerId: EventHandlerDynamicDeps['activeLayerId'];
  selectionStart: EventHandlerDynamicDeps['selectionStart'];
  selectionEnd: EventHandlerDynamicDeps['selectionEnd'];
  floatingPaste: EventHandlerDynamicDeps['floatingPaste'];
  isDraggingFloatingPaste: EventHandlerDynamicDeps['isDraggingFloatingPaste'];
};

export const useCanvasEventHandlers = (deps: EventHandlerDependenciesInput): EventHandlers => {
  const {
    project,
    canvas,
    tools,
    layers,
    activeLayerId,
    selectionStart,
    selectionEnd,
    floatingPaste,
    isDraggingFloatingPaste,
    ...staticDeps
  } = deps;
  // Persistent refs for angle snapping across re-renders
  const snapStrokeStartRef = useRef<{ x: number; y: number } | null>(null);
  const snapShiftAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const snapLastBrushSampleRef = useRef<{ x: number; y: number } | null>(null);

  const contourLinesStateRef = useRef<ContourLinesState>(createDefaultContourLinesState());
  const contourLinesDefaultsCacheRef = useRef<Lines2DefaultsCache | null>(null);
  const contourLinesFinalizingRef = useRef<boolean>(false);

  const dynamicDepsRef = useRef<EventHandlerDynamicDeps>({
    project,
    canvas,
    tools,
    layers,
    activeLayerId,
    selectionStart,
    selectionEnd,
    floatingPaste,
    isDraggingFloatingPaste,
  });

  dynamicDepsRef.current = {
    project,
    canvas,
    tools,
    layers,
    activeLayerId,
    selectionStart,
    selectionEnd,
    floatingPaste,
    isDraggingFloatingPaste,
  };

  const augmentedDeps = {
    ...staticDeps,
    snapStrokeStartRef,
    snapShiftAnchorRef,
    snapLastBrushSampleRef,
    contourLinesStateRef,
    contourLinesDefaultsCacheRef,
    contourLinesFinalizingRef,
    dynamicDepsRef,
  } as EventHandlerDependencies;

  Object.defineProperties(augmentedDeps, {
    project: {
      get: () => dynamicDepsRef.current.project,
    },
    canvas: {
      get: () => dynamicDepsRef.current.canvas,
    },
    tools: {
      get: () => dynamicDepsRef.current.tools,
    },
    layers: {
      get: () => dynamicDepsRef.current.layers,
    },
    activeLayerId: {
      get: () => dynamicDepsRef.current.activeLayerId,
    },
    selectionStart: {
      get: () => dynamicDepsRef.current.selectionStart,
    },
    selectionEnd: {
      get: () => dynamicDepsRef.current.selectionEnd,
    },
    floatingPaste: {
      get: () => dynamicDepsRef.current.floatingPaste,
    },
    isDraggingFloatingPaste: {
      get: () => dynamicDepsRef.current.isDraggingFloatingPaste,
    },
  });
  // Create pointer event handlers
  const pointerHandlers = createPointerHandlers(augmentedDeps);
  
  // Keyboard handlers (to be extracted)
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    void event;
    // TODO: Extract keyboard handler logic from DrawingCanvas
  }, []);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    void event;
    // TODO: Extract keyboard handler logic from DrawingCanvas
  }, []);

  const handleBlur = useCallback((event: FocusEvent) => {
    void event;
    // TODO: Extract blur handler logic from DrawingCanvas
  }, []);

  // Wheel handlers (to be extracted)
  const handleWheel = useCallback((event: WheelEvent) => {
    void event;
    // TODO: Extract wheel handler logic from DrawingCanvas
  }, []);

  // Clipboard handlers (to be extracted)
  const handlePaste = useCallback(async (event: ClipboardEvent) => {
    void event;
    // TODO: Extract paste handler logic from DrawingCanvas
  }, []);
  
  return {
    // Pointer handlers
    ...pointerHandlers,
    
    // Keyboard handlers
    handleKeyDown,
    handleKeyUp,
    handleBlur,
    
    // Wheel handlers
    handleWheel,
    
    // Clipboard handlers
    handlePaste,
  };
};
