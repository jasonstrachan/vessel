
import { debugLog, logError } from '@/utils/debug';
import type { ColorCycleBrushCanvas2D } from '@/hooks/brushEngine/ColorCycleBrushCanvas2D';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import { MAX_CC_LAYER_SPEED_SCALE, MIN_CC_LAYER_SPEED_SCALE } from '@/constants/colorCycle';
import { defaultBrushSettings } from '@/presets/brushPresets';
import type { BrushSettings, Layer } from '@/types';
import { resolveBrushPressureRange } from '@/utils/pressureSettings';

export interface ColorCycleBrushRegistryDeps {
  getBrushSettings: () => BrushSettings | null | undefined;
  getPlaybackSpeedScale: () => number;
  getLayers: () => Layer[] | null | undefined;
  createCanvas: (width: number, height: number) => HTMLCanvasElement;
  getBrushClass: () => typeof ColorCycleBrushCanvas2D;
  shouldForceCanvas2D: () => boolean;
  now?: () => number;
}

type BrushWithOptionalControls = ColorCycleBrushImplementation & {
  usesWebGL?: boolean;
  cleanup?: () => void;
  destroy?: () => void;
  setIsolated?: (isolated: boolean) => void;
  setLayerId?: (layerId: string) => void;
  setSpeed?: (speed: number) => void;
  setPlaybackSpeedScale?: (scale: number) => void;
  setUseCanvas2D?: (useCanvas2D: boolean) => void;
  isUsingWebGL?: () => boolean;
  setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
};

export interface ColorCycleBrushMetadata {
  layerId: string;
  created: number;
  lastUsed: number;
  width: number;
  height: number;
  gradientHash?: string;
  isActive: boolean;
}

export interface ColorCycleBrushManager {
  brushes: Map<string, ColorCycleBrushImplementation>;
  brushMetadata: Map<string, ColorCycleBrushMetadata>;
  activeResources: Set<string>;
  createBrush: (layerId: string, width: number, height: number, gradient?: Uint8Array) => ColorCycleBrushImplementation;
  getBrush: (layerId: string) => ColorCycleBrushImplementation | undefined;
  updateBrush: (layerId: string, brush: ColorCycleBrushImplementation) => void;
  deleteBrush: (layerId: string) => void;
  setActiveState: (layerId: string, isActive: boolean) => void;
  cleanupInactive: (maxInactiveMs?: number) => void;
  cleanupAll: () => void;
  initColorCycleForLayer: (layerId: string, width: number, height: number, gradient?: Uint8Array) => boolean;
  getLayerColorCycleBrush: (layerId: string) => ColorCycleBrushImplementation | null;
  validateColorCycleBrush: (layerId: string) => boolean;
  removeColorCycleBrush: (layerId: string) => void;
  cleanupOrphanedBrushes: (validLayerIds: Set<string>) => void;
  transferColorCycleBrush: (fromLayerId: string, toLayerId: string) => boolean;
  setCanvasImplementation: (useCanvas2D: boolean) => void;
}

const hashGradient = (gradient: Uint8Array): string => {
  let hash = 0;
  for (let i = 0; i < gradient.length; i += 16) {
    hash = ((hash << 5) - hash) + gradient[i];
    hash = hash & hash;
  }
  return hash.toString(36);
};

export const createColorCycleBrushRegistry = (deps: ColorCycleBrushRegistryDeps): ColorCycleBrushManager => {
  const brushes = new Map<string, ColorCycleBrushImplementation>();
  const brushMetadata = new Map<string, ColorCycleBrushMetadata>();
  const activeResources = new Set<string>();
  const now = () => (deps.now ?? Date.now)();

  const shouldLogRegistry = (): boolean => {
    if (process.env.NODE_ENV === 'production') {
      return false;
    }
    try {
      return Boolean((globalThis as { __TB_DEBUG?: { logCC?: boolean } }).__TB_DEBUG?.logCC);
    } catch {
      return false;
    }
  };

  const shouldIncludeStack = (): boolean => {
    if (process.env.NODE_ENV === 'production') {
      return false;
    }
    try {
      return Boolean((globalThis as { __TB_DEBUG?: { logCCVerbose?: boolean } }).__TB_DEBUG?.logCCVerbose);
    } catch {
      return false;
    }
  };

  const devLog = (message: string, payload: Record<string, unknown>): void => {
    if (!shouldLogRegistry()) {
      return;
    }
    debugLog('raw-console', message, payload);
  };

  const getBrushSettings = (): BrushSettings => {
    return deps.getBrushSettings() ?? defaultBrushSettings;
  };

  const getLayers = (): Layer[] => {
    return deps.getLayers() ?? [];
  };

  const updateBrushWebGLState = (
    layerId: string,
    brush: BrushWithOptionalControls,
    useCanvas2DOverride?: boolean
  ) => {
    const wantsCanvas2D = useCanvas2DOverride ?? deps.shouldForceCanvas2D();
    const usingWebGL = !wantsCanvas2D && (brush.isUsingWebGL?.() ?? brush.usesWebGL ?? false);
    brush.usesWebGL = usingWebGL;

    if (usingWebGL) {
      activeResources.add(`webgl_${layerId}`);
    } else {
      activeResources.delete(`webgl_${layerId}`);
    }
  };

  return {
    brushes,
    brushMetadata,
    activeResources,

    createBrush(layerId: string, width: number, height: number, gradient?: Uint8Array) {
      this.deleteBrush(layerId);

      const canvas = deps.createCanvas(width, height);
      canvas.width = width;
      canvas.height = height;

      // Layer lookup no longer needed here; keep flow logic focused on brush setup.

      const currentSettings = getBrushSettings();
      const BrushCanvas = deps.getBrushClass();
      const brush = new BrushCanvas(canvas, {
        brushSize: currentSettings.size ?? defaultBrushSettings.size,
        fps: currentSettings.colorCycleFPS ?? 60,
        forceCanvas2D: deps.shouldForceCanvas2D()
      });

      if (typeof currentSettings.gradientBands === 'number') {
        brush.setGradientBands(currentSettings.gradientBands);
      }
      const bandSpacing = currentSettings.colorCycleBandSpacingPx ?? currentSettings.spacing ?? 12;
      brush.setBandSpacing(bandSpacing);
      const baseSize = Math.max(1, Math.round(currentSettings.size ?? defaultBrushSettings.size ?? 1));
      const pressureRange = resolveBrushPressureRange(currentSettings);
      const pressureActive = pressureRange.enabled;
      const minPercent = pressureActive ? pressureRange.minPercent : 100;
      const maxPercent = pressureActive ? pressureRange.maxPercent : 100;

      brush.setBrushSize(baseSize);
      brush.setPressureEnabled(pressureActive);
      brush.setMinPressure(minPercent);
      brush.setMaxPressure(maxPercent);
      if (typeof currentSettings.ditherEnabled === 'boolean') {
        brush.setDitherEnabled(currentSettings.ditherEnabled);
      }
      if (typeof currentSettings.fillResolution === 'number') {
        brush.setDitherPixelSize(Math.max(1, Math.floor(currentSettings.fillResolution)));
      }
      brush.setStampDitherEnabled(Boolean(currentSettings.colorCycleStampDitherEnabled));
      if (typeof brush.setStampDitherAlgorithm === 'function') {
        brush.setStampDitherAlgorithm(currentSettings.ditherAlgorithm ?? 'sierra-lite');
      }
      if (typeof brush.setStampDitherPatternStyle === 'function') {
        brush.setStampDitherPatternStyle(currentSettings.patternStyle ?? 'dots');
      }
      if (typeof currentSettings.colorCycleStampDitherPixelSize === 'number') {
        brush.setStampDitherPixelSize(
          Math.max(1, Math.floor(currentSettings.colorCycleStampDitherPixelSize))
        );
      }
      if (typeof brush.setStampDitherPressureLinked === 'function') {
        brush.setStampDitherPressureLinked(
          Boolean(currentSettings.colorCycleStampDitherPressureLinked)
        );
      }
      const stampBgFill =
        typeof currentSettings.colorCycleStampDitherBgFill === 'boolean'
          ? currentSettings.colorCycleStampDitherBgFill
          : !Boolean(currentSettings.colorCycleStampDitherClears);
      if (typeof (brush as { setStampDitherBgFill?: (v: boolean) => void }).setStampDitherBgFill === 'function') {
        (brush as { setStampDitherBgFill: (v: boolean) => void }).setStampDitherBgFill(stampBgFill);
      } else if (typeof brush.setStampDitherClears === 'function') {
        brush.setStampDitherClears(!stampBgFill);
      }

      const brushWithOptionalControls: BrushWithOptionalControls = brush;
      brushWithOptionalControls.setLayerId?.(layerId);
      brushWithOptionalControls.setTargetCanvas?.(canvas);

      if (typeof currentSettings.colorCycleSpeed === 'number') {
        brushWithOptionalControls.setSpeed?.(currentSettings.colorCycleSpeed);
      }
      if (typeof brushWithOptionalControls.setPlaybackSpeedScale === 'function') {
        const playbackSpeedScale = deps.getPlaybackSpeedScale();
        const layerScale = Number.isFinite(playbackSpeedScale)
          ? Math.max(
              MIN_CC_LAYER_SPEED_SCALE,
              Math.min(MAX_CC_LAYER_SPEED_SCALE, playbackSpeedScale)
            )
          : 1;
        brushWithOptionalControls.setPlaybackSpeedScale(layerScale);
      }
      const perLayerFlowMode = 'forward' as const;
      const legacyFlowMode = 'forward' as const;

      if (typeof (brushWithOptionalControls as { setLegacyFlowMode?: (mode: typeof perLayerFlowMode) => void }).setLegacyFlowMode === 'function') {
        (brushWithOptionalControls as { setLegacyFlowMode: (mode: typeof perLayerFlowMode) => void }).setLegacyFlowMode(legacyFlowMode);
      }

      if (typeof brushWithOptionalControls.setFlowMode === 'function') {
        brushWithOptionalControls.setFlowMode(perLayerFlowMode);
      } else if (typeof brushWithOptionalControls.setFlowDirection === 'function') {
        brushWithOptionalControls.setFlowDirection('forward');
      }

      brushes.set(layerId, brush);
      brushMetadata.set(layerId, {
        layerId,
        created: now(),
        lastUsed: now(),
        width,
        height,
        gradientHash: gradient ? hashGradient(gradient) : undefined,
        isActive: true
      });

      activeResources.add(layerId);
      updateBrushWebGLState(layerId, brushWithOptionalControls);

      return brush;
    },

    getBrush(layerId: string): ColorCycleBrushImplementation | undefined {
      const brush = brushes.get(layerId);
      if (brush) {
        const metadata = brushMetadata.get(layerId);
        if (metadata) {
          metadata.lastUsed = now();
        }
      }
      return brush;
    },

    updateBrush(layerId: string, brush: ColorCycleBrushImplementation) {
      brushes.set(layerId, brush);
      const metadata = brushMetadata.get(layerId);
      if (metadata) {
        metadata.lastUsed = now();
      }
    },

    deleteBrush(layerId: string) {
      const brush = brushes.get(layerId) as BrushWithOptionalControls | undefined;
      if (brush) {
        brush.cleanup?.();
      }

      brushes.delete(layerId);
      brushMetadata.delete(layerId);
      activeResources.delete(layerId);
      activeResources.delete(`canvas_${layerId}`);
      activeResources.delete(`webgl_${layerId}`);
    },

    setActiveState(layerId: string, isActive: boolean) {
      const metadata = brushMetadata.get(layerId);
      if (metadata) {
        metadata.isActive = isActive;
        if (isActive) {
          metadata.lastUsed = now();
          activeResources.add(layerId);
        } else {
          activeResources.delete(layerId);
        }
      }
    },

    cleanupInactive(maxInactiveMs: number = 60000) {
      const currentTime = now();
      const toDelete: string[] = [];
      const layers = getLayers();

      brushMetadata.forEach((metadata, layerId) => {
        if (metadata.isActive) {
          return;
        }

        if (currentTime - metadata.lastUsed <= maxInactiveMs) {
          return;
        }

        let shouldPreserve = false;
        const layer = layers.find(candidate => candidate.id === layerId);
        if (layer && layer.layerType === 'color-cycle' && layer.colorCycleData?.mode !== 'recolor') {
          const hydrationState = layer.colorCycleData?.runtimeHydrationState
            ?? (layer.colorCycleData?.deferredRuntimeRestore ? 'cold' : 'warm');
          const isAnimating = Boolean(layer.colorCycleData?.isAnimating);
          if (hydrationState === 'active' || isAnimating) {
            shouldPreserve = true;
          }
        }

        if (shouldPreserve) {
          metadata.lastUsed = currentTime;
          return;
        }

        toDelete.push(layerId);
      });

      toDelete.forEach(layerId => {
        this.deleteBrush(layerId);
      });
    },

    cleanupAll() {
      brushes.forEach((_, layerId) => {
        this.deleteBrush(layerId);
      });
    },

    setCanvasImplementation(useCanvas2D: boolean) {
      brushes.forEach((brush, layerId) => {
        const brushControls = brush as BrushWithOptionalControls;
        brushControls.setUseCanvas2D?.(useCanvas2D);
        updateBrushWebGLState(layerId, brushControls, !useCanvas2D);
      });
    },

    initColorCycleForLayer(layerId: string, width: number, height: number, gradient?: Uint8Array) {
      const payload: Record<string, unknown> = {
        layerId,
        width,
        height,
        gradientBytes: gradient?.length ?? 0,
      };
      if (shouldIncludeStack()) {
        payload.stack = new Error().stack?.split('\n').slice(0, 4).join('\n');
      }
      devLog('[ccBrushRegistry] initColorCycleForLayer', payload);
      try {
        const existingBrush = brushes.get(layerId);
        if (existingBrush) {
          return true;
        }

        this.createBrush(layerId, width, height, gradient);
        activeResources.add(`canvas_${layerId}`);
        return true;
      } catch (error) {
        logError(`❌ Failed to create CC brush for layer ${layerId}:`, error);
        return false;
      }
    },

    getLayerColorCycleBrush(layerId: string): ColorCycleBrushImplementation | null {
      const brush = brushes.get(layerId);

      if (!brush) {
        return null;
      }

      if (!this.validateColorCycleBrush(layerId)) {
        this.removeColorCycleBrush(layerId);
        return null;
      }

      const metadata = brushMetadata.get(layerId);
      if (metadata) {
        metadata.lastUsed = now();
      }

      return brush;
    },

    validateColorCycleBrush(layerId: string): boolean {
      const brush = brushes.get(layerId);
      if (!brush) return false;

      try {
        if ('getCanvas' in brush && typeof brush.getCanvas === 'function') {
          const canvas = brush.getCanvas();
          if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
            return false;
          }
        }

        if ('isContextLost' in brush && typeof brush.isContextLost === 'function') {
          if (brush.isContextLost()) {
            return false;
          }
        }

        if ('hasValidBuffers' in brush && typeof brush.hasValidBuffers === 'function') {
          if (!brush.hasValidBuffers()) {
            return false;
          }
        }

        if ('getLayerId' in brush && typeof brush.getLayerId === 'function') {
          if (brush.getLayerId() !== layerId) {
            return false;
          }
        }

        return true;
      } catch (error) {
        logError(`❌ Validation error for layer ${layerId}:`, error);
        return false;
      }
    },

    removeColorCycleBrush(layerId: string): void {
      devLog('[ccBrushRegistry] removeColorCycleBrush', {
        layerId,
        stack: new Error().stack?.split('\n').slice(0, 4).join('\n'),
      });
      const brush = brushes.get(layerId) as BrushWithOptionalControls | undefined;

      if (brush) {
        if (typeof brush.destroy === 'function') {
          try {
            brush.destroy();
          } catch (error) {
            logError(`Error destroying brush for layer ${layerId}:`, error);
          }
        }

        if (typeof brush.cleanup === 'function') {
          try {
            brush.cleanup();
          } catch (error) {
            logError(`Error cleaning up brush for layer ${layerId}:`, error);
          }
        }

        brushes.delete(layerId);
        brushMetadata.delete(layerId);

        activeResources.delete(layerId);
        activeResources.delete(`canvas_${layerId}`);
        activeResources.delete(`webgl_${layerId}`);
      }
    },

    cleanupOrphanedBrushes(validLayerIds: Set<string>): void {
      const orphaned = Array.from(brushes.keys())
        .filter(id => !validLayerIds.has(id));

      if (orphaned.length === 0) return;

      orphaned.forEach(layerId => {
        this.removeColorCycleBrush(layerId);
      });
    },

    transferColorCycleBrush(fromLayerId: string, toLayerId: string): boolean {
      devLog('[ccBrushRegistry] transferColorCycleBrush', {
        fromLayerId,
        toLayerId,
        stack: new Error().stack?.split('\n').slice(0, 4).join('\n'),
      });
      const sourceBrush = brushes.get(fromLayerId) as BrushWithOptionalControls | undefined;
      const sourceMetadata = brushMetadata.get(fromLayerId);

      if (!sourceBrush || !sourceMetadata) {
        return false;
      }

      if (!this.validateColorCycleBrush(fromLayerId)) {
        return false;
      }

      if (brushes.has(toLayerId)) {
        this.removeColorCycleBrush(toLayerId);
      }

      sourceBrush.setLayerId?.(toLayerId);

      brushes.set(toLayerId, sourceBrush);
      brushMetadata.set(toLayerId, {
        ...sourceMetadata,
        layerId: toLayerId,
        lastUsed: now()
      });

      if (activeResources.has(fromLayerId)) {
        activeResources.delete(fromLayerId);
        activeResources.add(toLayerId);
      }
      if (activeResources.has(`canvas_${fromLayerId}`)) {
        activeResources.delete(`canvas_${fromLayerId}`);
        activeResources.add(`canvas_${toLayerId}`);
      }
      if (activeResources.has(`webgl_${fromLayerId}`)) {
        activeResources.delete(`webgl_${fromLayerId}`);
        activeResources.add(`webgl_${toLayerId}`);
      }

      brushes.delete(fromLayerId);
      brushMetadata.delete(fromLayerId);

      return true;
    }
  };
};
