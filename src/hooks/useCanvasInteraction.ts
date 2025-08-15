import { useReducer, useRef } from 'react';

// Interaction state types
export interface InteractionState {
  isPanning: boolean;
  isDrawing: boolean;
  isSelecting: boolean;
  isSpacePressed: boolean;
  panStart: { x: number; y: number };
  drawingMode: 'idle' | 'drawing' | 'definingLength' | 'definingWidth';
}

// Action types
export type InteractionAction =
  | { type: 'PAN_START'; payload: { x: number; y: number } }
  | { type: 'PAN_END' }
  | { type: 'DRAWING_START'; mode?: 'drawing' | 'definingLength' }
  | { type: 'DRAWING_END' }
  | { type: 'DRAWING_MODE_CHANGE'; mode: InteractionState['drawingMode'] }
  | { type: 'SELECTION_START' }
  | { type: 'SELECTION_END' }
  | { type: 'SPACE_PRESSED' }
  | { type: 'SPACE_RELEASED' }
  | { type: 'RESET' };

// Initial state
const initialState: InteractionState = {
  isPanning: false,
  isDrawing: false,
  isSelecting: false,
  isSpacePressed: false,
  panStart: { x: 0, y: 0 },
  drawingMode: 'idle',
};

// Reducer function
function interactionReducer(state: InteractionState, action: InteractionAction): InteractionState {
  switch (action.type) {
    case 'PAN_START':
      return { ...state, isPanning: true, panStart: action.payload };
    
    case 'PAN_END':
      return { ...state, isPanning: false };
    
    case 'DRAWING_START':
      return { 
        ...state, 
        isDrawing: true, 
        drawingMode: action.mode || 'drawing' 
      };
    
    case 'DRAWING_END':
      return { ...state, isDrawing: false, drawingMode: 'idle' };
    
    case 'DRAWING_MODE_CHANGE':
      return { ...state, drawingMode: action.mode };
    
    case 'SELECTION_START':
      return { ...state, isSelecting: true };
    
    case 'SELECTION_END':
      return { ...state, isSelecting: false };
    
    case 'SPACE_PRESSED':
      return { ...state, isSpacePressed: true };
    
    case 'SPACE_RELEASED':
      return { ...state, isSpacePressed: false };
    
    case 'RESET':
      return initialState;
    
    default:
      return state;
  }
}

// Custom hook for canvas interaction state
export function useCanvasInteraction() {
  const [state, dispatch] = useReducer(interactionReducer, initialState);
  
  // Keep refs for immediate access in event handlers
  const stateRef = useRef(state);
  stateRef.current = state;
  
  // Animation frame refs
  const panAnimationFrameRef = useRef<number | null>(null);
  const drawAnimationFrameRef = useRef<number | null>(null);
  
  // Helper refs for panning
  const panStartOffsetRef = useRef({ x: 0, y: 0 });
  
  // Drawing refs
  const lastDrawPosRef = useRef<{ x: number; y: number } | null>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingCanvasHasContent = useRef(false);
  const isCapturing = useRef(false);
  
  // Selection refs
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  
  return {
    state,
    dispatch,
    stateRef,
    refs: {
      panAnimationFrame: panAnimationFrameRef,
      drawAnimationFrame: drawAnimationFrameRef,
      panStartOffset: panStartOffsetRef,
      lastDrawPos: lastDrawPosRef,
      drawingCanvas: drawingCanvasRef,
      drawingCanvasHasContent,
      isCapturing,
      selectionStart: selectionStartRef,
    },
  };
}