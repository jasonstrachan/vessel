import { useReducer, useRef, useCallback } from 'react';
import { debugLog } from '../utils/debug';

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

// Shape types
export type ShapeType = 'freehand' | 'rectangle' | 'polygon' | 'ellipse' | 'line';

export interface Shape {
  type: ShapeType;
  points?: Array<{ x: number; y: number }>; // For freehand and polygon
  start?: { x: number; y: number }; // For rectangle, ellipse, line
  end?: { x: number; y: number }; // For rectangle, ellipse, line
  color?: string;
  size?: number;
  opacity?: number;
}

// Complete state shape
export interface CanvasState {
  mode: CanvasMode;
  currentTool: string; // Current tool from the app store
  isSpacePressed: boolean;
  isMouseDown: boolean;
  mouseButton: number | null; // 0=left, 1=middle, 2=right
  lastPosition: { x: number; y: number } | null;
  drawingStartPosition: { x: number; y: number } | null;
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
  shapeDefineStart: { x: number; y: number } | null;
  isBusy: boolean; // Lock for async operations
  activeShape: Shape | null; // Current shape being drawn
  history: Shape[]; // Completed shapes
}

// Initial state
const initialState: CanvasState = {
  mode: 'IDLE',
  currentTool: 'brush',
  isSpacePressed: false,
  isMouseDown: false,
  mouseButton: null,
  lastPosition: null,
  drawingStartPosition: null,
  selectionStart: null,
  selectionEnd: null,
  shapeDefineStart: null,
  isBusy: false,
  activeShape: null,
  history: [],
};

// Action types
export type CanvasAction =
  | { type: 'MOUSE_DOWN'; button: number; position: { x: number; y: number }; tool: string; pressure?: number }
  | { type: 'MOUSE_UP'; position: { x: number; y: number } }
  | { type: 'MOUSE_MOVE'; position: { x: number; y: number }; pressure?: number }
  | { type: 'MOUSE_LEAVE' }
  | { type: 'SPACE_DOWN' }
  | { type: 'SPACE_UP' }
  | { type: 'START_DRAWING'; position: { x: number; y: number }; pressure?: number }
  | { type: 'START_SELECTION'; position: { x: number; y: number } }
  | { type: 'START_SHAPE'; position: { x: number; y: number }; shapeType: ShapeType }
  | { type: 'START_PASTE_DRAG'; position: { x: number; y: number } }
  | { type: 'END_INTERACTION' }
  | { type: 'SET_BUSY'; busy: boolean }
  | { type: 'SET_TOOL'; tool: string }
  | { type: 'FINALIZE_SHAPE' }
  | { type: 'ADD_POLYGON_POINT'; position: { x: number; y: number } }
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

  // Handle SET_TOOL action globally - can happen in any state
  if (action.type === 'SET_TOOL') {
    // Only update if the tool is actually changing to avoid unnecessary re-renders
    if (state.currentTool !== action.tool) {
      return { ...state, currentTool: action.tool };
    }
    return state;
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
    debugLog('pan-sm', 'SPACE_DOWN', { mode: state.mode });
    
    // If we're currently drawing, we need to finalize first
    if (state.mode === 'DRAWING') {
      debugLog('pan-sm', 'DRAWING → FINALIZING (space)');
      return {
        ...state,
        mode: 'FINALIZING',
        isSpacePressed: true,
        isMouseDown: false,
        mouseButton: null,
        // Preserve drawing state for finalization
      };
    }
    
    // Only transition to AWAITING_PAN if not already there or panning
    if (state.mode !== 'AWAITING_PAN' && state.mode !== 'PANNING') {
      debugLog('pan-sm', 'Transition', { from: state.mode, to: 'AWAITING_PAN' });
      return { 
        ...state, 
        mode: 'AWAITING_PAN', 
        isSpacePressed: true,
        // Clear any drawing state
        isMouseDown: false,
        mouseButton: null,
        lastPosition: null
      };
    }
    // If already in AWAITING_PAN or PANNING, just ensure space flag is set
    if (state.mode === 'AWAITING_PAN' || state.mode === 'PANNING') {
      return { ...state, isSpacePressed: true };
    }
    return state;
  }

  if (action.type === 'SPACE_UP') {
    debugLog('pan-sm', 'SPACE_UP', { mode: state.mode });
    // Always clear the space flag
    const newState = { ...state, isSpacePressed: false };
    
    // If we were in AWAITING_PAN or PANNING mode, return to IDLE
    if (state.mode === 'AWAITING_PAN' || state.mode === 'PANNING') {
      debugLog('pan-sm', 'Transition', { from: state.mode, to: 'IDLE' });
      return { 
        ...newState, 
        mode: 'IDLE', 
        isMouseDown: false, 
        mouseButton: null,
        lastPosition: null // Clear last position to prevent sticking
      };
    }
    
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
          // Create initial shape based on current tool
          let initialShape: Shape | null = null;
          const tool = state.currentTool;
          
          if (tool === 'brush' || tool === 'eraser') {
            initialShape = {
              type: 'freehand',
              points: [action.position]
            };
          }
          
          return {
            ...state,
            mode: 'DRAWING',
            drawingStartPosition: action.position,
            lastPosition: action.position,
            activeShape: initialShape,
          };
          
        case 'START_SELECTION':
          return {
            ...state,
            mode: 'SELECTING',
            selectionStart: action.position,
            selectionEnd: action.position,
          };
          
        case 'START_SHAPE':
          // Initialize shape based on type
          let shape: Shape;
          
          if (action.shapeType === 'polygon') {
            shape = {
              type: 'polygon',
              points: [action.position]
            };
          } else {
            shape = {
              type: action.shapeType,
              start: action.position,
              end: action.position
            };
          }
          
          return {
            ...state,
            mode: 'SHAPE_DEFINING',
            shapeDefineStart: action.position,
            lastPosition: action.position,
            activeShape: shape,
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
          if (!state.activeShape) return state;
          
          // Update shape based on type
          let updatedShape: Shape;
          
          if (state.activeShape.type === 'freehand' && state.activeShape.points) {
            updatedShape = {
              ...state.activeShape,
              points: [...state.activeShape.points, action.position]
            };
          } else {
            updatedShape = state.activeShape;
          }
          
          return { 
            ...state, 
            lastPosition: action.position,
            activeShape: updatedShape
          };
          
        case 'MOUSE_UP':
        case 'MOUSE_LEAVE':
        case 'END_INTERACTION':
          // Save shape to history and transition to finalizing
          const shapesToAdd = state.activeShape ? [state.activeShape] : [];
          return {
            ...state,
            mode: 'FINALIZING',
            isMouseDown: false,
            mouseButton: null,
            history: [...state.history, ...shapesToAdd],
            activeShape: null,
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
          if (!state.activeShape) return state;
          
          // Update shape based on type
          let updatedShape: Shape;
          
          if (state.activeShape.type === 'rectangle' || 
              state.activeShape.type === 'ellipse' || 
              state.activeShape.type === 'line') {
            updatedShape = {
              ...state.activeShape,
              end: action.position
            };
          } else {
            updatedShape = state.activeShape;
          }
          
          return { 
            ...state, 
            lastPosition: action.position,
            activeShape: updatedShape
          };
          
        case 'ADD_POLYGON_POINT':
          if (!state.activeShape || state.activeShape.type !== 'polygon') return state;
          
          return {
            ...state,
            activeShape: {
              ...state.activeShape,
              points: [...(state.activeShape.points || []), action.position]
            }
          };
          
        case 'MOUSE_UP':
          // For polygon, mouse up doesn't finalize
          if (state.activeShape?.type === 'polygon') {
            return {
              ...state,
              isMouseDown: false,
              mouseButton: null,
            };
          }
          // For other shapes, finalize on mouse up
          return {
            ...state,
            mode: 'FINALIZING',
            isMouseDown: false,
            mouseButton: null,
            history: state.activeShape ? [...state.history, state.activeShape] : state.history,
            activeShape: null,
          };
          
        case 'FINALIZE_SHAPE':
          // Finalize polygon or other shapes
          return {
            ...state,
            mode: 'IDLE',      // Reset the mode directly to IDLE
            isMouseDown: false,
            mouseButton: null,
            history: state.activeShape ? [...state.history, state.activeShape] : state.history,
            activeShape: null,  // Clear the temporary shape data
          };
          
        case 'END_INTERACTION':
          return {
            ...state,
            mode: 'FINALIZING',
            isMouseDown: false,
            mouseButton: null,
            history: state.activeShape ? [...state.history, state.activeShape] : state.history,
            activeShape: null,
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
          debugLog('pan-sm', 'Transition', { from: 'AWAITING_PAN', to: 'PANNING' });
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
            debugLog('pan-sm', 'MouseUp (space held)', { from: 'PANNING', to: 'AWAITING_PAN' });
            return {
              ...state,
              mode: 'AWAITING_PAN',
              isMouseDown: false,
              mouseButton: null
            };
          }
          // Otherwise go to idle
          debugLog('pan-sm', 'MouseUp (no space)', { from: 'PANNING', to: 'IDLE' });
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
          // Surgical update: only clear drawing-related state, preserve everything else
          // BUT if space is pressed, we should go to AWAITING_PAN instead of IDLE
          const nextMode = state.isSpacePressed ? 'AWAITING_PAN' : 'IDLE';
          return {
            ...state,
            mode: nextMode,
            isMouseDown: false,
            mouseButton: null,
            lastPosition: null,
            drawingStartPosition: null,
            selectionStart: null,
            selectionEnd: null,
            shapeDefineStart: null,
            activeShape: null,
            // Note: We preserve currentTool, isSpacePressed, history, and any other state
          };
          
        default:
          // Block all other actions during finalization
          return state;
      }
      
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
  
  const startShape = useCallback((position: { x: number; y: number }, shapeType: ShapeType) => {
    dispatch({ type: 'START_SHAPE', position, shapeType });
  }, []);
  
  const setTool = useCallback((tool: string) => {
    dispatch({ type: 'SET_TOOL', tool });
  }, []);
  
  const addPolygonPoint = useCallback((position: { x: number; y: number }) => {
    dispatch({ type: 'ADD_POLYGON_POINT', position });
  }, []);
  
  const finalizeShape = useCallback(() => {
    dispatch({ type: 'FINALIZE_SHAPE' });
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
    finalizeShape,
    addPolygonPoint,
    setTool,
    reset,
    forceIdle,
    // State checks
    canDraw: state.mode === 'IDLE' && !state.isSpacePressed && !state.isBusy,
    isDrawing: state.mode === 'DRAWING',
    isSelecting: state.mode === 'SELECTING',
    isShapeDefining: state.mode === 'SHAPE_DEFINING',
    isFinalizing: state.mode === 'FINALIZING',
    isDraggingPaste: state.mode === 'DRAGGING_PASTE',
    isAwaitingPan: state.mode === 'AWAITING_PAN',
    isPanning: state.mode === 'PANNING',
    isIdle: state.mode === 'IDLE',
  };
}
