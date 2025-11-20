import { useEffect, useRef, useCallback } from 'react';
import { useAppStore, type AppState } from '@/stores/useAppStore';
import { BrushShape, Tool } from '@/types';
import { flushPendingToolWork } from '@/utils/toolFlushRegistry';
import { useStoreSelectorRef } from './useStoreSelectorRef';
import {
  selectPolygonGradientState,
  selectToolsState,
} from '@/stores/selectors/toolsSelectors';

const MIN_BRUSH_SIZE = 1;
const MAX_BRUSH_SIZE = 500;

const clampBrushSize = (value: number): number => {
  if (value < MIN_BRUSH_SIZE) return MIN_BRUSH_SIZE;
  if (value > MAX_BRUSH_SIZE) return MAX_BRUSH_SIZE;
  return value;
};

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

const selectKeyboardScope = (state: AppState) => state.ui.keyboardScope.active as KeyboardScope;
const selectSelectionRange = (state: AppState) => ({
  start: state.selectionStart,
  end: state.selectionEnd,
});
const selectFloatingPaste = (state: AppState) => state.floatingPaste;
const selectPalette = (state: AppState) => state.palette;

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
  const colorPickerPreviousToolRef = useRef<Tool | null>(null);
  const isColorPickerHeldRef = useRef(false);
  const lastKeydownTimeRef = useRef<number>(0);

  const setCurrentTool = useAppStore((state) => state.setCurrentTool);
  const setGlobalBrushSize = useAppStore((state) => state.setGlobalBrushSize);
  const setCustomBrushSizePercent = useAppStore((state) => state.setCustomBrushSizePercent);
  const setEraserSettings = useAppStore((state) => state.setEraserSettings);
  const deleteSelectedPixels = useAppStore((state) => state.deleteSelectedPixels);
  const selectAllActiveLayerPixels = useAppStore((state) => state.selectAllActiveLayerPixels);
  const setFloatingPaste = useAppStore((state) => state.setFloatingPaste);
  const copySelectionToClipboard = useAppStore((state) => state.copySelectionToClipboard);
  const swapPaletteColors = useAppStore((state) => state.swapPaletteColors);
  const setPaletteColor = useAppStore((state) => state.setPaletteColor);
  const bufferedBrushSizeTargetRef = useRef<number | null>(null);
  const bufferedBrushSizeTimerRef = useRef<number | null>(null);
  const bufferedBrushSizeTimerKindRef = useRef<'idle' | 'timeout' | null>(null);

  const keyboardScopeRef = useStoreSelectorRef(selectKeyboardScope);
  const toolsRef = useStoreSelectorRef(selectToolsState);
  const polygonGradientStateRef = useStoreSelectorRef(selectPolygonGradientState);
  const selectionRangeRef = useStoreSelectorRef(selectSelectionRange);
  const floatingPasteRef = useStoreSelectorRef(selectFloatingPaste);
  const paletteRef = useStoreSelectorRef(selectPalette);

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

  const switchTool = useCallback(async (tool: Tool) => {
    await flushPendingToolWork();
    setCurrentTool(tool);
  }, [setCurrentTool]);
  const cancelBufferedBrushSizeTimer = useCallback(() => {
    if (bufferedBrushSizeTimerRef.current === null) {
      return;
    }
    if (
      typeof window !== 'undefined' &&
      bufferedBrushSizeTimerKindRef.current === 'idle' &&
      'cancelIdleCallback' in window
    ) {
      (window as Window & { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback?.(
        bufferedBrushSizeTimerRef.current
      );
    } else {
      clearTimeout(bufferedBrushSizeTimerRef.current);
    }
    bufferedBrushSizeTimerRef.current = null;
    bufferedBrushSizeTimerKindRef.current = null;
  }, []);

  const flushBufferedBrushSizeTarget = useCallback(() => {
    cancelBufferedBrushSizeTimer();
    const pendingSize = bufferedBrushSizeTargetRef.current;
    if (pendingSize == null) {
      return;
    }
    bufferedBrushSizeTargetRef.current = null;
    setGlobalBrushSize(pendingSize);
  }, [cancelBufferedBrushSizeTimer, setGlobalBrushSize]);

  const scheduleBufferedBrushSizeFlush = useCallback(() => {
    if (bufferedBrushSizeTimerRef.current !== null) {
      return;
    }
    if (typeof window === 'undefined') {
      flushBufferedBrushSizeTarget();
      return;
    }
    const idleWindow = window as Window & {
      requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number;
    };
    if (typeof idleWindow.requestIdleCallback === 'function') {
      bufferedBrushSizeTimerKindRef.current = 'idle';
      bufferedBrushSizeTimerRef.current = idleWindow.requestIdleCallback(
        () => {
          bufferedBrushSizeTimerRef.current = null;
          bufferedBrushSizeTimerKindRef.current = null;
          flushBufferedBrushSizeTarget();
        },
        { timeout: 180 }
      );
      return;
    }
    bufferedBrushSizeTimerKindRef.current = 'timeout';
    bufferedBrushSizeTimerRef.current = window.setTimeout(() => {
      bufferedBrushSizeTimerRef.current = null;
      bufferedBrushSizeTimerKindRef.current = null;
      flushBufferedBrushSizeTarget();
    }, 120);
  }, [flushBufferedBrushSizeTarget]);

  const applyBufferedBrushSizeDelta = useCallback((delta: number, options: { immediate?: boolean } = {}) => {
    if (delta === 0) {
      return;
    }

    const baseSize =
      bufferedBrushSizeTargetRef.current ??
      toolsRef.current.brushSettings.size ??
      MIN_BRUSH_SIZE;

    const nextSize = clampBrushSize(baseSize + delta);
    if (nextSize === baseSize && bufferedBrushSizeTargetRef.current === null) {
      return;
    }

    bufferedBrushSizeTargetRef.current = nextSize;

    if (options.immediate) {
      flushBufferedBrushSizeTarget();
      return;
    }

    scheduleBufferedBrushSizeFlush();
  }, [flushBufferedBrushSizeTarget, scheduleBufferedBrushSizeFlush, toolsRef]);
  
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

  const handleKeyDown = useCallback(async (event: KeyboardEvent) => {
    if (!enabled) return;

    lastKeydownTimeRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const isBracketShortcut = event.key === '[' || event.key === ']';
    const currentScope: KeyboardScope = keyboardScopeRef.current ?? 'canvas';
    const tools = toolsRef.current;
    const polygonGradientState = polygonGradientStateRef.current;
    const { start: selectionStart, end: selectionEnd } = selectionRangeRef.current;
    const floatingPaste = floatingPasteRef.current;
    const palette = paletteRef.current;

    const target = event.target as HTMLElement | null;
    const targetIsTextEntry = isTextEntryTarget(target);
    const allowBracketInNumericInput =
      targetIsTextEntry &&
      isBracketShortcut &&
      target instanceof HTMLInputElement &&
      target.type?.toLowerCase() === 'number';

    const isUndoShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey;
    const isRedoShortcut = (event.ctrlKey || event.metaKey) && (
      (event.key.toLowerCase() === 'z' && event.shiftKey) ||
      (event.key.toLowerCase() === 'y' && !event.shiftKey)
    );
    const isSaveShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';
    const isOpenShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o';

    if (isUndoShortcut) {
      event.preventDefault();
      void onUndoRef.current?.();
      return;
    }

    if (isRedoShortcut) {
      event.preventDefault();
      void onRedoRef.current?.();
      return;
    }

    if (isSaveShortcut) {
      event.preventDefault();
      void onSaveRef.current?.();
      return;
    }

    if (isOpenShortcut) {
      event.preventDefault();
      void onOpenRef.current?.();
      return;
    }

    const isCopyShortcut =
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'c' &&
      !event.shiftKey &&
      !event.altKey;

    if (isCopyShortcut) {
      const handled = await copySelectionToClipboard({ mode: 'copy' });
      if (handled) {
        event.preventDefault();
        return;
      }
    }

    const isCutShortcut =
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'x' &&
      !event.shiftKey &&
      !event.altKey;

    if (isCutShortcut) {
      const handled = await copySelectionToClipboard({ mode: 'cut' });
      if (handled) {
        event.preventDefault();
        return;
      }
    }

    const scopeAllowed = allowedScopes.includes(currentScope);
    if (!scopeAllowed && event.code !== 'Space' && !isBracketShortcut) {
      return;
    }

    // Ignore if typing in text-focused inputs or editable elements
    if (targetIsTextEntry && !allowBracketInNumericInput) {
      return;
    }

    // Allow shortcuts to run even if non-text form controls (sliders, checkboxes, selects) are focused.
    // Text inputs are already filtered above via isTextEntryTarget().

    // Update modifier states
    keyboardStateRef.current.isShiftPressed = event.shiftKey;
    keyboardStateRef.current.isCtrlPressed = event.ctrlKey;
    keyboardStateRef.current.isAltPressed = event.altKey;
    keyboardStateRef.current.isMetaPressed = event.metaKey;

    // Palette swap/copy shortcuts (X to swap, Shift+X to copy foreground to background)
    if (!event.repeat && event.code === 'KeyX' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (event.shiftKey) {
        setPaletteColor('background', palette.foregroundColor);
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

    // Handle Select All (Ctrl/Cmd + A)
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selectAllActiveLayerPixels();
      await switchTool('selection');
      return;
    }

    // Tool switching - C for custom brush
    if (event.key === 'c' || event.key === 'C') {
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        await switchTool('custom');
        void onCustomToolRef.current?.();
        return;
      }
    }

    // Tool switching - F for fill tool
    if (event.key === 'f' || event.key === 'F') {
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        await switchTool('fill');
        return;
      }
    }

    // Tool switching - B for brush tool
    if (event.key === 'b' || event.key === 'B') {
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        await switchTool('brush');
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
          try {
            await onEraserPressedRef.current?.();
          } catch {
            // ignore finalize errors; fall back to default behavior
          }
          const originTool = tools.currentTool;
          previousToolRef.current = originTool;
          isTemporaryEraserRef.current = true;
          await switchTool('eraser');
        } else {
          // Already in eraser mode, keep it
          isTemporaryEraserRef.current = false;
        }
        return;
      }
    }

    // Tool switching - M for selection tool (marquee)
    if (event.key === 'm' || event.key === 'M') {
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        await switchTool('selection');
        return;
      }
    }

    // Tool switching - P for color picker (temporary hold)
    if (event.key === 'p' || event.key === 'P') {
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();

        if (!isColorPickerHeldRef.current) {
          const currentTool = tools.currentTool as Tool;
          if (currentTool !== 'color-picker') {
            colorPickerPreviousToolRef.current = currentTool;
          }
        }

        isColorPickerHeldRef.current = true;
        await switchTool('color-picker');
        return;
      }
    }

    // Brush size adjustment
    if (event.key === '[') {
      event.preventDefault();
      if (onBrushSizeDecrease) {
        onBrushSizeDecrease();
      } else {
        const isEraserActive = tools.currentTool === 'eraser';
        const { brushSettings, eraserSettings } = tools;
        if (brushSettings.brushShape === BrushShape.CUSTOM) {
          const currentPercent = brushSettings.customBrushSizePercent ?? 100;
          const newPercent = Math.max(5, currentPercent - 5);
          setCustomBrushSizePercent(newPercent);
          if (isEraserActive && eraserSettings?.linkSizeToBrush === false) {
            const updatedSize = toolsRef.current.brushSettings.size ?? 1;
            setEraserSettings({ size: updatedSize });
          }
        } else {
          const currentSize = isEraserActive
            ? (eraserSettings?.size ?? brushSettings.size ?? MIN_BRUSH_SIZE)
            : (brushSettings.size ?? MIN_BRUSH_SIZE);
          const adjustment = 1;
          if (isEraserActive) {
            const newSize = Math.max(MIN_BRUSH_SIZE, currentSize - adjustment);
            setEraserSettings({ size: newSize });
          } else {
            applyBufferedBrushSizeDelta(-adjustment, { immediate: !event.repeat });
          }
        }
      }
      return;
    }

    if (event.key === ']') {
      event.preventDefault();
      if (onBrushSizeIncrease) {
        onBrushSizeIncrease();
      } else {
        const isEraserActive = tools.currentTool === 'eraser';
        const { brushSettings, eraserSettings } = tools;
        if (brushSettings.brushShape === BrushShape.CUSTOM) {
          const currentPercent = brushSettings.customBrushSizePercent ?? 100;
          const newPercent = Math.min(1000, currentPercent + 5);
          setCustomBrushSizePercent(newPercent);
          if (isEraserActive && eraserSettings?.linkSizeToBrush === false) {
            const updatedSize = toolsRef.current.brushSettings.size ?? 1;
            setEraserSettings({ size: updatedSize });
          }
        } else {
          const currentSize = isEraserActive
            ? (eraserSettings?.size ?? brushSettings.size ?? MIN_BRUSH_SIZE)
            : (brushSettings.size ?? MIN_BRUSH_SIZE);
          const adjustment = 1;
          if (isEraserActive) {
            const newSize = Math.min(MAX_BRUSH_SIZE, currentSize + adjustment);
            setEraserSettings({ size: newSize });
          } else {
            applyBufferedBrushSizeDelta(adjustment, { immediate: !event.repeat });
          }
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
      switchTool, setEraserSettings,
      setCustomBrushSizePercent,
      deleteSelectedPixels, selectAllActiveLayerPixels,
      copySelectionToClipboard,
      setFloatingPaste, setPaletteColor, swapPaletteColors,
      keyboardScopeRef, toolsRef, polygonGradientStateRef, selectionRangeRef,
      floatingPasteRef, paletteRef, applyBufferedBrushSizeDelta]);

  const handleKeyUp = useCallback(async (event: KeyboardEvent) => {
    if (!enabled) return;

    // Respect keyboard scope
    const currentScope: KeyboardScope = keyboardScopeRef.current ?? 'canvas';
    if (!allowedScopes.includes(currentScope) && event.code !== 'Space') {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (isTextEntryTarget(target)) {
      return;
    }
    // Allow non-text form controls to release keys normally so pressedKeys bookkeeping stays in sync.

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

    if (event.key === '[' || event.key === ']') {
      flushBufferedBrushSizeTarget();
      return;
    }

    // Handle P key release (temporary color picker)
    if ((event.key === 'p' || event.key === 'P') && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();

      if (isColorPickerHeldRef.current) {
        const previousTool = colorPickerPreviousToolRef.current;
        if (previousTool && previousTool !== 'color-picker') {
          await switchTool(previousTool);
        }
        isColorPickerHeldRef.current = false;
        colorPickerPreviousToolRef.current = null;
      }
      return;
    }

    // Handle E key release (for temporary eraser mode)
    if (event.key === 'e' || event.key === 'E') {
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        
        try {
          await onEraserReleasedRef.current?.();
        } catch {
          // ignore finalize errors on release
        }

        // Calculate hold duration
        const holdDuration = Date.now() - eraserPressTimeRef.current;
        const isQuickTap = holdDuration < 200; // Tap if held less than 200ms
        
        // If it was temporary mode and a hold (not a tap), restore previous tool
        if (isTemporaryEraserRef.current && previousToolRef.current && !isQuickTap) {
          // Restore previous tool
          await switchTool(previousToolRef.current as Tool);
          previousToolRef.current = null;
          isTemporaryEraserRef.current = false;
        } else if (isTemporaryEraserRef.current && isQuickTap) {
          // It was a tap - make eraser permanent
          previousToolRef.current = null;
          isTemporaryEraserRef.current = false;
        }
        return;
      }
    }
  }, [enabled, allowedScopes, switchTool, keyboardScopeRef, flushBufferedBrushSizeTarget]);

  // Handle window blur to reset state when window loses focus
  const handleBlur = useCallback(() => {
    // Reset keyboard state when window loses focus
    if (!document.hasFocus()) {
      // Always release space-driven interactions on blur
      keyboardStateRef.current.isSpacePressed = false;
      pressedKeysRef.current.delete('Space');
      void onSpaceReleasedRef.current?.();
      
      // Reset all states
      keyboardStateRef.current = {
        isSpacePressed: false,
        isShiftPressed: false,
        isCtrlPressed: false,
        isAltPressed: false,
        isMetaPressed: false,
      };
      pressedKeysRef.current.clear();

      if (isColorPickerHeldRef.current) {
        const previousTool = colorPickerPreviousToolRef.current;
        if (previousTool && previousTool !== 'color-picker') {
          void switchTool(previousTool);
        }
        isColorPickerHeldRef.current = false;
        colorPickerPreviousToolRef.current = null;
      }

      flushBufferedBrushSizeTarget();
    }
  }, [switchTool, flushBufferedBrushSizeTarget]);

  useEffect(() => {
    return () => {
      cancelBufferedBrushSizeTimer();
      flushBufferedBrushSizeTarget();
    };
  }, [cancelBufferedBrushSizeTimer, flushBufferedBrushSizeTarget]);

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
