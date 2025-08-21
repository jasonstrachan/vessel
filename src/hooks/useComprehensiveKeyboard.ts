import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushShape, Tool } from '../types';

interface KeyboardState {
  isSpacePressed: boolean;
  isShiftPressed: boolean;
  isCtrlPressed: boolean;
  isAltPressed: boolean;
  isMetaPressed: boolean;
}

interface UseComprehensiveKeyboardProps {
  onSpacePressed?: () => void;
  onSpaceReleased?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onBrushSizeDecrease?: () => void;
  onBrushSizeIncrease?: () => void;
  onCustomTool?: () => void;
  onPolygonComplete?: () => void;
  onPolygonCancel?: () => void;
  onEnterPressed?: () => void;
  onEscapePressed?: () => void;
  onEraserPressed?: () => void;
  onEraserReleased?: () => void;
  enabled?: boolean;
}

export function useComprehensiveKeyboard({
  onSpacePressed,
  onSpaceReleased,
  onUndo,
  onRedo,
  onBrushSizeDecrease,
  onBrushSizeIncrease,
  onCustomTool,
  onPolygonComplete,
  onPolygonCancel,
  onEnterPressed,
  onEscapePressed,
  onEraserPressed,
  onEraserReleased,
  enabled = true
}: UseComprehensiveKeyboardProps) {
  // Track all modifier keys
  const keyboardStateRef = useRef<KeyboardState>({
    isSpacePressed: false,
    isShiftPressed: false,
    isCtrlPressed: false,
    isAltPressed: false,
    isMetaPressed: false,
  });

  // Track which keys are currently pressed to prevent repeat events
  const pressedKeysRef = useRef<Set<string>>(new Set());
  
  // Track previous tool for temporary eraser mode
  const previousToolRef = useRef<string | null>(null);
  const isTemporaryEraserRef = useRef(false);
  const eraserPressTimeRef = useRef<number>(0);

  const { 
    setCurrentTool, 
    tools, 
    polygonGradientState,
    setGlobalBrushSize 
  } = useAppStore();

  // Use refs for stable callbacks to avoid re-registering event listeners
  const onSpacePressedRef = useRef(onSpacePressed);
  const onSpaceReleasedRef = useRef(onSpaceReleased);
  const onCustomToolRef = useRef(onCustomTool);
  const onEraserPressedRef = useRef(onEraserPressed);
  const onEraserReleasedRef = useRef(onEraserReleased);
  const onUndoRef = useRef(onUndo);
  const onRedoRef = useRef(onRedo);
  
  // Update refs when callbacks change
  useEffect(() => {
    onSpacePressedRef.current = onSpacePressed;
    onSpaceReleasedRef.current = onSpaceReleased;
    onCustomToolRef.current = onCustomTool;
    onEraserPressedRef.current = onEraserPressed;
    onEraserReleasedRef.current = onEraserReleased;
    onUndoRef.current = onUndo;
    onRedoRef.current = onRedo;
  }, [onSpacePressed, onSpaceReleased, onCustomTool, onEraserPressed, onEraserReleased, onUndo, onRedo]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;


    // Update modifier states
    keyboardStateRef.current.isShiftPressed = event.shiftKey;
    keyboardStateRef.current.isCtrlPressed = event.ctrlKey;
    keyboardStateRef.current.isAltPressed = event.altKey;
    keyboardStateRef.current.isMetaPressed = event.metaKey;

    // Handle Undo (Ctrl/Cmd + Z) - must come before general key tracking
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      onUndoRef.current?.();
      return;
    }

    // Handle Redo (Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y)
    if ((event.ctrlKey || event.metaKey) && (
      (event.key.toLowerCase() === 'z' && event.shiftKey) || 
      (event.key.toLowerCase() === 'y' && !event.shiftKey)
    )) {
      event.preventDefault();
      if (onRedoRef.current) {
        onRedoRef.current();
      }
      return;
    }

    // Handle Space for panning (prevent repeat)
    if (event.code === 'Space') {
      event.preventDefault();
      
      // Only process if not already pressed
      if (!keyboardStateRef.current.isSpacePressed) {
        keyboardStateRef.current.isSpacePressed = true;
        pressedKeysRef.current.add(event.code);
        onSpacePressedRef.current?.();
      }
      return;
    }

    // For bracket keys, allow repeat events for continuous size adjustment
    const allowRepeat = event.key === '[' || event.key === ']';
    
    // Prevent repeat events for other keys (but allow for bracket keys)
    if (!allowRepeat && pressedKeysRef.current.has(event.code)) {
      return;
    }
    if (!allowRepeat) {
      pressedKeysRef.current.add(event.code);
    }

    // Handle Save (Ctrl/Cmd + S) - prevent default browser save
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault();
      // Save is handled in the main page component
      return;
    }

    // Handle Open (Ctrl/Cmd + O) - prevent default browser open
    if ((event.ctrlKey || event.metaKey) && event.key === 'o') {
      event.preventDefault();
      // Open is handled in the main page component
      return;
    }

    // Tool switching - C for custom brush
    if (event.key === 'c' || event.key === 'C') {
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        onCustomToolRef.current?.();
        return;
      }
    }

    // Tool switching - F for fill tool
    if (event.key === 'f' || event.key === 'F') {
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        setCurrentTool('fill');
        return;
      }
    }

    // Tool switching - B for brush tool
    if (event.key === 'b' || event.key === 'B') {
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        setCurrentTool('brush');
        return;
      }
    }

    // Tool switching - E for eraser tool (hold for temporary, tap for permanent)
    if (event.key === 'e' || event.key === 'E') {
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        
        // Record press time
        eraserPressTimeRef.current = Date.now();
        
        // Store current tool for potential temporary mode
        if (tools.currentTool !== 'eraser') {
          previousToolRef.current = tools.currentTool;
          isTemporaryEraserRef.current = true;
          setCurrentTool('eraser');
        } else {
          // Already in eraser mode, keep it
          isTemporaryEraserRef.current = false;
        }
        
        onEraserPressedRef.current?.();
        return;
      }
    }

    // Tool switching - S for selection tool
    if (event.key === 's' || event.key === 'S') {
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        setCurrentTool('selection');
        return;
      }
    }

    // Brush size adjustment
    if (event.key === '[') {
      event.preventDefault();
      if (onBrushSizeDecrease) {
        onBrushSizeDecrease();
      } else {
        // Default implementation
        const { brushSettings } = tools;
        const isCustomBrush = brushSettings.brushShape === BrushShape.CUSTOM;
        const currentSize = brushSettings.size;
        const adjustment = 5;
        const minSize = isCustomBrush ? 1 : 1;
        const newSize = Math.max(minSize, currentSize - adjustment);
        setGlobalBrushSize(newSize);
      }
      return;
    }

    if (event.key === ']') {
      event.preventDefault();
      if (onBrushSizeIncrease) {
        onBrushSizeIncrease();
      } else {
        // Default implementation
        const { brushSettings } = tools;
        const isCustomBrush = brushSettings.brushShape === BrushShape.CUSTOM;
        const currentSize = brushSettings.size;
        const adjustment = 5;
        const maxSize = isCustomBrush ? 200 : 500;
        const newSize = Math.min(maxSize, currentSize + adjustment);
        setGlobalBrushSize(newSize);
      }
      return;
    }

    // Polygon gradient completion
    if (tools.brushSettings.brushShape === BrushShape.POLYGON_GRADIENT && 
        polygonGradientState.points.length >= 3) {
      if (event.key === 'Enter') {
        event.preventDefault();
        onPolygonComplete?.();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onPolygonCancel?.();
        return;
      }
    }

    // Enter key general handling (for floating paste)
    if (event.key === 'Enter') {
      event.preventDefault();
      onEnterPressed?.();
      return;
    }
    
    // Escape key general handling
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscapePressed?.();
      return;
    }
  }, [enabled, onBrushSizeDecrease, onBrushSizeIncrease, onPolygonComplete, 
      onPolygonCancel, onEnterPressed, onEscapePressed,
      tools, polygonGradientState, setCurrentTool, setGlobalBrushSize]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;


    // Update modifier states
    keyboardStateRef.current.isShiftPressed = event.shiftKey;
    keyboardStateRef.current.isCtrlPressed = event.ctrlKey;
    keyboardStateRef.current.isAltPressed = event.altKey;
    keyboardStateRef.current.isMetaPressed = event.metaKey;

    // Handle Space release
    if (event.code === 'Space') {
      event.preventDefault();
      
      // Only process if space was actually pressed
      if (keyboardStateRef.current.isSpacePressed) {
        keyboardStateRef.current.isSpacePressed = false;
        pressedKeysRef.current.delete(event.code);
        onSpaceReleasedRef.current?.();
      }
      return;
    }
    
    // Remove from pressed keys for other keys
    pressedKeysRef.current.delete(event.code);
    
    // Handle E key release (for temporary eraser mode)
    if (event.key === 'e' || event.key === 'E') {
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        
        // Calculate hold duration
        const holdDuration = Date.now() - eraserPressTimeRef.current;
        const isQuickTap = holdDuration < 200; // Tap if held less than 200ms
        
        // If it was temporary mode and a hold (not a tap), restore previous tool
        if (isTemporaryEraserRef.current && previousToolRef.current && !isQuickTap) {
          // Restore previous tool
          setCurrentTool(previousToolRef.current as Tool);
          previousToolRef.current = null;
          isTemporaryEraserRef.current = false;
        } else if (isTemporaryEraserRef.current && isQuickTap) {
          // It was a tap - make eraser permanent
          previousToolRef.current = null;
          isTemporaryEraserRef.current = false;
        }
        
        onEraserReleasedRef.current?.();
        return;
      }
    }
  }, [enabled, setCurrentTool]);

  // Handle window blur to reset state when window loses focus
  const handleBlur = useCallback(() => {
    // Reset keyboard state when window loses focus
    if (!document.hasFocus()) {
      // If space was pressed, release it
      if (keyboardStateRef.current.isSpacePressed) {
        keyboardStateRef.current.isSpacePressed = false;
        onSpaceReleasedRef.current?.();
      }
      
      // Reset all states
      keyboardStateRef.current = {
        isSpacePressed: false,
        isShiftPressed: false,
        isCtrlPressed: false,
        isAltPressed: false,
        isMetaPressed: false,
      };
      pressedKeysRef.current.clear();
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Remove any existing listeners first to prevent duplicates
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('blur', handleBlur);
    
    // Add fresh listeners
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [enabled, handleKeyDown, handleKeyUp, handleBlur]);

  return {
    keyboardState: keyboardStateRef,
    isSpacePressed: () => keyboardStateRef.current.isSpacePressed,
    isShiftPressed: () => keyboardStateRef.current.isShiftPressed,
    isCtrlPressed: () => keyboardStateRef.current.isCtrlPressed,
    isAltPressed: () => keyboardStateRef.current.isAltPressed,
    isMetaPressed: () => keyboardStateRef.current.isMetaPressed,
  };
}
