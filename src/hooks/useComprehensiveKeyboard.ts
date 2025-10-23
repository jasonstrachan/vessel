import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushShape, Tool } from '../types';

// Treat these input types as text entry fields so we don't hijack shortcuts while typing.
const TEXTUAL_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'password', 'tel', 'number', 'color']);

const isTextEntryTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable ||
    target.getAttribute('contenteditable')?.toLowerCase() === 'true'
  ) {
    return true;
  }

  if (target instanceof HTMLInputElement) {
    const type = (target.type || 'text').toLowerCase();
    return TEXTUAL_INPUT_TYPES.has(type);
  }

  return false;
};

export const __keyboardTestUtils = { isTextEntryTarget };

interface KeyboardState {
  isSpacePressed: boolean;
  isShiftPressed: boolean;
  isCtrlPressed: boolean;
  isAltPressed: boolean;
  isMetaPressed: boolean;
}

type KeyboardScope = 'global' | 'canvas' | 'recolor' | 'gradient' | 'modal';

type VoidHandler = () => void | Promise<void>;

interface UseComprehensiveKeyboardProps {
  onSpacePressed?: VoidHandler;
  onSpaceReleased?: VoidHandler;
  onUndo?: VoidHandler;
  onRedo?: VoidHandler;
  onSave?: VoidHandler;
  onOpen?: VoidHandler;
  onBrushSizeDecrease?: VoidHandler;
  onBrushSizeIncrease?: VoidHandler;
  onCustomTool?: VoidHandler;
  onPolygonComplete?: VoidHandler;
  onPolygonCancel?: VoidHandler;
  onEnterPressed?: VoidHandler;
  onEscapePressed?: VoidHandler;
  onEraserPressed?: VoidHandler;
  onEraserReleased?: VoidHandler;
  enabled?: boolean;
  allowedScopes?: KeyboardScope[]; // default: ['canvas']
}

export function useComprehensiveKeyboard({
  onSpacePressed,
  onSpaceReleased,
  onUndo,
  onRedo,
  onSave,
  onOpen,
  onBrushSizeDecrease,
  onBrushSizeIncrease,
  onCustomTool,
  onPolygonComplete,
  onPolygonCancel,
  onEnterPressed,
  onEscapePressed,
  onEraserPressed,
  onEraserReleased,
  enabled = true,
  allowedScopes = ['canvas']
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
    setGlobalBrushSize,
    setEraserSettings,
    deleteSelectedPixels,
    selectAllActiveLayerPixels,
    selectionStart,
    selectionEnd,
    floatingPaste,
    setFloatingPaste,
    swapPaletteColors,
    setPaletteColor
  } = useAppStore();

  // Use refs for stable callbacks to avoid re-registering event listeners
  const onSpacePressedRef = useRef(onSpacePressed);
  const onSpaceReleasedRef = useRef(onSpaceReleased);
  const onCustomToolRef = useRef(onCustomTool);
  const onEraserPressedRef = useRef(onEraserPressed);
  const onEraserReleasedRef = useRef(onEraserReleased);
  const onUndoRef = useRef(onUndo);
  const onRedoRef = useRef(onRedo);
  const onSaveRef = useRef(onSave);
  const onOpenRef = useRef(onOpen);
  
  // Update refs when callbacks change
  useEffect(() => {
    onSpacePressedRef.current = onSpacePressed;
    onSpaceReleasedRef.current = onSpaceReleased;
    onCustomToolRef.current = onCustomTool;
    onEraserPressedRef.current = onEraserPressed;
    onEraserReleasedRef.current = onEraserReleased;
    onUndoRef.current = onUndo;
    onRedoRef.current = onRedo;
    onSaveRef.current = onSave;
    onOpenRef.current = onOpen;
  }, [onSpacePressed, onSpaceReleased, onCustomTool, onEraserPressed, onEraserReleased, onUndo, onRedo, onSave, onOpen]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    // Respect keyboard scope: bail if current scope not allowed (Space handled below regardless)
    let currentScope: KeyboardScope | null = null;
    const isBracketShortcut = event.key === '[' || event.key === ']';
    try {
      currentScope = useAppStore.getState().ui.keyboardScope as KeyboardScope;
      if (!allowedScopes.includes(currentScope)) {
        // If not allowed, still allow Space and bracket size shortcuts
        if (event.code !== 'Space' && !isBracketShortcut) return;
      }
    } catch {}

    // Ignore if typing in text-focused inputs or editable elements
    const target = event.target as HTMLElement | null;
    if (target instanceof HTMLInputElement) {
      if (isTextEntryTarget(target)) {
        if (event.code !== 'Space') {
          return;
        }
      } else if (event.code !== 'Space' && !isBracketShortcut) {
        return;
      }
    } else if (isTextEntryTarget(target)) {
      if (event.code !== 'Space') {
        return;
      }
    } else if (target instanceof HTMLSelectElement) {
      if (event.code !== 'Space' && !isBracketShortcut) {
        return;
      }
    }


    // Update modifier states
    keyboardStateRef.current.isShiftPressed = event.shiftKey;
    keyboardStateRef.current.isCtrlPressed = event.ctrlKey;
    keyboardStateRef.current.isAltPressed = event.altKey;
    keyboardStateRef.current.isMetaPressed = event.metaKey;

    // Handle Undo (Ctrl/Cmd + Z) - must come before general key tracking
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      void onUndoRef.current?.();
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

    // Palette swap/copy shortcuts (X to swap, Shift+X to copy foreground to background)
    if (!event.repeat && event.code === 'KeyX' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (event.shiftKey) {
        const state = useAppStore.getState();
        const foreground = state.palette.foregroundColor;
        setPaletteColor('background', foreground);
      } else {
        swapPaletteColors();
      }
      return;
    }

    // Handle Space for panning (prevent repeat)
    if (event.code === 'Space' && onSpacePressedRef.current) {
      event.preventDefault();
      
      // Only process if not already pressed
      if (!keyboardStateRef.current.isSpacePressed) {
        keyboardStateRef.current.isSpacePressed = true;
        pressedKeysRef.current.add(event.code);
        void onSpacePressedRef.current?.();
      }
      return;
    }

    // For bracket keys, allow repeat events for continuous size adjustment
    const allowRepeat = isBracketShortcut;
    
    // Prevent repeat events for other keys (but allow for bracket keys)
    if (!allowRepeat && pressedKeysRef.current.has(event.code)) {
      return;
    }
    if (!allowRepeat) {
      pressedKeysRef.current.add(event.code);
    }

    // Handle Save (Ctrl/Cmd + S) - prevent default browser save
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void onSaveRef.current?.();
      return;
    }

    // Handle Open (Ctrl/Cmd + O) - prevent default browser open
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      void onOpenRef.current?.();
      return;
    }

    // Handle Select All (Ctrl/Cmd + A)
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selectAllActiveLayerPixels();
      setCurrentTool('selection');
      return;
    }

    // Tool switching - C for custom brush
    if (event.key === 'c' || event.key === 'C') {
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        void onCustomToolRef.current?.();
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
        
        void onEraserPressedRef.current?.();
        return;
      }
    }

    // Tool switching - M for selection tool (marquee)
    if (event.key === 'm' || event.key === 'M') {
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
        const isEraserActive = tools.currentTool === 'eraser';
        const { brushSettings, eraserSettings } = tools;
        const currentSize = isEraserActive
          ? (eraserSettings?.size ?? brushSettings.size ?? 1)
          : (brushSettings.size ?? 1);
        const adjustment = 1;
        const minSize = 1;
        const newSize = Math.max(minSize, currentSize - adjustment);
        if (isEraserActive) {
          setEraserSettings({ size: newSize });
        } else {
          setGlobalBrushSize(newSize);
        }
      }
      return;
    }

    if (event.key === ']') {
      event.preventDefault();
      if (onBrushSizeIncrease) {
        onBrushSizeIncrease();
      } else {
        // Default implementation
        const isEraserActive = tools.currentTool === 'eraser';
        const { brushSettings, eraserSettings } = tools;
        const currentSize = isEraserActive
          ? (eraserSettings?.size ?? brushSettings.size ?? 1)
          : (brushSettings.size ?? 1);
        const adjustment = 1;
        const maxSize = 500;
        const newSize = Math.min(maxSize, currentSize + adjustment);
        if (isEraserActive) {
          setEraserSettings({ size: newSize });
        } else {
          setGlobalBrushSize(newSize);
        }
      }
      return;
    }

    // Polygon gradient or contour polygon completion
  const normalizedShapeGradientMode = tools.brushSettings.shapeGradientMode === 'mesh'
    ? 'lines'
    : ((tools.brushSettings.shapeGradientMode === 'flow' ||
        tools.brushSettings.shapeGradientMode === 'inkRibbons' ||
        tools.brushSettings.shapeGradientMode === 'triangle')
        ? 'contour'
        : (tools.brushSettings.shapeGradientMode || 'contour'));
    const isContourLines2Mode =
      tools.brushSettings.brushShape === BrushShape.CONTOUR_POLYGON &&
      normalizedShapeGradientMode === 'lines2';

    if ((tools.brushSettings.brushShape === BrushShape.POLYGON_GRADIENT || 
         tools.brushSettings.brushShape === BrushShape.CONTOUR_POLYGON ||
         tools.brushSettings.brushShape === BrushShape.CONTOUR_LINES2 ||
         isContourLines2Mode) && 
        polygonGradientState.points.length >= 3) {
      if (event.key === 'Enter') {
        event.preventDefault();
        void onPolygonComplete?.();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onPolygonCancel?.();
        return;
      }
    }

    // Delete key for deleting selected pixels
    if (event.key === 'Delete') {
      event.preventDefault();
      if (floatingPaste) {
        setFloatingPaste(null);
        return;
      }
      if (selectionStart && selectionEnd) {
        deleteSelectedPixels();
      }
      return;
    }

    // Enter key general handling (for floating paste)
    // Handle both standard Enter and NumpadEnter for wider keyboard support
    if (event.key === 'Enter' || event.code === 'NumpadEnter') {
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
  }, [enabled, allowedScopes, onBrushSizeDecrease, onBrushSizeIncrease, onPolygonComplete, 
      onPolygonCancel, onEnterPressed, onEscapePressed,
      tools, polygonGradientState, setCurrentTool, setGlobalBrushSize, setEraserSettings,
      deleteSelectedPixels, selectAllActiveLayerPixels, selectionStart, selectionEnd,
      floatingPaste, setFloatingPaste, setPaletteColor, swapPaletteColors]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    // Respect keyboard scope
    try {
      const currentScope = useAppStore.getState().ui.keyboardScope as KeyboardScope;
      if (!allowedScopes.includes(currentScope) && event.code !== 'Space') return;
    } catch {}


    // Update modifier states
    keyboardStateRef.current.isShiftPressed = event.shiftKey;
    keyboardStateRef.current.isCtrlPressed = event.ctrlKey;
    keyboardStateRef.current.isAltPressed = event.altKey;
    keyboardStateRef.current.isMetaPressed = event.metaKey;

    // Handle Space release
    if (event.code === 'Space' && onSpaceReleasedRef.current) {
      event.preventDefault();
      
      // Only process if space was actually pressed
      if (keyboardStateRef.current.isSpacePressed) {
        keyboardStateRef.current.isSpacePressed = false;
        pressedKeysRef.current.delete(event.code);
        void onSpaceReleasedRef.current?.();
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
        
        void onEraserReleasedRef.current?.();
        return;
      }
    }
  }, [enabled, allowedScopes, setCurrentTool]);

  // Handle window blur to reset state when window loses focus
  const handleBlur = useCallback(() => {
    // Reset keyboard state when window loses focus
    if (!document.hasFocus()) {
      // If space was pressed, release it
      if (keyboardStateRef.current.isSpacePressed) {
        keyboardStateRef.current.isSpacePressed = false;
        void onSpaceReleasedRef.current?.();
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
