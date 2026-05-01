import { getAppStoreState } from '@/stores/appStoreAccess';
import { useEffect, useRef, useCallback } from 'react';
import { useAppStore, type AppState } from '@/stores/useAppStore';
import { BrushShape, Tool } from '@/types';
import { flushPendingToolWork } from '@/utils/toolFlushRegistry';
import { useStoreSelectorRef } from './useStoreSelectorRef';
import {
  selectPolygonGradientState,
  selectToolsState,
} from '@/stores/selectors/toolsSelectors';
import {
  resolveAlwaysShortcutAction,
  resolveScopedShortcutAction,
} from '@/hooks/keyboard/shortcutRegistry';
import { logCCMutation, summarizeColorCycleLayer } from '@/utils/colorCycle/ccMutationAudit';

const MIN_BRUSH_SIZE = 1;
const MAX_BRUSH_SIZE = 500;
const BRUSH_SIZE_HOLD_INITIAL_DELAY_MS = 220;
const BRUSH_SIZE_HOLD_INTERVAL_MS = 60;

const clampBrushSize = (value: number): number => {
  if (value < MIN_BRUSH_SIZE) return MIN_BRUSH_SIZE;
  if (value > MAX_BRUSH_SIZE) return MAX_BRUSH_SIZE;
  return value;
};

const getLegacyKeyCode = (event: KeyboardEvent): number | null => {
  const legacyEvent = event as KeyboardEvent & { keyCode?: number; which?: number };
  if (typeof legacyEvent.keyCode === 'number' && legacyEvent.keyCode > 0) {
    return legacyEvent.keyCode;
  }
  if (typeof legacyEvent.which === 'number' && legacyEvent.which > 0) {
    return legacyEvent.which;
  }
  return null;
};

const isBracketLeftEvent = (event: KeyboardEvent): boolean => {
  const legacy = getLegacyKeyCode(event);
  return event.code === 'BracketLeft' || event.key === '[' || legacy === 219;
};

const isBracketRightEvent = (event: KeyboardEvent): boolean => {
  const legacy = getLegacyKeyCode(event);
  return event.code === 'BracketRight' || event.key === ']' || legacy === 221;
};

const getPressedKeyId = (event: KeyboardEvent): string => {
  if (isBracketLeftEvent(event)) {
    return 'BracketLeft';
  }
  if (isBracketRightEvent(event)) {
    return 'BracketRight';
  }
  return event.code || event.key;
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
type BracketShortcutTarget = 'brush-size' | 'cc-gradient-colors';

const selectKeyboardScope = (state: AppState) => state.ui.keyboardScope.active as KeyboardScope;
const selectSelectionRange = (state: AppState) => ({
  start: state.selectionStart,
  end: state.selectionEnd,
});
const selectFloatingPaste = (state: AppState) => state.floatingPaste;
const selectPalette = (state: AppState) => state.palette;
const selectCurrentBrushPresetId = (state: AppState) => state.currentBrushPreset?.id ?? null;
const selectShapeDrawingActive = (state: AppState) => state.shapeState.isDrawing;

const summarizeSelectionBounds = (
  start: { x: number; y: number } | null,
  end: { x: number; y: number } | null
) => {
  if (!start || !end) {
    return null;
  }
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
};

const logDeleteKeydownTrace = (
  event: KeyboardEvent,
  params: {
    currentScope: KeyboardScope;
    target: HTMLElement | null;
    targetIsTextEntry: boolean;
    floatingPasteActive: boolean;
  }
): void => {
  const state = getAppStoreState();
  const activeLayer = state.layers.find((layer) => layer.id === state.activeLayerId) ?? null;
  const activeLayerSummary = activeLayer?.layerType === 'color-cycle'
    ? summarizeColorCycleLayer(activeLayer)
    : null;
  logCCMutation({
    event: 'keyboard-delete-keydown',
    layerId: activeLayer?.id ?? 'no-active-layer',
    reason: 'context-delete',
    severity: 'info',
    before: activeLayerSummary,
    after: activeLayerSummary,
    details: {
      keydownTimestamp: Date.now(),
      key: event.key,
      code: event.code,
      repeat: event.repeat,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      currentScope: params.currentScope,
      targetTag: params.target?.tagName ?? null,
      targetType: params.target instanceof HTMLInputElement ? params.target.type : null,
      targetIsTextEntry: params.targetIsTextEntry,
      activeLayerId: activeLayer?.id ?? null,
      activeLayerName: activeLayer?.name ?? null,
      activeLayerType: activeLayer?.layerType ?? null,
      activeTool: state.tools.currentTool,
      selectionStart: state.selectionStart,
      selectionEnd: state.selectionEnd,
      selectionBounds: summarizeSelectionBounds(state.selectionStart, state.selectionEnd),
      selectionMaskBounds: state.selectionMaskBounds,
      selectionMaskLayerId: state.selectionMaskLayerId,
      selectionLastAction: state.selectionLastAction,
      floatingPasteActive: params.floatingPasteActive,
    },
  });
};

const clampCcGradientColors = (value: number): number => {
  if (value < 1) return 1;
  if (value > 16) return 16;
  return value;
};

const resolveBracketShortcutTarget = (
  currentTool: Tool,
  currentBrushPresetId: string | null
): BracketShortcutTarget => {
  if (currentTool === 'brush' && currentBrushPresetId === 'color-cycle-gradient') {
    return 'cc-gradient-colors';
  }
  return 'brush-size';
};

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
  const bracketHoldDirectionRef = useRef<-1 | 0 | 1>(0);
  const bracketHoldTargetRef = useRef<BracketShortcutTarget>('brush-size');
  const bracketHoldAnimationFrameRef = useRef<number | null>(null);
  const lastBracketHoldTickRef = useRef<number>(0);
  const bracketHoldStartedAtRef = useRef<number>(0);

  const setCurrentTool = useAppStore((state) => state.setCurrentTool);
  const bumpGlobalBrushSize = useAppStore((state) => state.bumpGlobalBrushSize);
  const setCustomBrushSizePercent = useAppStore((state) => state.setCustomBrushSizePercent);
  const setEraserSettings = useAppStore((state) => state.setEraserSettings);
  const deleteSelectedPixels = useAppStore((state) => state.deleteSelectedPixels);
  const selectAllActiveLayerPixels = useAppStore((state) => state.selectAllActiveLayerPixels);
  const setFloatingPaste = useAppStore((state) => state.setFloatingPaste);
  const copySelectionToClipboard = useAppStore((state) => state.copySelectionToClipboard);
  const swapPaletteColors = useAppStore((state) => state.swapPaletteColors);
  const setPaletteColor = useAppStore((state) => state.setPaletteColor);
  const setBrushSettings = useAppStore((state) => state.setBrushSettings);

  const keyboardScopeRef = useStoreSelectorRef(selectKeyboardScope);
  const toolsRef = useStoreSelectorRef(selectToolsState);
  const polygonGradientStateRef = useStoreSelectorRef(selectPolygonGradientState);
  const selectionRangeRef = useStoreSelectorRef(selectSelectionRange);
  const floatingPasteRef = useStoreSelectorRef(selectFloatingPaste);
  const paletteRef = useStoreSelectorRef(selectPalette);
  const currentBrushPresetIdRef = useStoreSelectorRef(selectCurrentBrushPresetId);
  const shapeDrawingActiveRef = useStoreSelectorRef(selectShapeDrawingActive);

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
  const applyBrushSizeDeltaImmediate = useCallback(
    (delta: number) => {
      if (delta === 0) {
        return;
      }
      const baseSize = toolsRef.current.brushSettings.size ?? MIN_BRUSH_SIZE;
      const nextSize = clampBrushSize(baseSize + delta);
      if (nextSize === baseSize) {
        return;
      }
      bumpGlobalBrushSize(delta);
    },
    [bumpGlobalBrushSize, toolsRef]
  );
  const applyBrushSizeDeltaForCurrentTool = useCallback((delta: -1 | 1) => {
    const tools = toolsRef.current;
    const isEraserActive = tools.currentTool === 'eraser';
    const { brushSettings, eraserSettings } = tools;
    if (isEraserActive) {
      const isLinked = eraserSettings?.linkSizeToBrush !== false;
      if (isLinked) {
        applyBrushSizeDeltaImmediate(delta);
      } else {
        const currentSize = eraserSettings?.size ?? brushSettings.size ?? MIN_BRUSH_SIZE;
        const newSize = clampBrushSize(currentSize + delta);
        if (newSize !== currentSize) {
          setEraserSettings({ size: newSize });
        }
      }
      return;
    }

    if (brushSettings.brushShape === BrushShape.CUSTOM) {
      const currentPercent = brushSettings.customBrushSizePercent ?? 100;
      const nextPercent = Math.max(5, Math.min(1000, currentPercent + delta * 5));
      if (nextPercent !== currentPercent) {
        setCustomBrushSizePercent(nextPercent);
      }
      return;
    }

    applyBrushSizeDeltaImmediate(delta);
  }, [applyBrushSizeDeltaImmediate, setCustomBrushSizePercent, setEraserSettings, toolsRef]);

  const applyBracketShortcutStep = useCallback((target: BracketShortcutTarget, delta: -1 | 1) => {
    if (target === 'cc-gradient-colors') {
      const current = toolsRef.current.brushSettings.gradientBands ?? 16;
      const next = clampCcGradientColors(current + delta);
      if (next !== current) {
        setBrushSettings({ gradientBands: next });
      }
      return;
    }

    applyBrushSizeDeltaForCurrentTool(delta);
  }, [applyBrushSizeDeltaForCurrentTool, setBrushSettings, toolsRef]);

  const stopBracketHold = useCallback(() => {
    bracketHoldDirectionRef.current = 0;
    lastBracketHoldTickRef.current = 0;
    bracketHoldStartedAtRef.current = 0;
    if (bracketHoldAnimationFrameRef.current !== null) {
      cancelAnimationFrame(bracketHoldAnimationFrameRef.current);
      bracketHoldAnimationFrameRef.current = null;
    }
  }, []);

  const startBracketHold = useCallback((target: BracketShortcutTarget, direction: -1 | 1) => {
    bracketHoldTargetRef.current = target;
    bracketHoldDirectionRef.current = direction;
    if (bracketHoldAnimationFrameRef.current !== null) {
      return;
    }
    bracketHoldStartedAtRef.current = 0;

    const step = (timestamp: number) => {
      const activeDirection = bracketHoldDirectionRef.current;
      if (activeDirection === 0) {
        bracketHoldAnimationFrameRef.current = null;
        return;
      }

      if (bracketHoldStartedAtRef.current === 0) {
        bracketHoldStartedAtRef.current = timestamp;
      }

      const holdElapsed = timestamp - bracketHoldStartedAtRef.current;
      const shouldRepeat =
        holdElapsed >= BRUSH_SIZE_HOLD_INITIAL_DELAY_MS &&
        (lastBracketHoldTickRef.current === 0 ||
          timestamp - lastBracketHoldTickRef.current >= BRUSH_SIZE_HOLD_INTERVAL_MS);

      if (shouldRepeat) {
        lastBracketHoldTickRef.current = timestamp;
        applyBracketShortcutStep(bracketHoldTargetRef.current, activeDirection);
      }

      bracketHoldAnimationFrameRef.current = requestAnimationFrame(step);
    };

    bracketHoldAnimationFrameRef.current = requestAnimationFrame(step);
  }, [applyBracketShortcutStep]);
  
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

    const isBracketShortcut = isBracketLeftEvent(event) || isBracketRightEvent(event);
    const scopedShortcut = resolveScopedShortcutAction(event);
    const currentScope: KeyboardScope = keyboardScopeRef.current ?? 'canvas';
    const tools = toolsRef.current;
    const polygonGradientState = polygonGradientStateRef.current;
    const { start: selectionStart, end: selectionEnd } = selectionRangeRef.current;
    const floatingPaste = floatingPasteRef.current;
    const palette = paletteRef.current;

    const target = event.target as HTMLElement | null;
    const targetIsTextEntry = isTextEntryTarget(target);
    const allowBracketInTextEntry = targetIsTextEntry && isBracketShortcut;

    const alwaysShortcut = resolveAlwaysShortcutAction(event);
    if (alwaysShortcut === 'undo') {
      event.preventDefault();
      void onUndoRef.current?.();
      return;
    }
    if (alwaysShortcut === 'redo') {
      event.preventDefault();
      void onRedoRef.current?.();
      return;
    }
    if (alwaysShortcut === 'save') {
      event.preventDefault();
      void onSaveRef.current?.();
      return;
    }
    if (alwaysShortcut === 'open') {
      event.preventDefault();
      void onOpenRef.current?.();
      return;
    }
    if (alwaysShortcut === 'copy') {
      const handled = await copySelectionToClipboard({ mode: 'copy' });
      if (handled) {
        event.preventDefault();
        return;
      }
    }
    if (alwaysShortcut === 'cut') {
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

    const isFloatingPasteKey =
      !!floatingPaste &&
      (scopedShortcut === 'context-enter' ||
        scopedShortcut === 'context-escape' ||
        scopedShortcut === 'context-delete');

    // Ignore if typing in text-focused inputs or editable elements.
    // Exception: allow floating-paste commit/cancel keys so paste can be finalized
    // even when focus remains in a numeric/text input control.
    if (targetIsTextEntry && !allowBracketInTextEntry && !isFloatingPasteKey) {
      return;
    }

    // Allow shortcuts to run even if non-text form controls (sliders, checkboxes, selects) are focused.
    // Text inputs are already filtered above via isTextEntryTarget().

    // Update modifier states
    keyboardStateRef.current.isShiftPressed = event.shiftKey;
    keyboardStateRef.current.isCtrlPressed = event.ctrlKey;
    keyboardStateRef.current.isAltPressed = event.altKey;
    keyboardStateRef.current.isMetaPressed = event.metaKey;

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

    const pressedKeyId = getPressedKeyId(event);
    if (pressedKeysRef.current.has(pressedKeyId)) {
      if (isBracketShortcut) {
        event.preventDefault();
      }
      return;
    }
    pressedKeysRef.current.add(pressedKeyId);

    if (scopedShortcut === 'palette-copy' || scopedShortcut === 'palette-swap') {
      event.preventDefault();
      if (scopedShortcut === 'palette-copy') {
        setPaletteColor('background', palette.foregroundColor);
      } else {
        swapPaletteColors();
      }
      return;
    }

    if (scopedShortcut === 'select-all') {
      event.preventDefault();
      selectAllActiveLayerPixels('keyboard-select-all');
      await switchTool('selection');
      return;
    }

    if (scopedShortcut === 'tool-custom') {
      event.preventDefault();
      await switchTool('custom');
      void onCustomToolRef.current?.();
      return;
    }
    if (scopedShortcut === 'tool-fill') {
      event.preventDefault();
      await switchTool('fill');
      return;
    }
    if (scopedShortcut === 'tool-magic-wand') {
      event.preventDefault();
      getAppStoreState().setSelectionMode('magic-wand');
      await switchTool('selection');
      return;
    }
    if (scopedShortcut === 'tool-brush') {
      event.preventDefault();
      await switchTool('brush');
      return;
    }
    if (scopedShortcut === 'tool-eraser-hold') {
      event.preventDefault();
      eraserPressTimeRef.current = Date.now();
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
        isTemporaryEraserRef.current = false;
      }
      return;
    }
    if (scopedShortcut === 'tool-selection') {
      event.preventDefault();
      await switchTool('selection');
      return;
    }
    if (scopedShortcut === 'tool-color-adjust') {
      event.preventDefault();
      await switchTool('color-adjust');
      return;
    }
    if (scopedShortcut === 'tool-color-picker-hold') {
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

    if (isBracketShortcut) {
      const bracketTarget = resolveBracketShortcutTarget(
        tools.currentTool,
        currentBrushPresetIdRef.current
      );
      const direction: -1 | 1 = isBracketLeftEvent(event) ? -1 : 1;
      if (bracketTarget !== 'brush-size') {
        event.preventDefault();
        if (shapeDrawingActiveRef.current) {
          return;
        }
        applyBracketShortcutStep(bracketTarget, direction);
        startBracketHold(bracketTarget, direction);
        return;
      }
    }

    const isBrushSizeDecreaseShortcut =
      scopedShortcut === 'brush-size-decrease' ||
      isBracketLeftEvent(event);
    if (isBrushSizeDecreaseShortcut) {
      event.preventDefault();
      if (onBrushSizeDecrease) {
        onBrushSizeDecrease();
      } else {
        applyBrushSizeDeltaForCurrentTool(-1);
        startBracketHold('brush-size', -1);
      }
      return;
    }

    const isBrushSizeIncreaseShortcut =
      scopedShortcut === 'brush-size-increase' ||
      isBracketRightEvent(event);
    if (isBrushSizeIncreaseShortcut) {
      event.preventDefault();
      if (onBrushSizeIncrease) {
        onBrushSizeIncrease();
      } else {
        applyBrushSizeDeltaForCurrentTool(1);
        startBracketHold('brush-size', 1);
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
      if (scopedShortcut === 'context-enter') {
        event.preventDefault();
        void onPolygonComplete?.();
        return;
      }
      if (scopedShortcut === 'context-escape') {
        event.preventDefault();
        onPolygonCancel?.();
        return;
      }
    }

    // Delete key for deleting selected pixels
    if (scopedShortcut === 'context-delete') {
      logDeleteKeydownTrace(event, {
        currentScope,
        target,
        targetIsTextEntry,
        floatingPasteActive: Boolean(floatingPaste),
      });
      event.preventDefault();
      if (floatingPaste) {
        setFloatingPaste(null);
        return;
      }
      if (selectionStart && selectionEnd) {
        deleteSelectedPixels('keyboard-delete');
      }
      return;
    }

    // Enter key general handling (for floating paste)
    // Handle both standard Enter and NumpadEnter for wider keyboard support
    if (scopedShortcut === 'context-enter') {
      event.preventDefault();
      onEnterPressed?.();
      return;
    }
    
    // Escape key general handling
    if (scopedShortcut === 'context-escape') {
      event.preventDefault();
      onEscapePressed?.();
      return;
    }
  }, [enabled, allowedScopes, onBrushSizeDecrease, onBrushSizeIncrease, onPolygonComplete, 
      onPolygonCancel, onEnterPressed, onEscapePressed,
      switchTool,
      deleteSelectedPixels, selectAllActiveLayerPixels,
      copySelectionToClipboard,
      setFloatingPaste, setPaletteColor, swapPaletteColors,
      keyboardScopeRef, toolsRef, polygonGradientStateRef, selectionRangeRef,
      floatingPasteRef, paletteRef, currentBrushPresetIdRef, shapeDrawingActiveRef, startBracketHold, applyBracketShortcutStep,
      applyBrushSizeDeltaForCurrentTool]);

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
        pressedKeysRef.current.delete(getPressedKeyId(event));
        void onSpaceReleasedRef.current?.();
      }
      return;
    }
    
    // Always clear pressed map on keyup (even if text field prevented us earlier)
    const pressedKeyId = getPressedKeyId(event);
    pressedKeysRef.current.delete(pressedKeyId);

    if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
      stopBracketHold();
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
  }, [enabled, allowedScopes, stopBracketHold, switchTool, keyboardScopeRef]);

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
      stopBracketHold();

      if (isColorPickerHeldRef.current) {
        const previousTool = colorPickerPreviousToolRef.current;
        if (previousTool && previousTool !== 'color-picker') {
          void switchTool(previousTool);
        }
        isColorPickerHeldRef.current = false;
        colorPickerPreviousToolRef.current = null;
      }
    }
  }, [stopBracketHold, switchTool]);

  // Safety net: clear stuck keys if the page becomes hidden or pointer leaves the window
  useEffect(() => {
    const clearAllKeys = () => {
      const hadSpaceDown = keyboardStateRef.current.isSpacePressed || pressedKeysRef.current.has('Space');
      if (hadSpaceDown) {
        void onSpaceReleasedRef.current?.();
      }
      pressedKeysRef.current.clear();
      keyboardStateRef.current.isSpacePressed = false;
      stopBracketHold();
    };

    const handleVisibility = () => {
      if (document.hidden) {
        clearAllKeys();
      }
    };

    const handlePointerLeave = () => clearAllKeys();

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [stopBracketHold]);

  useEffect(() => {
    return () => {
      stopBracketHold();
    };
  }, [stopBracketHold]);

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
