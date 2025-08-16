import { useReducer, useRef, useCallback } from 'react';

// State machine modes
export type CanvasMode = 
  | 'IDLE'           // Default state, ready for any action
  | 'DRAWING'        // Currently drawing
  | 'SELECTING'      // Making a selection
  | 'AWAITING_PAN'   // Spacebar is held, ready to pan on mouse down
  | 'PANNING'        // Actively panning the canvas
  | 'FINALIZING'     // Finalizing a drawing operation
  | 'DRAGGING_PASTE' // Dragging floating paste
  | 'SHAPE_DEFINING' // Defining shape parameters
  | 'BUSY';          // System is busy, block all interactions

// Complete state shape
export interface CanvasState {
  mode: CanvasMode;
  isSpacePressed: boolean;
  isMouseDown: boolean;
  mouseButton: number | null; // 0=left, 1=middle, 2=right
  lastPosition: { x: number; y: number } | null;
  drawingStartPosition: { x: number; y: number } | null;
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
  shapeDefineStart: { x: number; y: number } | null;
  isBusy: boolean; // Lock for async operations
  stroke: Array<{ x: number; y: number }>; // Current stroke being drawn
  history: Array<Array<{ x: number; y: number }>>; // Completed strokes
}

// Initial state
const initialState: CanvasState = {
  mode: 'IDLE',
  isSpacePressed: false,
  isMouseDown: false,
  mouseButton: null,
  lastPosition: null,
  drawingStartPosition: null,
  selectionStart: null,
  selectionEnd: null,
  shapeDefineStart: null,
  isBusy: false,
  stroke: [],
  history: [],
};

// Action types
export type CanvasAction =
  | { type: 'MOUSE_DOWN'; button: number; position: { x: number; y: number }; tool: string }
  | { type: 'MOUSE_UP'; position: { x: number; y: number } }
  | { type: 'MOUSE_MOVE'; position: { x: number; y: number } }
  | { type: 'MOUSE_LEAVE' }
  | { type: 'SPACE_DOWN' }
  | { type: 'SPACE_UP' }
  | { type: 'START_DRAWING'; position: { x: number; y: number } }
  | { type: 'START_SELECTION'; position: { x: number; y: number } }
  | { type: 'START_SHAPE'; position: { x: number; y: number } }
  | { type: 'START_PASTE_DRAG'; position: { x: number; y: number } }
  | { type: 'END_INTERACTION' }
  | { type: 'SET_BUSY'; busy: boolean }
  | { type: 'FINALIZE_START' }
  | { type: 'FINALIZE_COMPLETE' }
  | { type: 'RESET' }
  | { type: 'FORCE_IDLE' };

// Reducer function - the heart of our state machine
function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  // Always allow RESET and FORCE_IDLE
  if (action.type === 'RESET') {
    return initialState;
  }
  
  if (action.type === 'FORCE_IDLE') {
    return {
      ...initialState,
      mode: 'IDLE',
    };
  }

  // Handle busy state changes
  if (action.type === 'SET_BUSY') {
    if (action.busy) {
      return { ...state, mode: 'BUSY', isBusy: true };
    } else {
      return { ...state, mode: 'IDLE', isBusy: false };
    }
  }

  // Block all actions except space release when busy
  if (state.mode === 'BUSY') {
    if (action.type === 'SPACE_UP') {
      return { ...state, isSpacePressed: false };
    }
    return state; // Ignore all other actions when busy
  }

  // Handle spacebar press/release globally
  if (action.type === 'SPACE_DOWN') {
    console.log('State machine: SPACE_DOWN received, current mode:', state.mode);
    // Only transition to AWAITING_PAN if we're idle
    if (state.mode === 'IDLE') {
      console.log('State machine: Transitioning to AWAITING_PAN');
      return { ...state, mode: 'AWAITING_PAN', isSpacePressed: true };
    } else if (state.mode === 'DRAWING') {
      // If drawing, mark space as pressed but stay in drawing mode
      // We'll finalize the drawing when space is released
      return { ...state, isSpacePressed: true };
    }
    return state;
  }

  if (action.type === 'SPACE_UP') {
    console.log('State machine: SPACE_UP received, current mode:', state.mode);
    // Always clear the space flag
    const newState = { ...state, isSpacePressed: false };
    
    // If we were in AWAITING_PAN or PANNING mode, return to IDLE
    if (state.mode === 'AWAITING_PAN' || state.mode === 'PANNING') {
      console.log('State machine: Transitioning from', state.mode, 'to IDLE');
      return { ...newState, mode: 'IDLE' };
    }
    
    // If we were drawing with space pressed, we might want to finalize
    // But that should be handled by the component logic
    return newState;
  }

  // State-specific transitions
  switch (state.mode) {
    case 'IDLE':
      switch (action.type) {
        case 'MOUSE_DOWN':
          // Don't start any action if space is held
          if (state.isSpacePressed) {
            return { ...state, isMouseDown: true, mouseButton: action.button };
          }
          
          // Middle or right click - do nothing
          if (action.button === 1 || action.button === 2) {
            return { ...state, isMouseDown: true, mouseButton: action.button };
          }
          
          // Left click - will transition based on tool
          return {
            ...state,
            isMouseDown: true,
            mouseButton: action.button,
            lastPosition: action.position,
          };
          
        case 'START_DRAWING':
          return {
            ...state,
            mode: 'DRAWING',
            drawingStartPosition: action.position,
            lastPosition: action.position,
            stroke: [action.position], // Initialize stroke with starting point
          };
          
        case 'START_SELECTION':
          return {
            ...state,
            mode: 'SELECTING',
            selectionStart: action.position,
            selectionEnd: action.position,
          };
          
        case 'START_SHAPE':
          return {
            ...state,
            mode: 'SHAPE_DEFINING',
            shapeDefineStart: action.position,
            lastPosition: action.position,
          };
          
        case 'START_PASTE_DRAG':
          return {
            ...state,
            mode: 'DRAGGING_PASTE',
            lastPosition: action.position,
          };
          
        default:
          return state;
      }
      
    case 'DRAWING':
      switch (action.type) {
        case 'MOUSE_MOVE':
          return { 
            ...state, 
            lastPosition: action.position,
            stroke: [...state.stroke, action.position] // Add point to stroke
          };
          
        case 'MOUSE_UP':
        case 'MOUSE_LEAVE':
        case 'END_INTERACTION':
          // Save stroke to history and transition to finalizing
          return {
            ...state,
            mode: 'FINALIZING',
            isMouseDown: false,
            mouseButton: null,
            history: state.stroke.length > 0 ? [...state.history, state.stroke] : state.history,
            stroke: [], // Clear current stroke
          };
          
        case 'FINALIZE_START':
          return { ...state, mode: 'FINALIZING' };
          
        default:
          return state;
      }
      
    case 'SELECTING':
      switch (action.type) {
        case 'MOUSE_MOVE':
          if (state.isMouseDown) {
            return { ...state, selectionEnd: action.position };
          }
          return state;
          
        case 'MOUSE_UP':
        case 'END_INTERACTION':
          return {
            ...state,
            mode: 'IDLE',
            isMouseDown: false,
            mouseButton: null,
          };
          
        default:
          return state;
      }
      
    case 'SHAPE_DEFINING':
      switch (action.type) {
        case 'MOUSE_MOVE':
          return { ...state, lastPosition: action.position };
          
        case 'MOUSE_UP':
        case 'END_INTERACTION':
          return {
            ...state,
            mode: 'FINALIZING',
            isMouseDown: false,
            mouseButton: null,
          };
          
        default:
          return state;
      }
      
    case 'DRAGGING_PASTE':
      switch (action.type) {
        case 'MOUSE_MOVE':
          return { ...state, lastPosition: action.position };
          
        case 'MOUSE_UP':
        case 'END_INTERACTION':
          return {
            ...state,
            mode: 'IDLE',
            isMouseDown: false,
            mouseButton: null,
            lastPosition: null,
          };
          
        default:
          return state;
      }
      
    case 'AWAITING_PAN':
      switch (action.type) {
        case 'MOUSE_DOWN':
          // Start panning when mouse is pressed while awaiting pan
          console.log('State machine: MOUSE_DOWN in AWAITING_PAN, transitioning to PANNING');
          return {
            ...state,
            mode: 'PANNING',
            isMouseDown: true,
            mouseButton: action.button,
            lastPosition: action.position
          };
          
        case 'MOUSE_MOVE':
          // Track mouse position while waiting to pan
          return { ...state, lastPosition: action.position };
          
        case 'MOUSE_UP':
          return { ...state, isMouseDown: false, mouseButton: null };
          
        default:
          return state;
      }
      
    case 'PANNING':
      switch (action.type) {
        case 'MOUSE_MOVE':
          return { ...state, lastPosition: action.position };
          
        case 'MOUSE_UP':
          // Go back to awaiting pan if space is still held
          if (state.isSpacePressed) {
            return {
              ...state,
              mode: 'AWAITING_PAN',
              isMouseDown: false,
              mouseButton: null
            };
          }
          // Otherwise go to idle
          return {
            ...state,
            mode: 'IDLE',
            isMouseDown: false,
            mouseButton: null
          };
          
        case 'MOUSE_LEAVE':
          // Keep panning even if mouse leaves canvas
          return state;
          
        default:
          return state;
      }
      
    case 'FINALIZING':
      switch (action.type) {
        case 'FINALIZE_COMPLETE':
          // Reset to idle after finalization
          return {
            ...initialState,
            mode: 'IDLE',
            isSpacePressed: state.isSpacePressed, // Preserve space state
          };
          
        default:
          // Block all other actions during finalization
          return state;
      }
      
    case 'BUSY':
      // Already handled above
      return state;
      
    default:
      return state;
  }
}

// Custom hook
export function useCanvasStateMachine() {
  const [state, dispatch] = useReducer(canvasReducer, initialState);
  
  // Refs for immediate access in event handlers
  const stateRef = useRef(state);
  stateRef.current = state;
  
  // Helper functions for common operations
  const setBusy = useCallback((busy: boolean) => {
    dispatch({ type: 'SET_BUSY', busy });
  }, []);
  
  const startDrawing = useCallback((position: { x: number; y: number }) => {
    dispatch({ type: 'START_DRAWING', position });
  }, []);
  
  const startSelection = useCallback((position: { x: number; y: number }) => {
    dispatch({ type: 'START_SELECTION', position });
  }, []);
  
  const startShape = useCallback((position: { x: number; y: number }) => {
    dispatch({ type: 'START_SHAPE', position });
  }, []);
  
  const startPasteDrag = useCallback((position: { x: number; y: number }) => {
    dispatch({ type: 'START_PASTE_DRAG', position });
  }, []);
  
  const finalizeDrawing = useCallback(() => {
    dispatch({ type: 'FINALIZE_START' });
  }, []);
  
  const finalizationComplete = useCallback(() => {
    dispatch({ type: 'FINALIZE_COMPLETE' });
  }, []);
  
  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);
  
  const forceIdle = useCallback(() => {
    dispatch({ type: 'FORCE_IDLE' });
  }, []);
  
  return {
    state,
    dispatch,
    stateRef,
    // Helper methods
    setBusy,
    startDrawing,
    startSelection,
    startShape,
    startPasteDrag,
    finalizeDrawing,
    finalizationComplete,
    reset,
    forceIdle,
    // State checks
    canDraw: state.mode === 'IDLE' && !state.isSpacePressed && !state.isBusy,
    isDrawing: state.mode === 'DRAWING',
    isSelecting: state.mode === 'SELECTING',
    isFinalizing: state.mode === 'FINALIZING',
    isDraggingPaste: state.mode === 'DRAGGING_PASTE',
    isAwaitingPan: state.mode === 'AWAITING_PAN',
    isPanning: state.mode === 'PANNING',
    isIdle: state.mode === 'IDLE',
  };
}