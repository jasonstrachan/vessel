import { useReducer, useRef } from 'react';

// Interaction state types
export interface InteractionState {
  isDrawing: boolean;
  isSelecting: boolean;
  drawingMode: 'idle' | 'drawing' | 'definingLength' | 'definingWidth';
}

// Action types
export type InteractionAction =
  | { type: 'DRAWING_START'; mode?: 'drawing' | 'definingLength'; pressure?: number }
  | { type: 'DRAWING_END' }
  | { type: 'DRAWING_MODE_CHANGE'; mode: InteractionState['drawingMode'] }
  | { type: 'SELECTION_START' }
  | { type: 'SELECTION_END' }
  | { type: 'RESET' };

// Initial state
const initialState: InteractionState = {
  isDrawing: false,
  isSelecting: false,
  drawingMode: 'idle',
};

// Reducer function
function interactionReducer(state: InteractionState, action: InteractionAction): InteractionState {
  switch (action.type) {
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
  const drawAnimationFrameRef = useRef<number | null>(null);
  
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
      drawAnimationFrame: drawAnimationFrameRef,
      lastDrawPos: lastDrawPosRef,
      drawingCanvas: drawingCanvasRef,
      drawingCanvasHasContent,
      isCapturing,
      selectionStart: selectionStartRef,
    },
  };
}