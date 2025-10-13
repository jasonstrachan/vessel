# Canvas State Management Refactoring

## Overview
Refactored the DrawingCanvas component to improve state management by:
1. Separating local UI state from global application state
2. Breaking down the monolithic component into focused custom hooks
3. Using useReducer for complex interaction state management

## Problem
The original DrawingCanvas component had overloaded state management with:
- Mixed useState, useRef, and global Zustand store usage
- Manual syncing between refs and state
- Complex state transitions scattered across event handlers
- Difficult to follow multi-step tool logic (rectangle/polygon gradients)

## Solution Architecture

### Custom Hooks Created

#### 1. `useCanvasInteraction`
- Manages all interaction state with a reducer pattern
- States: panning, drawing, selecting, keyboard modifiers
- Provides centralized dispatch for state transitions
- Maintains refs for performance-critical values

#### 2. `usePanAndZoom`
- Handles view transformation (scale, offset)
- Manages wheel zoom events
- Provides coordinate conversion (screen ↔ world)
- Centers canvas on mount

#### 3. `useToolStateMachine`
- Manages complex tool state machines
- Rectangle gradient: idle → definingLength → definingWidth → complete
- Polygon gradient: idle → drawing → complete
- Encapsulates tool-specific logic

#### 4. `useKeyboardShortcuts`
- Centralizes keyboard event handling
- Manages shortcuts for undo/redo, pan (space), brush size, tool switching
- Polygon completion (Enter/Escape)

#### 5. `useDrawingHandlers`
- Manages drawing canvas lifecycle
- Handles brush stroke rendering
- Manages capture to layer process
- Provides clean drawing API

## State Classification

### Local State (Component)
- UI interaction state (isPanning, isDrawing, isSelecting)
- View transformation (for immediate updates)
- Mouse position and cursor visibility
- Animation state (marching ants)
- Drawing canvas management
- Animation frame refs

### Global State (Zustand)
- Project and layers data
- Tool and brush settings
- Selection bounds (needed by other components)
- History/undo/redo
- Canvas dimensions and persistent view settings

## Benefits
1. **Improved Readability**: Each hook has a single responsibility
2. **Better Testing**: Hooks can be tested in isolation
3. **Reusability**: Hooks can be used in other components
4. **Performance**: Reduced re-renders through better state organization
5. **Maintainability**: Clear separation of concerns

## Migration Path
1. Created new hooks in `/src/hooks/`
2. Created `DrawingCanvasRefactored.tsx` alongside original
3. Swapped components in `page.tsx` for testing
4. Once validated, can remove original and rename refactored version

## Files Changed
- Created: `/src/hooks/useCanvasInteraction.ts`
- Created: `/src/hooks/usePanAndZoom.ts`
- Created: `/src/hooks/useToolStateMachine.ts`
- Created: `/src/hooks/useKeyboardShortcuts.ts`
- Created: `/src/hooks/useDrawingHandlers.ts`
- Created: `/src/components/canvas/DrawingCanvasRefactored.tsx`
- Modified: `/src/app/page.tsx` (to use refactored component)