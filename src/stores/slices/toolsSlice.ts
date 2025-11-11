import type { StateCreator } from 'zustand';
import type {
  BrushSettings,
  ToolState,
  CustomBrush,
  BrushComponent,
  BrushPreset,
  PolygonGradientState,
  BrushEditorState,
  PaletteState,
  Tool,
} from '@/types';
import { BrushShape } from '@/types';
import {
  brushPresets,
  applyBrushPreset,
  defaultBrushSettings,
  pixelBrushPreset,
} from '@/presets/brushPresets';
import {
  PressureSettings,
  applyPressureToTools,
  applyPressureUpdate,
  clampPressurePercent,
  clampCustomBrushPercent,
  quantizeCustomBrushPercent,
  pixelsFromCustomPercent,
  percentFromPixelSize,
  cloneGradientStops,
  gradientsEqual,
  findStoredColorCycleGradient,
  isColorCyclePresetId,
  isColorCycleBrushShape,
} from '@/stores/helpers/toolsState';
import { getDefaultMaxPressurePercent } from '@/utils/pressureSettings';
import { applyPaletteSnapshot } from '@/stores/helpers/paletteState';
import { brushCache } from '@/utils/brushCache';
import { scaledBrushCache } from '@/utils/scaledBrushCache';
import { adjustHueLightnessSaturation } from '@/utils/imageProcessing';
import { debugLog } from '@/utils/debug';
import { createDefaultColorAdjustState } from '@/stores/slices/colorAdjustSlice';

type AppState = import('../useAppStore').AppState;
type RecolorSamplingState = AppState['recolorSampling'];

const initialBrushPreset = pixelBrushPreset;
const { settings: defaultPresetSettings } = applyBrushPreset(initialBrushPreset);

export const defaultBrushSettingsForStore: BrushSettings = {
  ...defaultBrushSettings,
  ...defaultPresetSettings,
};

const createDefaultEraserSettings = (): BrushSettings => ({
  ...defaultBrushSettingsForStore,
  blendMode: 'destination-out',
  color: 'rgba(255, 255, 255, 0.1)',
  linkSizeToBrush: true,
});

export const createDefaultToolState = (): ToolState => ({
  currentTool: 'brush',
  previousTool: 'brush',
  lastRegularTool: 'brush',
  lastRegularBrushShape: BrushShape.SQUARE,
  lastRegularShapeMode: false,
  lastColorCycleShapeMode: false,
  brushSettings: { ...defaultBrushSettingsForStore },
  eraserSettings: createDefaultEraserSettings(),
  fillSettings: {
    threshold: 0,
    contiguous: true,
    eraseInstead: false,
  },
  shapeMode: false,
  customBrushCapture: {
    sampleAllLayers: false,
  },
});

export const defaultBrushEditorState: BrushEditorState = {
  status: 'IDLE',
  editingBrushId: null,
  editingBounds: null,
  originalCanvasState: null,
  hueShift: 0,
  lightness: 0,
  saturation: 100,
};

export const createDefaultPolygonGradientState = (): PolygonGradientState => ({
  drawingState: 'idle',
  points: [],
  previewPath: undefined,
  rotationReferenceAngle: undefined,
  rotationInitialRotation: undefined,
  tempSize: undefined,
  sizeReferenceDistance: undefined,
  sizeInitialSize: undefined,
  spacingReferenceDistance: undefined,
  spacingReferenceSpacing: undefined,
  flowRandomSeed: undefined,
  mode: undefined,
  tempRotation: undefined,
  tempSpacing: undefined,
  tempMaxSteps: undefined,
  tempOrientation: undefined,
  tempNoiseStrength: undefined,
  gpuJobId: undefined,
  vertices: undefined,
  fillColor: undefined,
  adjustmentStartPos: undefined,
});

export const createDefaultRecolorSamplingState = (): RecolorSamplingState => ({
  active: false,
  start: null,
  end: null,
  samples: 12,
  target: 'recolor',
});

export const defaultPressureSettings: PressureSettings = {
  enabled: Boolean(defaultBrushSettingsForStore.pressureEnabled),
  min: clampPressurePercent(defaultBrushSettingsForStore.minPressure ?? 100),
  max: clampPressurePercent(
    defaultBrushSettingsForStore.maxPressure ??
      getDefaultMaxPressurePercent(defaultBrushSettingsForStore.brushShape)
  ),
};

const getSerializableBrushSettings = (settings: BrushSettings): Partial<BrushSettings> => ({
  size: settings.size,
  opacity: settings.opacity,
  spacing: settings.spacing,
  colorJitter: settings.colorJitter,
  risographIntensity: settings.risographIntensity,
  ditherEnabled: settings.ditherEnabled,
  fillResolution: settings.fillResolution,
  rotationEnabled: settings.rotationEnabled,
  dashedEnabled: settings.dashedEnabled,
  dashLength: settings.dashLength,
  dashGap: settings.dashGap,
  gridSnapEnabled: settings.gridSnapEnabled,
  shapeEnabled: settings.shapeEnabled,
  antialiasing: settings.antialiasing,
  colors: settings.colors,
  colorCycleSpeed: settings.colorCycleSpeed,
  colorCycleGradient: settings.colorCycleGradient,
  colorCycleFPS: settings.colorCycleFPS,
  colorCycleFlowMode: settings.colorCycleFlowMode,
  gradientBands: settings.gradientBands,
  colorCycleBandSpacingPx: settings.colorCycleBandSpacingPx,
});

const COLOR_ADJUST_TOOL: Tool = 'color-adjust';
const SHAPE_CAPABLE_TOOLS: Tool[] = ['brush', 'custom'];
const isShapeCapableTool = (tool?: Tool | null): boolean => {
  if (!tool) {
    return false;
  }
  return SHAPE_CAPABLE_TOOLS.includes(tool);
};

export interface ToolsSlice {
  tools: ToolState;
  globalBrushSize: number;
  pressureSettings: PressureSettings;
  brushPresets: BrushPreset[];
  currentBrushPreset: BrushPreset | null;
  activeBrushComponents: BrushComponent[];
  temporaryCustomBrush: CustomBrush | null;
  polygonGradientState: PolygonGradientState;
  recolorSampling: RecolorSamplingState;
  brushEditor: BrushEditorState;
  brushSpecificSettings: Record<string, Partial<BrushSettings>>;
  setPressureSettings: (settings: Partial<PressureSettings>) => void;
  setGlobalBrushSize: (size: number) => void;
  setCustomBrushSizePercent: (percent: number) => void;
  setBrushSettings: (settings: Partial<BrushSettings>) => void;
  setEraserSettings: (settings: Partial<BrushSettings>) => void;
  setFillSettings: (settings: Partial<ToolState['fillSettings']>) => void;
  setShapeMode: (enabled: boolean) => void;
  setCustomBrushSampleAllLayers: (sampleAllLayers: boolean) => void;
  setCurrentTool: (tool: Tool) => void;
  setTemporaryCustomBrush: (brush: CustomBrush | null) => void;
  setPolygonGradientState: (partial: Partial<PolygonGradientState>) => void;
  addPolygonGradientPoint: (x: number, y: number, color: string) => void;
  clearPolygonGradientPoints: () => void;
  startRecolorSampling: (samples?: number, target?: 'recolor' | 'brush') => void;
  updateRecolorSampling: (partial: Partial<RecolorSamplingState>) => void;
  stopRecolorSampling: () => void;
  setBrushPreset: (preset: BrushPreset, preserveEditMode?: boolean) => void;
  getBrushPresets: () => BrushPreset[];
  getBrushPresetById: (id: string) => BrushPreset | undefined;
  removeBrushPreset: (presetId: string) => void;
  startBrushEdit: (brushId: string, canvas: HTMLCanvasElement) => void;
  saveBrushEdit: (canvas: HTMLCanvasElement) => void;
  cancelBrushEdit: (canvas?: HTMLCanvasElement | null) => void;
  setBrushEditorHue: (hue: number) => void;
  setBrushEditorLightness: (lightness: number) => void;
  setBrushEditorSaturation: (saturation: number) => void;
  updateCurrentBrushTip: (brushTip: {
    imageData: ImageData;
    brushId: string;
    isColorizable: boolean;
    width?: number;
    height?: number;
  }) => void;
  refreshCurrentBrushTipFromSource: () => void;
  _saveCurrentBrushSettings: () => void;
  saveBrushSettings: (brushId: string, settings: Partial<BrushSettings>) => void;
  loadBrushSettings: (brushId: string) => Partial<BrushSettings>;
  clearBrushSettings: (brushId: string) => void;
}

export const createToolsSlice: StateCreator<AppState, [], [], ToolsSlice> = (set, get) => ({
  tools: createDefaultToolState(),
  globalBrushSize: defaultBrushSettingsForStore.size ?? 5,
  pressureSettings: defaultPressureSettings,
  brushPresets,
  currentBrushPreset: initialBrushPreset,
  activeBrushComponents: initialBrushPreset.components,
  temporaryCustomBrush: null,
  setTemporaryCustomBrush: (brush) => set({ temporaryCustomBrush: brush }),
  polygonGradientState: createDefaultPolygonGradientState(),
  recolorSampling: createDefaultRecolorSamplingState(),
  brushEditor: defaultBrushEditorState,
  brushSpecificSettings: {},

  setPressureSettings: (updates) => {
    set((state) => {
      const nextPressure = applyPressureUpdate(state.pressureSettings, updates);
      return {
        pressureSettings: nextPressure,
        tools: applyPressureToTools(state.tools, nextPressure),
      };
    });
  },

  setGlobalBrushSize: (size) => {
    set((state) => {
      const nextSize = Math.max(1, Math.round(size));
      const brushSettings: BrushSettings = {
        ...state.tools.brushSettings,
        size: nextSize,
      };

      if (brushSettings.brushShape === BrushShape.CUSTOM) {
        const derivedPercent = percentFromPixelSize(nextSize, state, brushSettings);
        if (derivedPercent !== null) {
          brushSettings.customBrushSizePercent = quantizeCustomBrushPercent(derivedPercent);
        } else if (brushSettings.customBrushSizePercent === undefined) {
          brushSettings.customBrushSizePercent = 100;
        }
      } else {
        brushSettings.customBrushSizePercent = undefined;
      }

      const shouldSyncEraser = state.tools.eraserSettings.linkSizeToBrush !== false;
      const eraserSettings = shouldSyncEraser
        ? { ...state.tools.eraserSettings, size: nextSize }
        : state.tools.eraserSettings;

      return {
        globalBrushSize: nextSize,
        tools: {
          ...state.tools,
          brushSettings,
          eraserSettings,
        },
      };
    });
  },

  setCustomBrushSizePercent: (percent) => {
    set((state) => {
      const tools = state.tools;
      const quantized = quantizeCustomBrushPercent(clampCustomBrushPercent(percent));
      const brushSettings = tools.brushSettings;
      let pixelSize = brushSettings.size ?? state.globalBrushSize ?? 1;

      if (brushSettings.brushShape === BrushShape.CUSTOM) {
        const computed = pixelsFromCustomPercent(quantized, state, brushSettings);
        if (computed !== null) {
          pixelSize = computed;
        }
      } else {
        pixelSize = Math.max(1, Math.round(percent));
      }

      const nextBrushSettings: BrushSettings = {
        ...brushSettings,
        size: pixelSize,
        customBrushSizePercent:
          brushSettings.brushShape === BrushShape.CUSTOM ? quantized : undefined,
      };

      const shouldSyncEraser = tools.eraserSettings.linkSizeToBrush !== false;
      const updatedEraserSettings = shouldSyncEraser
        ? { ...tools.eraserSettings, size: pixelSize }
        : tools.eraserSettings;

      return {
        globalBrushSize: pixelSize,
        tools: {
          ...tools,
          brushSettings: nextBrushSettings,
          eraserSettings: updatedEraserSettings,
        },
      };
    });
  },
  setBrushSettings: (incomingSettings) => {
    let pendingPalette: PaletteState | null = null;
    set((state) => {
    // quiet
    try {
    const settings = {
      ...incomingSettings,
    } as Partial<BrushSettings> & { colorCycleFlowForward?: boolean };

    let incomingCustomPercent: number | undefined;
    if (Object.prototype.hasOwnProperty.call(settings, 'customBrushSizePercent')) {
      const rawPercent = settings.customBrushSizePercent;
      if (rawPercent !== undefined && rawPercent !== null) {
        const numericPercent = Number(rawPercent);
        if (Number.isFinite(numericPercent)) {
          incomingCustomPercent = numericPercent;
        }
      }
      delete settings.customBrushSizePercent;
    }

    const pressureUpdates: Partial<PressureSettings> = {};
    let hasPressureUpdate = false;

    if (Object.prototype.hasOwnProperty.call(settings, 'pressureEnabled')) {
      const value = settings.pressureEnabled;
      if (value !== undefined) {
        pressureUpdates.enabled = Boolean(value);
        hasPressureUpdate = true;
      }
      delete settings.pressureEnabled;
    }

    if (Object.prototype.hasOwnProperty.call(settings, 'minPressure')) {
      const value = settings.minPressure;
      if (value !== undefined) {
        pressureUpdates.min = Number(value);
        hasPressureUpdate = true;
      }
      delete settings.minPressure;
    }

    if (Object.prototype.hasOwnProperty.call(settings, 'maxPressure')) {
      const value = settings.maxPressure;
      if (value !== undefined) {
        pressureUpdates.max = Number(value);
        hasPressureUpdate = true;
      }
      delete settings.maxPressure;
    }

    const nextPressure = hasPressureUpdate
      ? applyPressureUpdate(state.pressureSettings, pressureUpdates)
      : state.pressureSettings;

    if (settings.colorCycleFlowForward !== undefined) {
      settings.colorCycleFlowMode = settings.colorCycleFlowForward === false ? 'reverse' : 'forward';
      delete settings.colorCycleFlowForward;
    }

    const currentSettings = state.tools.brushSettings;
    let newSettings = { ...currentSettings, ...settings };

    const nextBrushShape = settings.brushShape ?? currentSettings.brushShape;
    if (nextBrushShape === BrushShape.CUSTOM) {
      let percentToApply = incomingCustomPercent;

      if (percentToApply === undefined && typeof settings.size === 'number') {
        const derived = percentFromPixelSize(
          settings.size,
          state,
          { ...newSettings, brushShape: nextBrushShape }
        );
        if (derived !== null) {
          percentToApply = derived;
        }
      }

      if (percentToApply === undefined && typeof newSettings.customBrushSizePercent === 'number') {
        percentToApply = newSettings.customBrushSizePercent;
      }

      if (percentToApply === undefined) {
        const baseSize = typeof newSettings.size === 'number'
          ? newSettings.size
          : state.globalBrushSize ?? 1;
        const derived = percentFromPixelSize(baseSize, state, newSettings);
        percentToApply = derived ?? 100;
      }

      percentToApply = quantizeCustomBrushPercent(clampCustomBrushPercent(percentToApply));
      const computedSize =
        pixelsFromCustomPercent(
          percentToApply,
          state,
          {
            ...newSettings,
            brushShape: nextBrushShape,
            customBrushSizePercent: percentToApply
          }
        ) ?? (typeof newSettings.size === 'number' ? newSettings.size : state.globalBrushSize ?? 1);

      newSettings = {
        ...newSettings,
        brushShape: nextBrushShape,
        size: Math.max(1, Math.round(computedSize)),
        customBrushSizePercent: percentToApply
      };
    } else {
      if (incomingCustomPercent !== undefined && Number.isFinite(incomingCustomPercent)) {
        const fallbackSize = Math.max(1, Math.round(incomingCustomPercent));
        newSettings = { ...newSettings, size: fallbackSize };
      }
      newSettings = {
        ...newSettings,
        customBrushSizePercent: undefined,
        brushShape: nextBrushShape
      };
    }

    newSettings = {
      ...newSettings,
      pressureEnabled: nextPressure.enabled,
      minPressure: nextPressure.min,
      maxPressure: nextPressure.max,
    };
    const explicitGradientVersion = settings.colorCycleGradientVersion;
    if (settings.colorCycleGradient !== undefined && explicitGradientVersion === undefined) {
      const gradientChanged = !gradientsEqual(
        currentSettings.colorCycleGradient,
        settings.colorCycleGradient
      );
      if (gradientChanged) {
        newSettings.colorCycleGradientVersion =
          (currentSettings.colorCycleGradientVersion ?? 0) + 1;
      } else if (currentSettings.colorCycleGradientVersion !== undefined) {
        newSettings.colorCycleGradientVersion = currentSettings.colorCycleGradientVersion;
      }
    } else if (explicitGradientVersion !== undefined) {
      newSettings.colorCycleGradientVersion = explicitGradientVersion;
    } else if (
      newSettings.colorCycleGradientVersion === undefined &&
      currentSettings.colorCycleGradientVersion !== undefined
    ) {
      newSettings.colorCycleGradientVersion = currentSettings.colorCycleGradientVersion;
    }
    
    // Auto-save brush-specific settings when they change (excluding size)
    // Determine current brush ID (standard brush preset or custom brush)
    const currentBrushId = state.currentBrushPreset 
      ? state.currentBrushPreset.id 
      : (currentSettings.brushShape === BrushShape.CUSTOM && currentSettings.selectedCustomBrush 
         ? currentSettings.selectedCustomBrush 
         : null);
         
    // Store brush settings to save for later
    let brushSettingsToSave: { brushId: string; settings: Partial<BrushSettings> } | null = null;
    
    if (currentBrushId) {
      // Get existing saved settings for this brush
      const existingSavedSettings = state.brushSpecificSettings[currentBrushId] || {};
      
      // Merge with new settings
      const settingsToSave: Partial<BrushSettings> = {
        ...existingSavedSettings
      };

      delete settingsToSave.pressureEnabled;
      delete settingsToSave.minPressure;
      delete settingsToSave.maxPressure;
      
      // Update with changed settings
      if (settings.opacity !== undefined) settingsToSave.opacity = newSettings.opacity;
      if (settings.spacing !== undefined) settingsToSave.spacing = newSettings.spacing;
      if (settings.colorJitter !== undefined) settingsToSave.colorJitter = newSettings.colorJitter;
      if (settings.risographIntensity !== undefined) settingsToSave.risographIntensity = newSettings.risographIntensity;
      if (settings.ditherEnabled !== undefined) settingsToSave.ditherEnabled = newSettings.ditherEnabled;
      if (settings.colorCycleStampDitherEnabled !== undefined) {
        settingsToSave.colorCycleStampDitherEnabled = newSettings.colorCycleStampDitherEnabled;
      }
      if (settings.colorCycleStampDitherPixelSize !== undefined) {
        settingsToSave.colorCycleStampDitherPixelSize = newSettings.colorCycleStampDitherPixelSize;
      }
      if (settings.fillResolution !== undefined) settingsToSave.fillResolution = newSettings.fillResolution;
      if (settings.rotationEnabled !== undefined) settingsToSave.rotationEnabled = newSettings.rotationEnabled;
      if (settings.dashedEnabled !== undefined) settingsToSave.dashedEnabled = newSettings.dashedEnabled;
      if (settings.dashLength !== undefined) settingsToSave.dashLength = newSettings.dashLength;
      if (settings.dashGap !== undefined) settingsToSave.dashGap = newSettings.dashGap;
      if (settings.gridSnapEnabled !== undefined) settingsToSave.gridSnapEnabled = newSettings.gridSnapEnabled;
      if (settings.shapeEnabled !== undefined) settingsToSave.shapeEnabled = newSettings.shapeEnabled;
      if (settings.antialiasing !== undefined) settingsToSave.antialiasing = newSettings.antialiasing;
      if (settings.hueShift !== undefined) settingsToSave.hueShift = newSettings.hueShift;
      if (settings.lightnessAdjust !== undefined) settingsToSave.lightnessAdjust = newSettings.lightnessAdjust;
      if (settings.saturationAdjust !== undefined) settingsToSave.saturationAdjust = newSettings.saturationAdjust;
      if (settings.colors !== undefined) settingsToSave.colors = newSettings.colors;
      if (settings.rectGradientPresetId !== undefined) settingsToSave.rectGradientPresetId = newSettings.rectGradientPresetId;
      if (settings.continuousSampling !== undefined) settingsToSave.continuousSampling = newSettings.continuousSampling;
      if (settings.resampleInterval !== undefined) settingsToSave.resampleInterval = newSettings.resampleInterval;
      if (settings.colorCycleGradient !== undefined) {
        settingsToSave.colorCycleGradient = newSettings.colorCycleGradient;
      }
      if (settings.colorCycleFlowMode !== undefined) {
        settingsToSave.colorCycleFlowMode = newSettings.colorCycleFlowMode;
      }
      if (
        settings.colorCycleGradient !== undefined ||
        settings.colorCycleGradientVersion !== undefined
      ) {
        settingsToSave.colorCycleGradientVersion = newSettings.colorCycleGradientVersion;
      }
      
      brushSettingsToSave = { brushId: currentBrushId, settings: settingsToSave };
    }
    
    // Handle brush-specific resource cleanup when switching between custom and regular brushes
    if (newSettings.brushShape !== undefined) {
      const wasCustom = currentSettings.brushShape === BrushShape.CUSTOM;
      const isCustom = newSettings.brushShape === BrushShape.CUSTOM;

      if (wasCustom && !isCustom) {
        // Clear stale custom brush tip data when switching away from custom brushes
        newSettings.currentBrushTip = undefined;
        newSettings.selectedCustomBrush = null;
      }

      if (wasCustom !== isCustom) {
        try {
          brushCache.clear();
          scaledBrushCache.clear();
        } catch {
          // Cache cleanup failed, continue silently
        }
      }
    }
    
    // CRITICAL: Always clear currentBrushTip for standard brushes to prevent contamination
    // But ONLY if we're not in the process of setting it to CUSTOM with a currentBrushTip
    if (newSettings.brushShape !== BrushShape.CUSTOM && !settings.currentBrushTip) {
      newSettings.currentBrushTip = undefined;
      newSettings.selectedCustomBrush = null;
    }
    
    // Keep brush editor adjustments in sync while editing
    let nextBrushEditor = state.brushEditor;
    if (state.brushEditor.status === 'EDITING') {
      const nextHueShift = settings.hueShift !== undefined
        ? settings.hueShift
        : newSettings.hueShift !== undefined
          ? newSettings.hueShift
          : state.brushEditor.hueShift;
      const nextLightness = settings.lightnessAdjust !== undefined
        ? settings.lightnessAdjust
        : newSettings.lightnessAdjust !== undefined
          ? newSettings.lightnessAdjust
          : state.brushEditor.lightness;
      const nextSaturation = settings.saturationAdjust !== undefined
        ? settings.saturationAdjust
        : newSettings.saturationAdjust !== undefined
          ? newSettings.saturationAdjust
          : state.brushEditor.saturation;

      if (
        nextHueShift !== state.brushEditor.hueShift ||
        nextLightness !== state.brushEditor.lightness ||
        nextSaturation !== state.brushEditor.saturation
      ) {
        nextBrushEditor = {
          ...state.brushEditor,
          hueShift: nextHueShift,
          lightness: nextLightness,
          saturation: nextSaturation
        };
      }
    }
    
    // Clear temporary brush when switching away from custom brushes
    let updatedState = {
      ...state,
      tools: {
        ...state.tools,
        brushSettings: newSettings
      },
      globalBrushSize:
        typeof newSettings.size === 'number' ? newSettings.size : state.globalBrushSize,
      pressureSettings: nextPressure
    };

    updatedState = {
      ...updatedState,
      tools: applyPressureToTools(updatedState.tools, nextPressure)
    };

    if (nextBrushEditor !== state.brushEditor) {
      updatedState = {
        ...updatedState,
        brushEditor: nextBrushEditor
      };
    }
    
    
    // Apply brush settings save if needed (avoid circular dependency)
    if (brushSettingsToSave) {
      updatedState = {
        ...updatedState,
        brushSpecificSettings: {
          ...updatedState.brushSpecificSettings,
          [brushSettingsToSave.brushId]: brushSettingsToSave.settings
        }
      };
    }
    
    if (newSettings.color !== currentSettings.color) {
      pendingPalette = {
        ...state.palette,
        foregroundColor: newSettings.color ?? state.palette.foregroundColor,
      };
    }
    
    // If switching away from custom brush, discard temporary brush
    if (newSettings.brushShape !== undefined && 
        currentSettings.brushShape === BrushShape.CUSTOM && 
        newSettings.brushShape !== BrushShape.CUSTOM) {
      return {
        ...updatedState,
        temporaryCustomBrush: null
      };
    }
    
    return updatedState;
    } catch (error) {
      debugLog('brush-error', 'Failed to apply brush settings', error);
      // Return state unchanged on failure to prevent app crash
      return state;
    }
  });

    if (pendingPalette) {
      applyPaletteSnapshot(set, get, pendingPalette);
    }
  },
  setEraserSettings: (incomingSettings) => {
    let pendingPalette: PaletteState | null = null;
    set((state) => {
      const settings = { ...incomingSettings } as Partial<BrushSettings>;

    const pressureUpdates: Partial<PressureSettings> = {};
    let hasPressureUpdate = false;

    if (Object.prototype.hasOwnProperty.call(settings, 'pressureEnabled')) {
      const value = settings.pressureEnabled;
      if (value !== undefined) {
        pressureUpdates.enabled = Boolean(value);
        hasPressureUpdate = true;
      }
      delete settings.pressureEnabled;
    }

    if (Object.prototype.hasOwnProperty.call(settings, 'minPressure')) {
      const value = settings.minPressure;
      if (value !== undefined) {
        pressureUpdates.min = Number(value);
        hasPressureUpdate = true;
      }
      delete settings.minPressure;
    }

    if (Object.prototype.hasOwnProperty.call(settings, 'maxPressure')) {
      const value = settings.maxPressure;
      if (value !== undefined) {
        pressureUpdates.max = Number(value);
        hasPressureUpdate = true;
      }
      delete settings.maxPressure;
    }

    const nextPressure = hasPressureUpdate
      ? applyPressureUpdate(state.pressureSettings, pressureUpdates)
      : state.pressureSettings;

    const next = {
      ...state.tools.eraserSettings,
      ...settings,
      pressureEnabled: nextPressure.enabled,
      minPressure: nextPressure.min,
      maxPressure: nextPressure.max,
    };
    if (settings.linkSizeToBrush === true) {
      const syncSize = state.globalBrushSize ?? next.size;
      if (typeof syncSize === 'number') {
        next.size = syncSize;
      }
    }
    let paletteUpdate: PaletteState | null = null;
    if (
      settings.color !== undefined &&
      state.palette.activeSlot === 'foreground' &&
      state.tools.currentTool === 'eraser' &&
      state.palette.foregroundColor !== settings.color
    ) {
      paletteUpdate = {
        ...state.palette,
        foregroundColor: settings.color
      };
    }

    const baseTools: ToolState = {
      ...state.tools,
      eraserSettings: next,
      brushSettings: paletteUpdate
        ? { ...state.tools.brushSettings, color: paletteUpdate.foregroundColor }
        : state.tools.brushSettings
    };

    const nextTools = applyPressureToTools(baseTools, nextPressure);
    const baseReturn = {
      tools: nextTools,
      pressureSettings: nextPressure,
    };
    if (!paletteUpdate) {
      return baseReturn;
    }

    pendingPalette = paletteUpdate;
    return baseReturn;
  });

    if (pendingPalette) {
      applyPaletteSnapshot(set, get, pendingPalette);
    }
  },
  setFillSettings: (settings) => set((state) => ({
    tools: {
      ...state.tools,
      fillSettings: { ...state.tools.fillSettings, ...settings }
    }
  })),
  setCustomBrushSampleAllLayers: (sampleAllLayers) =>
    set((state) => {
      const currentCapture = state.tools.customBrushCapture ?? { sampleAllLayers: false };
      if (currentCapture.sampleAllLayers === sampleAllLayers) {
        return state;
      }
      return {
        tools: {
          ...state.tools,
          customBrushCapture: {
            ...currentCapture,
            sampleAllLayers,
          },
        },
      };
    }),
  setShapeMode: (enabled) => set((state) => {
    try {
      // Gate noisy logs behind debug toggle
      debugLog('shape-store', 'setShapeMode', {
        enabled,
        prev: state.tools.shapeMode,
        tool: state.tools.currentTool,
        brushShape: state.tools.brushSettings.brushShape,
        selectedCustomBrush: state.tools.brushSettings.selectedCustomBrush,
      });
    } catch {}

    const isCC = state.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE ||
                  state.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE ||
                  state.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
    return {
      tools: {
        ...state.tools,
        shapeMode: enabled,
        // Persist per-domain shape mode memories so switching brushes restores expected state
        ...(isCC ? { lastColorCycleShapeMode: enabled } : { lastRegularShapeMode: enabled })
      }
    };
  }),
  setCurrentTool: (tool) => {
    const stateBeforeSwitch = get();
    stateBeforeSwitch._saveCurrentBrushSettings();
    const shapeFillSession = stateBeforeSwitch.shapeFill.session;
    const isShapeFillActive =
      !!shapeFillSession &&
      stateBeforeSwitch.tools.currentTool === 'brush' &&
      stateBeforeSwitch.tools.brushSettings.brushShape === BrushShape.SHAPE_FILL;
    const toolChanged = tool !== stateBeforeSwitch.tools.currentTool;

    if (isShapeFillActive && toolChanged) {
      stateBeforeSwitch.cancelShapeFillSession();
    }

    if (tool === 'custom') {
      const currentState = get();
      if (currentState.temporaryCustomBrush) {
        get().setTemporaryCustomBrush(null);
      }
      if (currentState.selectionStart || currentState.selectionEnd) {
        get().clearSelection();
      }
    }

    if (stateBeforeSwitch.tools.currentTool === 'crop' && tool !== 'crop') {
      get().resetCrop();
    }

    try {
      set((state) => {
        const newBrushSettings = { ...state.tools.brushSettings };
        const wasShapeFillBrush = state.tools.brushSettings.brushShape === BrushShape.SHAPE_FILL;
        const currentToolSupportsShapes = isShapeCapableTool(state.tools.currentTool);
        const nextToolSupportsShapes = isShapeCapableTool(tool);
        const isCurrentColorCycleBrush = isColorCycleBrushShape(state.tools.brushSettings.brushShape);

        let lastRegularTool = state.tools.lastRegularTool;
        let lastRegularBrushShape = state.tools.lastRegularBrushShape;
        let lastRegularShapeMode = state.tools.lastRegularShapeMode;
        let lastColorCycleShapeMode = state.tools.lastColorCycleShapeMode;

        if ((state.tools.currentTool === 'brush' || state.tools.currentTool === 'eraser') &&
            tool !== 'brush' && tool !== 'eraser') {
          lastRegularTool = state.tools.currentTool;
          lastRegularBrushShape = state.tools.brushSettings.brushShape;
        }

        if (state.tools.currentTool === 'custom' && tool !== 'custom' && tool !== 'brush') {
          newBrushSettings.brushShape = BrushShape.ROUND;
          newBrushSettings.selectedCustomBrush = null;
        }

        if (tool === 'custom') {
          newBrushSettings.currentBrushTip = undefined;
        }

        let newShapeMode = state.tools.shapeMode;
        if (wasShapeFillBrush && tool !== 'brush') {
          newShapeMode = false;
        }

        if (currentToolSupportsShapes && !nextToolSupportsShapes) {
          if (isCurrentColorCycleBrush) {
            lastColorCycleShapeMode = state.tools.shapeMode;
          } else {
            lastRegularShapeMode = state.tools.shapeMode;
          }
          newShapeMode = false;
        } else if (!currentToolSupportsShapes && nextToolSupportsShapes) {
          const nextIsColorCycleBrush = isColorCycleBrushShape(newBrushSettings.brushShape);
          newShapeMode = nextIsColorCycleBrush
            ? (lastColorCycleShapeMode ?? false)
            : (lastRegularShapeMode ?? false);
        }

        if ((state.tools.currentTool === 'brush' || state.tools.currentTool === 'eraser' || state.tools.currentTool === 'custom') &&
            tool !== 'brush' && tool !== 'eraser' && tool !== 'custom') {
          newShapeMode = false;
          get().setPolygonGradientState({
            drawingState: 'idle',
            points: [],
            vertices: undefined,
            fillColor: undefined,
          });
          get().setRectangleBrushState({
            drawingState: 'idle',
            startPos: { x: 0, y: 0 },
            endPos: { x: 0, y: 0 }
          });
        }

        const pressure = state.pressureSettings;
        const syncedBrushSettings = {
          ...newBrushSettings,
          pressureEnabled: pressure.enabled,
          minPressure: pressure.min,
          maxPressure: pressure.max,
        };

        const nextTools = applyPressureToTools(
          {
            ...state.tools,
            previousTool: state.tools.currentTool,
            currentTool: tool,
            lastRegularTool,
            lastRegularBrushShape,
            lastRegularShapeMode,
            lastColorCycleShapeMode,
            brushSettings: syncedBrushSettings,
            shapeMode: newShapeMode,
          },
          pressure
        );

        return {
          tools: nextTools,
        };
      });
    } catch {}

    if (tool === COLOR_ADJUST_TOOL) {
      const store = get();
      if (!store.colorAdjust.active || toolChanged) {
        store.startColorAdjustSession();
      }
    } else if (stateBeforeSwitch.tools.currentTool === COLOR_ADJUST_TOOL) {
      const store = get();
      if (stateBeforeSwitch.colorAdjust?.active) {
        store.cancelColorAdjust();
      } else {
        set({ colorAdjust: createDefaultColorAdjustState() });
      }
    }
  },
  
  setPolygonGradientState: (partialState) => set((state) => ({
    polygonGradientState: { ...state.polygonGradientState, ...partialState }
  })),
  addPolygonGradientPoint: (x, y, color) => set((state) => ({
    polygonGradientState: {
      ...state.polygonGradientState,
      points: [...state.polygonGradientState.points, { x, y, color }]
    }
  })),
  clearPolygonGradientPoints: () => set((state) => ({
    polygonGradientState: {
      ...state.polygonGradientState,
      points: [],
      previewPath: undefined
    }
  })),

  startRecolorSampling: (samples = 12, target = 'recolor') => {
    const clampedSamples = Math.max(2, Math.min(64, Math.round(samples)));
    set(() => ({
      recolorSampling: {
        active: true,
        start: null,
        end: null,
        samples: clampedSamples,
        target,
      },
    }));
  },
  updateRecolorSampling: (partial) =>
    set((state) => ({
      recolorSampling: {
        ...state.recolorSampling,
        ...partial,
      },
    })),
  stopRecolorSampling: () =>
    set(() => ({ recolorSampling: createDefaultRecolorSamplingState() })),

  setBrushPreset: (preset, preserveEditMode = false) => {
    const stateBeforeSwitch = get();
    // Save current settings before switching
    stateBeforeSwitch._saveCurrentBrushSettings();

    if (
      stateBeforeSwitch.shapeFill.session &&
      stateBeforeSwitch.tools.brushSettings.brushShape === BrushShape.SHAPE_FILL &&
      stateBeforeSwitch.currentBrushPreset?.id !== preset.id
    ) {
      stateBeforeSwitch.cancelShapeFillSession();
    }
    
    // Cancel any active brush edit session before switching (unless preserveEditMode is true)
    const state = get();
    if (state.brushEditor.status === 'EDITING' && !preserveEditMode) {
      const canvas = state.currentOffscreenCanvas;
      if (canvas) {
        get().cancelBrushEdit(canvas);
      }
    }

    set((state) => {
    // --- THIS IS THE NEW, ROBUST REPLACEMENT ---
    let userOverrides = get().loadBrushSettings(preset.id);
    if (userOverrides) {
      userOverrides = { ...userOverrides };
      delete userOverrides.size;
      delete userOverrides.pressureEnabled;
      delete userOverrides.minPressure;
      delete userOverrides.maxPressure;
    }
    const { settings: presetDefaults, components } = applyBrushPreset(preset, userOverrides);
    const currentSettings = state.tools.brushSettings;
    let updatedBrushSpecificSettings = state.brushSpecificSettings;


    // Always start from the current global size; fall back to preset default only if undefined
    const presetSuggestedSize =
      typeof presetDefaults.size === 'number' ? presetDefaults.size : undefined;
    const fallbackSize =
      presetSuggestedSize ?? defaultBrushSettingsForStore.size ?? 5;
    const appropriateSize =
      typeof state.globalBrushSize === 'number' ? state.globalBrushSize : fallbackSize;

    let newBrushSettings: BrushSettings = {
      ...defaultBrushSettingsForStore, // 1. Start with the absolute base defaults.
      ...presetDefaults,               // 2. Apply the preset settings (which now includes user overrides).
      
      // 3. Finally, preserve the settings that carry over between any brush.
      color: currentSettings.color,
      blendMode: currentSettings.blendMode,
      size: appropriateSize            // Use appropriate size based on brush type
    };

    const globalPressure = state.pressureSettings;
    newBrushSettings = {
      ...newBrushSettings,
      pressureEnabled: globalPressure.enabled,
      minPressure: globalPressure.min,
      maxPressure: globalPressure.max,
    };

    // Preserve Color Cycle dynamics across preset switches unless user changes them
    // This keeps animation feel consistent between Color Cycle variants
    if (currentSettings.colorCycleSpeed !== undefined) {
      newBrushSettings.colorCycleSpeed = currentSettings.colorCycleSpeed;
    }
    if (currentSettings.colorCycleFlowMode !== undefined) {
      newBrushSettings.colorCycleFlowMode = currentSettings.colorCycleFlowMode;
    }
    if (currentSettings.colorCycleFPS !== undefined) {
      newBrushSettings.colorCycleFPS = currentSettings.colorCycleFPS;
    }
    if (currentSettings.colorCycleFillMode !== undefined) {
      newBrushSettings.colorCycleFillMode = currentSettings.colorCycleFillMode;
    }

    const previousGradient = currentSettings.colorCycleGradient;
    const previousGradientVersion = currentSettings.colorCycleGradientVersion;
    const storedGradientEntry = findStoredColorCycleGradient(state.brushSpecificSettings);
    const shouldApplyColorCycleGradient = isColorCycleBrushShape(newBrushSettings.brushShape);

    if (shouldApplyColorCycleGradient) {
      const gradientSource = previousGradient && previousGradient.length > 0
        ? previousGradient
        : storedGradientEntry?.gradient;
      const gradientVersionSource = previousGradient && previousGradient.length > 0
        ? previousGradientVersion
        : storedGradientEntry?.version;

      if (gradientSource && gradientSource.length > 0) {
        const gradientClone = cloneGradientStops(gradientSource);
        if (gradientClone && gradientClone.length > 0) {
          newBrushSettings.colorCycleGradient = gradientClone;
          if (typeof gradientVersionSource === 'number') {
            newBrushSettings.colorCycleGradientVersion = gradientVersionSource;
          }

          if (isColorCyclePresetId(preset.id)) {
            const existingSettings = state.brushSpecificSettings[preset.id] || {};
            updatedBrushSpecificSettings = {
              ...updatedBrushSpecificSettings,
              [preset.id]: {
                ...existingSettings,
                colorCycleGradient: cloneGradientStops(gradientSource),
                ...(typeof gradientVersionSource === 'number'
                  ? { colorCycleGradientVersion: gradientVersionSource }
                  : existingSettings.colorCycleGradientVersion !== undefined
                    ? { colorCycleGradientVersion: existingSettings.colorCycleGradientVersion }
                    : {})
              }
            };
          }
        }
      }
    }

    // Handle custom brush presets specifically
    if (preset.isCustomBrush) {
      const customBrushId = preset.id.startsWith('custom_') ? preset.id.substring(7) : preset.id;
      
      newBrushSettings.brushShape = BrushShape.CUSTOM;
      newBrushSettings.selectedCustomBrush = customBrushId;
      newBrushSettings.useSwatchColor = false;
      newBrushSettings.hueShift = 0;
      newBrushSettings.lightnessAdjust = 0;
      newBrushSettings.saturationAdjust = 100;
      
      // CRITICAL FIX: Load the custom brush data into currentBrushTip
      // The issue was that custom brushes selected from the library weren't
      // properly loading their imageData into currentBrushTip
      
      // First check temporary custom brush
      let customBrush = state.temporaryCustomBrush && state.temporaryCustomBrush.id === customBrushId 
        ? state.temporaryCustomBrush 
        : null;

      if (!customBrush) {
        customBrush = state.getCustomBrushById(customBrushId);
      }
      
      // IMPORTANT: Always use preset.customBrushData as the primary source
      // This ensures custom brushes loaded from BrushLibrary work correctly
      if (preset.customBrushData) {
        const data = preset.customBrushData;
        // Create/update the custom brush object with preset data
        customBrush = {
          id: customBrushId,
          name: preset.name,
          imageData: data.imageData,
          width: data.width,
          height: data.height,
          naturalWidth: data.width,
          naturalHeight: data.height,
          maxDimension: Math.max(data.width, data.height),
          thumbnail: preset.thumbnail || '',
          createdAt: customBrush?.createdAt || Date.now()
        };
      }
      
      if (customBrush) {
        newBrushSettings.currentBrushTip = {
          imageData: customBrush.imageData,
          brushId: customBrush.id,
          isColorizable: false,
          width: customBrush.width,
          height: customBrush.height,
          naturalWidth: customBrush.naturalWidth ?? customBrush.width,
          naturalHeight: customBrush.naturalHeight ?? customBrush.height,
          maxDimension: customBrush.maxDimension ?? Math.max(customBrush.width, customBrush.height)
        };
      } else {
        
      }
    }
    
    // Handle brush resource cleanup and brush tip state when switching between custom and regular brushes
    if (presetDefaults.brushShape !== undefined) {
      const wasCustom = currentSettings.brushShape === BrushShape.CUSTOM;
      const isCustom = presetDefaults.brushShape === BrushShape.CUSTOM;

      if (wasCustom && !isCustom) {
        newBrushSettings.currentBrushTip = undefined;
        newBrushSettings.selectedCustomBrush = null;
      }

      if (wasCustom !== isCustom) {
        try {
          // Clear only brush-specific caches, preserve other caches for performance
          brushCache.clear();
          scaledBrushCache.clear();
        } catch {
          // Cache cleanup failed, continue silently
        }
      }
    }
    
    // Force antialiasing off for spam brush (disables shape mode)
    if (newBrushSettings.brushShape === BrushShape.SPAM_TEXT) {
      newBrushSettings.antialiasing = false;
    }

    // Explicitly enforce Color Cycle variant selection
    // Some UI sequences may briefly override the shape; guard here by preset id
    if (preset.id === 'color-cycle-shape') {
      newBrushSettings.brushShape = BrushShape.COLOR_CYCLE_SHAPE;
    } else if (preset.id === 'color-cycle-stroke') {
      newBrushSettings.brushShape = BrushShape.COLOR_CYCLE;
    }
    
    // Decide shapeMode based on brush domain (Color Cycle vs regular)
    const isNewCC = newBrushSettings.brushShape === BrushShape.COLOR_CYCLE ||
                    newBrushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE ||
                    newBrushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
    const wasShapeFillBrush = state.tools.brushSettings.brushShape === BrushShape.SHAPE_FILL;
    const isShapeFillBrush = newBrushSettings.brushShape === BrushShape.SHAPE_FILL;

    let nextShapeMode: boolean;
    if (isShapeFillBrush) {
      nextShapeMode = true;
    } else if (isNewCC) {
      // Respect explicit CC variant presets; otherwise restore last CC shape mode
      if (preset.id === 'color-cycle-shape') {
        nextShapeMode = true;
      } else if (preset.id === 'color-cycle-stroke') {
        nextShapeMode = false;
      } else {
        nextShapeMode = state.tools.lastColorCycleShapeMode ?? state.tools.shapeMode ?? false;
      }
    } else {
      // Non-CC brushes should not inherit CC shape mode
      nextShapeMode = wasShapeFillBrush ? false : state.tools.lastRegularShapeMode ?? false;
    }

    // Clear temporary brush when switching away from custom brushes
    const brushSpecificSettingsChanged = updatedBrushSpecificSettings !== state.brushSpecificSettings;

    const updatedState = {
      ...state,
      ...(brushSpecificSettingsChanged ? { brushSpecificSettings: updatedBrushSpecificSettings } : {}),
      currentBrushPreset: preset,
      activeBrushComponents: components,
      globalBrushSize: appropriateSize, // Update global size to match new brush
      tools: {
        ...state.tools,
        // Keep shapeMode separate between CC and default brushes
        shapeMode: nextShapeMode,
        ...(isNewCC
          ? { lastColorCycleShapeMode: nextShapeMode }
          : { lastRegularShapeMode: nextShapeMode }
        ),
        brushSettings: newBrushSettings
      }
    };

    const pressureSyncedState = {
      ...updatedState,
      pressureSettings: globalPressure,
      tools: applyPressureToTools(updatedState.tools, globalPressure)
    };
    
    // If switching away from custom brush, discard temporary brush
    if (presetDefaults.brushShape !== undefined && 
        currentSettings.brushShape === BrushShape.CUSTOM && 
        presetDefaults.brushShape !== BrushShape.CUSTOM) {
      return {
        ...pressureSyncedState,
        temporaryCustomBrush: null
      };
    }
    
    return pressureSyncedState;
    });
  },
  getBrushPresets: () => brushPresets,
  getBrushPresetById: (id) => brushPresets.find((preset) => preset.id === id),
  removeBrushPreset: (presetId) => set((state) => {
    // Don't allow deletion of default presets
    const presetToDelete = state.brushPresets.find(p => p.id === presetId);
    if (!presetToDelete || presetToDelete.isDefault) return state;
    
    const newPresets = state.brushPresets.filter(p => p.id !== presetId);
    
    // If deleting the currently active preset, switch to default
    let newCurrentPreset = state.currentBrushPreset;
    if (state.currentBrushPreset?.id === presetId) {
      newCurrentPreset = newPresets.find(p => p.isDefault) || newPresets[0] || null;
    }
    
    return {
      brushPresets: newPresets,
      currentBrushPreset: newCurrentPreset
    };
  }),
  
  startBrushEdit: (brushId, canvas) => set((state) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as (CanvasRenderingContext2D | null);
    if (!ctx) {
      return state;
    }

    let brushData: CustomBrush | null = null;

    // First, try to find in custom brushes
    brushData = state.getCustomBrushById(brushId);

    // If not found in custom brushes, check default brush presets
    if (!brushData) {
      const defaultBrush = brushPresets.find(b => b.id === brushId);
      if (defaultBrush) {
        // Generate temporary image data for the default brush
        const tempCanvas = document.createElement('canvas');
        const size = 32; // Default editing size for brush presets
        tempCanvas.width = size;
        tempCanvas.height = size;
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as (CanvasRenderingContext2D | null);
        if (tempCtx) {
          // Create a simple black brush shape based on the preset
          tempCtx.fillStyle = '#000000';
          if (defaultBrush.id === 'pixel-brush' || defaultBrush.id.includes('pixel')) {
            // Square pixel brush
            tempCtx.fillRect(0, 0, size, size);
          } else if (defaultBrush.id.includes('square')) {
            // Square brush
            tempCtx.fillRect(0, 0, size, size);
          } else {
            // Round brush (default)
            tempCtx.beginPath();
            tempCtx.arc(size/2, size/2, size/2, 0, Math.PI * 2);
            tempCtx.fill();
          }
          
          // Create temporary brush data
          brushData = {
            id: brushId,
            name: defaultBrush.name,
            imageData: tempCtx.getImageData(0, 0, size, size),
            thumbnail: tempCanvas.toDataURL(),
            width: size,
            height: size,
            createdAt: Date.now()
          };
        }
      }
    }

    // If still no brush found, exit
    if (!brushData) {
      return state;
    }

    // Calculate centered bounds using the actual canvas dimensions
    const brushWidth = brushData.imageData.width;
    const brushHeight = brushData.imageData.height;
    
    // Get the canvas dimensions - if it's the offscreen canvas, use project dimensions
    const canvasWidth = state.project?.width || canvas.width;
    const canvasHeight = state.project?.height || canvas.height;
    
    const centerX = Math.floor((canvasWidth - brushWidth) / 2);
    const centerY = Math.floor((canvasHeight - brushHeight) / 2);
    
    const bounds = { x: centerX, y: centerY, width: brushWidth, height: brushHeight };

    // Create an empty ImageData for originalCanvasState since we're not modifying the main canvas
    // This is just to satisfy the type requirements and prevent errors
    const originalCanvasState = ctx.createImageData(bounds.width, bounds.height);
    
    // NOTE: We don't draw the brush onto the main canvas here
    // The BrushEditorUI panel renders and manages its own off-main canvas

    // Automatically select the brush being edited
    const targetSize = typeof state.globalBrushSize === 'number'
      ? state.globalBrushSize
      : 100;
    const newBrushSettings = {
      ...state.tools.brushSettings,
      brushShape: BrushShape.CUSTOM,
      selectedCustomBrush: brushId,
      currentBrushTip: {
        imageData: brushData.imageData,
        brushId: brushId,
        isColorizable: false,
        width: brushData.width,
        height: brushData.height
      },
      size: targetSize
    };
    
    // Clear caches to ensure fresh brush data
    brushCache.clear();
    scaledBrushCache.clear();
    
    const preserveAdjustments =
      state.brushEditor.status === 'EDITING' && state.brushEditor.editingBrushId === brushId;

    const nextHueShift = preserveAdjustments ? state.brushEditor.hueShift : 0;
    const nextLightness = preserveAdjustments ? state.brushEditor.lightness : 0;
    const nextSaturation = preserveAdjustments ? state.brushEditor.saturation : 100;

    return {
      brushEditor: {
        status: 'EDITING' as const,
        editingBrushId: brushId,
        editingBounds: bounds,
        originalCanvasState,
        hueShift: nextHueShift,  // Preserve adjustments when reloading the same brush
        lightness: nextLightness,
        saturation: nextSaturation,
        editingBrushData: brushData // Store the brush data for reference
      },
      tools: {
        ...state.tools,
        brushSettings: newBrushSettings
      },
      globalBrushSize: targetSize
    };
  }),
  saveBrushEdit: (canvas) => {
    const state = get();
    if (
      state.brushEditor.status !== 'EDITING' ||
      !state.brushEditor.editingBounds ||
      !state.brushEditor.editingBrushId
    ) {
      return;
    }

    const ctx = canvas.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings
    ) as CanvasRenderingContext2D | null;
    if (!ctx) {
      return;
    }

    const bounds = state.brushEditor.editingBounds;
    const brushId = state.brushEditor.editingBrushId;

    const editedImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const thumbnailSize = 64;
    let thumbnail = '';
    if (typeof document !== 'undefined') {
      const thumbnailCanvas = document.createElement('canvas');
      thumbnailCanvas.width = thumbnailSize;
      thumbnailCanvas.height = thumbnailSize;
      const thumbnailCtx = thumbnailCanvas.getContext(
        '2d',
        { willReadFrequently: true } as CanvasRenderingContext2DSettings
      ) as CanvasRenderingContext2D | null;

      if (thumbnailCtx) {
        const scale = Math.min(thumbnailSize / canvas.width, thumbnailSize / canvas.height);
        const scaledWidth = canvas.width * scale;
        const scaledHeight = canvas.height * scale;
        const offsetX = (thumbnailSize - scaledWidth) / 2;
        const offsetY = (thumbnailSize - scaledHeight) / 2;

        thumbnailCtx.clearRect(0, 0, thumbnailSize, thumbnailSize);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d', {
          willReadFrequently: true,
        } as CanvasRenderingContext2DSettings);

        if (tempCtx) {
          tempCtx.putImageData(editedImageData, 0, 0);
          thumbnailCtx.drawImage(
            tempCanvas,
            0,
            0,
            bounds.width,
            bounds.height,
            offsetX,
            offsetY,
            scaledWidth,
            scaledHeight
          );
        }

        thumbnail = thumbnailCanvas.toDataURL();
      }
    }

    const existingCustomBrush = state.getCustomBrushById(brushId);
    let targetCustomBrushId: string;
    let targetBrush: CustomBrush | null = null;

    if (existingCustomBrush) {
      const updatedBrush: CustomBrush = {
        ...existingCustomBrush,
        imageData: editedImageData,
        thumbnail,
        width: canvas.width,
        height: canvas.height,
        naturalWidth: canvas.width,
        naturalHeight: canvas.height,
        maxDimension: Math.max(canvas.width, canvas.height),
      };
      state.updateCustomBrush(brushId, {
        imageData: editedImageData,
        thumbnail,
        width: canvas.width,
        height: canvas.height,
        naturalWidth: canvas.width,
        naturalHeight: canvas.height,
        maxDimension: Math.max(canvas.width, canvas.height),
      });
      targetCustomBrushId = updatedBrush.id;
      targetBrush = updatedBrush;
    } else {
      const defaultBrush = brushPresets.find((b) => b.id === brushId);
      const newCustomBrushId = `custom-${brushId}-${Date.now()}`;
      const newCustomBrush: CustomBrush = {
        id: newCustomBrushId,
        name: `Custom ${defaultBrush?.name || 'Brush'}`,
        imageData: editedImageData,
        thumbnail,
        width: canvas.width,
        height: canvas.height,
        createdAt: Date.now(),
        naturalWidth: canvas.width,
        naturalHeight: canvas.height,
        maxDimension: Math.max(canvas.width, canvas.height),
      };
      state.addCustomBrush(newCustomBrush);
      targetCustomBrushId = newCustomBrushId;
      targetBrush = newCustomBrush;
    }

    brushCache.clear();
    scaledBrushCache.clear();

    set((current) => {
      const targetSize =
        typeof current.globalBrushSize === 'number' ? current.globalBrushSize : 100;
      const brushTipSource =
        targetBrush ??
        current.getCustomBrushById(targetCustomBrushId) ??
        null;

      const nextBrushTip = brushTipSource
        ? {
            imageData: brushTipSource.imageData,
            brushId: brushTipSource.id,
            isColorizable: false,
            width: brushTipSource.width,
            height: brushTipSource.height,
            naturalWidth: brushTipSource.naturalWidth ?? brushTipSource.width,
            naturalHeight: brushTipSource.naturalHeight ?? brushTipSource.height,
            maxDimension: brushTipSource.maxDimension ?? Math.max(brushTipSource.width, brushTipSource.height),
          }
        : undefined;

      return {
        brushEditor: defaultBrushEditorState,
        tools: {
          ...current.tools,
          brushSettings: {
            ...current.tools.brushSettings,
            brushShape: BrushShape.CUSTOM,
            selectedCustomBrush: targetCustomBrushId,
            size: targetSize,
            currentBrushTip: nextBrushTip,
          },
        },
        globalBrushSize: targetSize,
      };
    });
  },
  setBrushEditorHue: (hue: number) => set((state) => ({
    brushEditor: { ...state.brushEditor, hueShift: hue },
    tools: {
      ...state.tools,
      brushSettings: {
        ...state.tools.brushSettings,
        hueShift: hue
      }
    }
  })),
  setBrushEditorLightness: (lightness: number) => set((state) => ({
    brushEditor: { ...state.brushEditor, lightness },
    tools: {
      ...state.tools,
      brushSettings: {
        ...state.tools.brushSettings,
        lightnessAdjust: lightness
      }
    }
  })),
  setBrushEditorSaturation: (saturation: number) => set((state) => ({
    brushEditor: { ...state.brushEditor, saturation },
    tools: {
      ...state.tools,
      brushSettings: {
        ...state.tools.brushSettings,
        saturationAdjust: saturation
      }
    }
  })),
  updateCurrentBrushTip: (brushTip) => set((state) => ({
    tools: {
      ...state.tools,
      brushSettings: {
        ...state.tools.brushSettings,
        currentBrushTip: brushTip
      }
    }
  })),
  refreshCurrentBrushTipFromSource: () => set((state) => {
    if (state.brushEditor.status === 'EDITING') {
      return {};
    }

    const settings = state.tools.brushSettings;
    if (settings.brushShape !== BrushShape.CUSTOM || !settings.selectedCustomBrush) {
      return {};
    }

    const brushId = settings.selectedCustomBrush;
    const fromProject = state.getCustomBrushById(brushId);
    const fromTemporary = state.temporaryCustomBrush && state.temporaryCustomBrush.id === brushId
      ? state.temporaryCustomBrush
      : null;
    const sourceBrush = fromProject || fromTemporary;
    if (!sourceBrush) {
      return {};
    }

    const hueShift = settings.hueShift ?? 0;
    const lightnessAdjust = settings.lightnessAdjust ?? 0;
    const saturationAdjust = settings.saturationAdjust ?? 100;

    const needsAdjustment = hueShift !== 0 || lightnessAdjust !== 0 || saturationAdjust !== 100;
    const baseImageData = sourceBrush.imageData;
    const adjustedImageData = needsAdjustment
      ? adjustHueLightnessSaturation(baseImageData, hueShift, lightnessAdjust, saturationAdjust)
      : new ImageData(new Uint8ClampedArray(baseImageData.data), baseImageData.width, baseImageData.height);

    const nextBrushTip = {
      imageData: adjustedImageData,
      brushId: sourceBrush.id,
      isColorizable: false,
      width: sourceBrush.width,
      height: sourceBrush.height
    } as BrushSettings['currentBrushTip'];

    try {
      scaledBrushCache.clearForBrush('current-brush-tip');
      scaledBrushCache.clearForBrush(sourceBrush.id);
    } catch {}

    return {
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          currentBrushTip: nextBrushTip
        }
      }
    };
  }),
  cancelBrushEdit: () => set((state) => {
    if (state.brushEditor.status !== 'EDITING' || !state.brushEditor.originalCanvasState || !state.brushEditor.editingBounds) {
      return { 
        brushEditor: defaultBrushEditorState,
        tools: {
          ...state.tools,
          brushSettings: {
            ...state.tools.brushSettings,
            currentBrushTip: undefined,
            selectedCustomBrush: null,
            brushShape: BrushShape.ROUND // Reset to default
          }
        }
        // REMOVED: layersNeedRecomposition: true - brush editing doesn't change layers
      };
    }

    // NOTE: We don't need to restore anything to the main canvas
    // The brush editor works entirely in its own inline canvas

    // Clear currentBrushTip when canceling brush edit
    return { 
      brushEditor: defaultBrushEditorState,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          currentBrushTip: undefined,
          selectedCustomBrush: null,
          brushShape: BrushShape.ROUND // Reset to default
        }
      }
      // REMOVED: layersNeedRecomposition: true - brush editing doesn't change layers
    };
  }),
  _saveCurrentBrushSettings: () => {
    const state = get();
    const { tools, currentBrushPreset, brushSpecificSettings } = state;
    const currentTool = tools.currentTool;
    const currentBrushSettings = tools.brushSettings;
    
    const brushIdToSave = currentBrushPreset?.id ?? 
        (currentBrushSettings.brushShape === BrushShape.CUSTOM && currentBrushSettings.selectedCustomBrush
            ? currentBrushSettings.selectedCustomBrush
            : null);

    if (brushIdToSave && (currentTool === 'brush' || currentTool === 'custom')) {
      const existingSettings = brushSpecificSettings[brushIdToSave] || {};
      const settingsToSave = {
          ...existingSettings,
          ...getSerializableBrushSettings(currentBrushSettings),
      };
      set(prevState => ({
        brushSpecificSettings: {
            ...prevState.brushSpecificSettings,
            [brushIdToSave]: settingsToSave,
        },
      }));
    }
  },
  saveBrushSettings: (brushId, settings) =>
    set((state) => {
      const existingSettings = state.brushSpecificSettings[brushId] || {};
      const newSettings = { ...existingSettings, ...settings };

      return {
        brushSpecificSettings: {
          ...state.brushSpecificSettings,
          [brushId]: newSettings,
        },
      };
    }),
  loadBrushSettings: (brushId) => {
    const state = get();
    const loadedSettings = state.brushSpecificSettings[brushId] || {};

    const normalized = {
      ...loadedSettings,
    } as Partial<BrushSettings> & { colorCycleFlowForward?: boolean };

    if (normalized.colorCycleFlowForward !== undefined) {
      normalized.colorCycleFlowMode =
        normalized.colorCycleFlowForward === false ? 'reverse' : 'forward';
      delete normalized.colorCycleFlowForward;
    }

    delete normalized.pressureEnabled;
    delete normalized.minPressure;
    delete normalized.maxPressure;

    return normalized;
  },
  clearBrushSettings: (brushId) =>
    set((state) => {
      const { [brushId]: removed, ...remaining } = state.brushSpecificSettings;
      void removed;
      return { brushSpecificSettings: remaining };
    }),
});
