import { BrushShape, type BrushSettings } from '@/types';
import { MAX_CC_LAYER_SPEED_SCALE, MIN_CC_LAYER_SPEED_SCALE } from '@/constants/colorCycle';
import { resolveExplicitLayerColorCycleBaseSpeed } from '@/utils/colorCycleLayerSpeed';

type LayerSummary = {
  id: string;
  layerType?: string;
  colorCycleData?: {
    mode?: string;
    layerBaseSpeedCps?: number;
    controllerSpeedCps?: number;
    brushSpeed?: number;
  };
};

type BrushLike = {
  setOnFrameRendered: (callback: () => void) => void;
  endStroke: (layerId: string) => void;
  setBrushSize: (size: number) => void;
  setFPS: (fps: number) => void;
  setSpeed: (speed: number) => void;
  setLayerBaseSpeed?: (speed: number) => void;
  setPlaybackSpeedScale?: (scale: number) => void;
  setGradientBands: (bands: number) => void;
  setBandSpacing: (spacing: number) => void;
  setDitherEnabled: (enabled: boolean) => void;
  setDitherPixelSize: (pixelSize: number) => void;
  setPxlEdgeEnabled?: (enabled: boolean) => void;
  setStampDitherEnabled: (enabled: boolean) => void;
  setPressureEnabled: (enabled: boolean) => void;
  setMinPressure: (value: number) => void;
  setMaxPressure: (value: number) => void;
  setStampShape: (
    shape: 'square' | 'triangle' | 'round' | 'diamond' | 'diamond5' | 'diamond7' | 'diamond9'
  ) => void;
  setFlowMode?: (mode: 'forward') => void;
  setFlowDirection: (direction: 'forward') => void;
  setLegacyFlowMode?: (mode: 'forward') => void;
  setDitherStrength?: (value: number) => void;
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
      const targetWidth = Math.max(projectWidth || 1024, 1);
      const targetHeight = Math.max(projectHeight || 1024, 1);
      initColorCycleForLayer(activeLayerId, targetWidth, targetHeight);
      colorCycleBrush = getActiveLayerColorCycleBrush();

      if (!colorCycleBrush) {
        console.error('[ColorCycle] Failed to initialize brush for layer:', activeLayerId);
        return null;
      }

      colorCycleBrush.setOnFrameRendered(() => {
        window.dispatchEvent(new CustomEvent('colorCycleFrameReady'));
      });
    } else {
      colorCycleBrush.endStroke(activeLayerId);
    }

    colorCycleBrush.setBrushSize(brushSettings.size || 20);
    if (brushSettings.colorCycleFPS) {
      colorCycleBrush.setFPS(brushSettings.colorCycleFPS);
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
        colorCycleBrush.setSpeed(writeSpeed);
      }
      if (typeof baseSpeed === 'number' && Number.isFinite(baseSpeed) && typeof colorCycleBrush.setLayerBaseSpeed === 'function') {
        colorCycleBrush.setLayerBaseSpeed(baseSpeed);
      }
      if (typeof colorCycleBrush.setPlaybackSpeedScale === 'function') {
        colorCycleBrush.setPlaybackSpeedScale(layerSpeedScale);
      }
    } catch {}

    if (brushSettings.gradientBands) {
      colorCycleBrush.setGradientBands(brushSettings.gradientBands);
    }

    const useShapeSpacing = brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
    const resolvedBandSpacing = clampColorCycleBandSpacing(
      useShapeSpacing
        ? brushSettings.colorCycleBandSpacingPx ?? brushSettings.spacing ?? defaultBandSpacing
        : brushSettings.spacing ?? defaultBandSpacing
    );
    colorCycleBrush.setBandSpacing(resolvedBandSpacing);

    try {
      const enable = isCCGradientActiveLayer && !!brushSettings.ditherEnabled;
      colorCycleBrush.setDitherEnabled(enable);
      if (isCCGradientActiveLayer && typeof brushSettings.fillResolution === 'number') {
        colorCycleBrush.setDitherPixelSize(Math.max(1, Math.floor(brushSettings.fillResolution)));
      }
      if (typeof colorCycleBrush.setDitherStrength === 'function') {
        colorCycleBrush.setDitherStrength(enable ? 1 : 0);
      }
      if (typeof colorCycleBrush.setPxlEdgeEnabled === 'function') {
        colorCycleBrush.setPxlEdgeEnabled(!!brushSettings.pxlEdge);
      }
      colorCycleBrush.setStampDitherEnabled(!isCCGradientActiveLayer && !!brushSettings.colorCycleStampDitherEnabled);
    } catch (error) {
      console.error('[CC Init] Failed to set dither settings:', error);
    }

    try {
      const { enabled, minPercent, maxPercent } = resolveBrushPressureRange(brushSettings);
      colorCycleBrush.setPressureEnabled(enabled);
      colorCycleBrush.setMinPressure(enabled ? minPercent : 100);
      colorCycleBrush.setMaxPressure(enabled ? maxPercent : 100);
    } catch (error) {
      console.error('[CC Init] Failed to set pressure settings:', error);
    }

    try {
      const stampShape =
        brushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE
          ? 'triangle'
          : (brushSettings.colorCycleStampShape ?? 'square');
      colorCycleBrush.setStampShape(stampShape);
    } catch (error) {
      console.error('[CC Init] Failed to set stamp shape:', error);
    }

    if (!skipGradientReinit) {
      requestGradientApply(activeLayerId, 'brush-init');
    }

    const flowMode = 'forward' as const;
    if (typeof colorCycleBrush.setLegacyFlowMode === 'function') {
      colorCycleBrush.setLegacyFlowMode(flowMode);
    }
    if (typeof colorCycleBrush.setFlowMode === 'function') {
      colorCycleBrush.setFlowMode(flowMode);
    } else {
      colorCycleBrush.setFlowDirection('forward');
    }

    return colorCycleBrush;
  } catch (error) {
    console.error('[ColorCycle] Error initializing brush:', error);
    return null;
  }
};

export const ensureColorCycleAnimationForLayers = ({
  shouldPlay,
  layers,
  getBrush,
}: {
  shouldPlay: boolean;
  layers: Array<{ id: string; layerType?: string }>;
  getBrush: (layerId: string) => {
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

    const brush = getBrush(layer.id);
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
