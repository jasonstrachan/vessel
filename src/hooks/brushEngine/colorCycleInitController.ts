import { logError } from '@/utils/debug';
import { BrushShape, type BrushSettings } from '@/types';
import { MAX_CC_LAYER_SPEED_SCALE, MIN_CC_LAYER_SPEED_SCALE } from '@/constants/colorCycle';
import { resolveExplicitLayerColorCycleBaseSpeed } from '@/utils/colorCycleLayerSpeed';
import type { CCBrushSettingsPatch } from './colorCycleBrushContracts';
import { applyColorCycleBrushSettingsPatch } from './colorCycleBrushSettingsController';
import type { ColorCycleSettingsPatchBrush } from './colorCycleBrushSettingsPatch';
import { dispatchColorCycleFrameReady } from './colorCycleFrameEvents';
import type { ColorCycleLayerDirtyBatch } from '@/lib/colorCycle/document';

type LayerSummary = {
  id: string;
  layerType?: string;
  colorCycleData?: {
    mode?: string;
    layerBaseSpeedCps?: number;
    controllerSpeedCps?: number;
    brushSpeed?: number;
    runtimeHydrationState?: 'cold' | 'warm' | 'active';
    deferredRuntimeRestore?: boolean;
  };
};

type BrushLike = ColorCycleSettingsPatchBrush & {
  setOnFrameRendered: (callback: (dirtyBatches: ColorCycleLayerDirtyBatch[]) => void) => void;
  endStroke: (layerId: string) => void;
};

type ColorCycleFramePublicationBrush = Pick<BrushLike, 'setOnFrameRendered'>;

export const bindColorCycleFramePublication = (
  brush: ColorCycleFramePublicationBrush,
): void => {
  brush.setOnFrameRendered((dirtyBatches) => {
    dispatchColorCycleFrameReady(dirtyBatches);
  });
};

export const bindActiveColorCycleFramePublication = ({
  activeLayerId,
  getActiveLayerColorCycleBrush,
}: {
  activeLayerId: string | null;
  getActiveLayerColorCycleBrush: () => ColorCycleFramePublicationBrush | null;
}): boolean => {
  if (!activeLayerId) {
    return false;
  }
  const brush = getActiveLayerColorCycleBrush();
  if (!brush) {
    return false;
  }
  bindColorCycleFramePublication(brush);
  return true;
};

export type InitializeColorCycleBrushArgs = {
  activeLayerId: string | null;
  projectWidth?: number;
  projectHeight?: number;
  brushSettings: BrushSettings;
  playbackSpeedScale?: number;
  isCCGradientActiveLayer: boolean;
  defaultBandSpacing: number;
  clampColorCycleBandSpacing: (value?: number) => number;
  resolveBrushPressureRange: (settings: BrushSettings) => {
    enabled: boolean;
    minPercent: number;
    maxPercent: number;
  };
  getLayers: () => LayerSummary[];
  initColorCycleForLayer: (layerId: string, width: number, height: number) => void;
  getActiveLayerColorCycleBrush: () => BrushLike | null;
  requestGradientApply: (layerId: string, reason: string) => void;
  skipGradientReinit?: boolean;
};

export const initializeColorCycleBrushForActiveLayer = <TBrush extends BrushLike>({
  activeLayerId,
  projectWidth,
  projectHeight,
  brushSettings,
  playbackSpeedScale = 1,
  isCCGradientActiveLayer,
  defaultBandSpacing,
  clampColorCycleBandSpacing,
  resolveBrushPressureRange,
  getLayers,
  initColorCycleForLayer,
  getActiveLayerColorCycleBrush,
  requestGradientApply,
  skipGradientReinit,
}: Omit<InitializeColorCycleBrushArgs, 'getActiveLayerColorCycleBrush'> & {
  getActiveLayerColorCycleBrush: () => TBrush | null;
}): TBrush | null => {
  if (!activeLayerId) {
    return null;
  }

  const activeLayer = getLayers().find((layer) => layer.id === activeLayerId);
  if (!activeLayer || activeLayer.layerType !== 'color-cycle') {
    return null;
  }
  if (activeLayer.colorCycleData?.mode === 'recolor') {
    return null;
  }

  try {
    let colorCycleBrush = getActiveLayerColorCycleBrush();

    if (!colorCycleBrush) {
      if (
        activeLayer.colorCycleData?.deferredRuntimeRestore ||
        activeLayer.colorCycleData?.runtimeHydrationState === 'cold'
      ) {
        return null;
      }
      const targetWidth = Math.max(projectWidth || 1024, 1);
      const targetHeight = Math.max(projectHeight || 1024, 1);
      initColorCycleForLayer(activeLayerId, targetWidth, targetHeight);
      colorCycleBrush = getActiveLayerColorCycleBrush();

      if (!colorCycleBrush) {
        logError('[ColorCycle] Failed to initialize brush for layer:', activeLayerId);
        return null;
      }

    }

    bindColorCycleFramePublication(colorCycleBrush);

    const settingsPatch: CCBrushSettingsPatch = {
      brushSize: brushSettings.size || 20,
      legacyFlowMode: 'forward',
      flowMode: 'forward',
    };
    if (brushSettings.colorCycleFPS) {
      settingsPatch.fps = brushSettings.colorCycleFPS;
    }
    try {
      const speedLayer = getLayers().find((layer) => layer.id === activeLayerId);
      const perLayerSpeed = resolveExplicitLayerColorCycleBaseSpeed(speedLayer?.colorCycleData);
      const writeSpeed = brushSettings.colorCycleSpeed;
      const baseSpeed = perLayerSpeed ?? 1;
      const layerSpeedScale = Number.isFinite(playbackSpeedScale)
        ? Math.max(
            MIN_CC_LAYER_SPEED_SCALE,
            Math.min(MAX_CC_LAYER_SPEED_SCALE, playbackSpeedScale as number)
          )
        : 1;
      if (typeof writeSpeed === 'number' && Number.isFinite(writeSpeed)) {
        settingsPatch.cycleSpeed = writeSpeed;
      }
      if (typeof baseSpeed === 'number' && Number.isFinite(baseSpeed)) {
        settingsPatch.layerBaseSpeed = baseSpeed;
      }
      settingsPatch.playbackSpeedScale = layerSpeedScale;
    } catch {}

    if (brushSettings.gradientBands) {
      settingsPatch.gradientBands = brushSettings.gradientBands;
    }

    const useShapeSpacing = brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
    const resolvedBandSpacing = clampColorCycleBandSpacing(
      useShapeSpacing
        ? brushSettings.colorCycleBandSpacingPx ?? brushSettings.spacing ?? defaultBandSpacing
        : brushSettings.spacing ?? defaultBandSpacing
    );
    settingsPatch.bandSpacing = resolvedBandSpacing;

    try {
      const enable = isCCGradientActiveLayer && !!brushSettings.ditherEnabled;
      settingsPatch.ditherEnabled = enable;
      if (isCCGradientActiveLayer && typeof brushSettings.fillResolution === 'number') {
        settingsPatch.ditherPixelSize = Math.max(1, Math.floor(brushSettings.fillResolution));
      }
      settingsPatch.ditherStrength = enable ? 1 : 0;
      settingsPatch.pxlEdgeEnabled = !!brushSettings.pxlEdge;
      settingsPatch.stampDitherEnabled = !isCCGradientActiveLayer && !!brushSettings.colorCycleStampDitherEnabled;
    } catch (error) {
      logError('[CC Init] Failed to set dither settings:', error);
    }

    try {
      const { enabled, minPercent, maxPercent } = resolveBrushPressureRange(brushSettings);
      settingsPatch.pressureEnabled = enabled;
      settingsPatch.minPressure = enabled ? minPercent : 100;
      settingsPatch.maxPressure = enabled ? maxPercent : 100;
    } catch (error) {
      logError('[CC Init] Failed to set pressure settings:', error);
    }

    try {
      const stampShape =
        brushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE
          ? 'triangle'
          : (brushSettings.colorCycleStampShape ?? 'square');
      settingsPatch.stampShape = stampShape;
    } catch (error) {
      logError('[CC Init] Failed to set stamp shape:', error);
    }

    applyColorCycleBrushSettingsPatch(colorCycleBrush, settingsPatch);

    if (!skipGradientReinit) {
      requestGradientApply(activeLayerId, 'brush-init');
    }

    return colorCycleBrush;
  } catch (error) {
    logError('[ColorCycle] Error initializing brush:', error);
    return null;
  }
};

export const ensureColorCycleAnimationForLayers = ({
  shouldPlay,
  layers,
  getPlaybackBrush,
}: {
  shouldPlay: boolean;
  layers: Array<{ id: string; layerType?: string }>;
  getPlaybackBrush: (layerId: string) => {
    startAnimation?: () => void;
    stopAnimation?: () => void;
    setPlaying?: (playing: boolean) => void;
  } | undefined;
}): void => {
  if (typeof window === 'undefined') {
    return;
  }

  layers.forEach((layer) => {
    if (layer.layerType !== 'color-cycle') {
      return;
    }

    const brush = getPlaybackBrush(layer.id);
    if (!brush) {
      return;
    }

    if (shouldPlay) {
      if (typeof brush.startAnimation === 'function') {
        brush.startAnimation();
      } else if (typeof brush.setPlaying === 'function') {
        brush.setPlaying(true);
      }
      return;
    }

    if (typeof brush.stopAnimation === 'function') {
      brush.stopAnimation();
    } else if (typeof brush.setPlaying === 'function') {
      brush.setPlaying(false);
    }
  });
};
