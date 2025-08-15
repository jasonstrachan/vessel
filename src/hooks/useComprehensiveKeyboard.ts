import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushShape } from '../types';

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

  const { 
    setCurrentTool, 
    tools, 
    polygonGradientState,
    setGlobalBrushSize 
  } = useAppStore();

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    // Debug logging for ALL Ctrl/Cmd keys
    if (event.ctrlKey || event.metaKey) {
      console.log('🔑 Ctrl/Cmd key detected:', {
        key: event.key,
        code: event.code,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        repeat: event.repeat
      });
    }

    // Update modifier states
    keyboardStateRef.current.isShiftPressed = event.shiftKey;
    keyboardStateRef.current.isCtrlPressed = event.ctrlKey;
    keyboardStateRef.current.isAltPressed = event.altKey;
    keyboardStateRef.current.isMetaPressed = event.metaKey;

    // Handle Undo (Ctrl/Cmd + Z) - must come before general key tracking
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      console.log('🔙 Undo triggered from useComprehensiveKeyboard');
      onUndo?.();
      return;
    }

    // Handle Redo (Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y)
    if ((event.ctrlKey || event.metaKey) && (
      (event.key.toLowerCase() === 'z' && event.shiftKey) || 
      (event.key.toLowerCase() === 'y' && !event.shiftKey)
    )) {
      event.preventDefault();
      console.log('🔄 Redo triggered from useComprehensiveKeyboard', {
        key: event.key,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        hasOnRedo: !!onRedo
      });
      if (onRedo) {
        onRedo();
      } else {
        console.log('❌ No onRedo callback provided!');
      }
      return;
    }

    // Prevent repeat events for other keys
    if (pressedKeysRef.current.has(event.code)) {
      return;
    }
    pressedKeysRef.current.add(event.code);

    // Handle Space for panning
    if (event.code === 'Space') {
      event.preventDefault();
      keyboardStateRef.current.isSpacePressed = true;
      onSpacePressed?.();
      return;
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
        onCustomTool?.();
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
        const minSize = isCustomBrush ? 10 : 1;
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
  }, [enabled, onSpacePressed, onUndo, onRedo, onCustomTool, 
      onBrushSizeDecrease, onBrushSizeIncrease, onPolygonComplete, 
      onPolygonCancel, onEnterPressed, onEscapePressed, tools, 
      polygonGradientState, setCurrentTool, setGlobalBrushSize]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    // Update modifier states
    keyboardStateRef.current.isShiftPressed = event.shiftKey;
    keyboardStateRef.current.isCtrlPressed = event.ctrlKey;
    keyboardStateRef.current.isAltPressed = event.altKey;
    keyboardStateRef.current.isMetaPressed = event.metaKey;

    // Remove from pressed keys
    pressedKeysRef.current.delete(event.code);

    // Handle Space release
    if (event.code === 'Space') {
      event.preventDefault();
      keyboardStateRef.current.isSpacePressed = false;
      onSpaceReleased?.();
      return;
    }
  }, [enabled, onSpaceReleased]);

  // Handle blur to reset state when window loses focus
  const handleBlur = useCallback(() => {
    // Check the state before clearing it
    const wasSpacePressed = keyboardStateRef.current.isSpacePressed;

    // Reset all states when window loses focus
    keyboardStateRef.current = {
      isSpacePressed: false,
      isShiftPressed: false,
      isCtrlPressed: false,
      isAltPressed: false,
      isMetaPressed: false,
    };
    pressedKeysRef.current.clear();
    
    // Notify about space release if it was pressed
    if (wasSpacePressed) {
      onSpaceReleased?.();
    }
  }, [onSpaceReleased]);

  useEffect(() => {
    if (!enabled) return;

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