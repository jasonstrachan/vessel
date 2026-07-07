import type { FlowMode } from '@/lib/colorCycle/flowEncoding';
import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { BrushSettings } from '@/types';
import type { PatternStyle } from '@/utils/ditherAlgorithms';

import {
  applyColorCycleSettingsPatch,
} from './colorCycleApplySettings';
import type {
  CCBrushSettings,
  CCBrushSettingsPatch,
  StampShape,
} from './colorCycleBrushContracts';
import type { ColorCycleLayerBaseSpeedChange } from './colorCycleCoreBrushSettingsState';
import {
  applyColorCycleLayerBaseSpeedChange,
  type ColorCycleLayerBaseSpeedContext,
} from './colorCycleLayerBaseSpeedRuntime';
import {
  setColorCycleStampDitherEnabled,
  setColorCycleStampDitherPressureLinked,
  type ColorCycleStampDitherSettingsContext,
} from './colorCycleStampDitherSettingsRuntime';
import type { ColorCycleShapeFillSettingsSnapshot } from './colorCycleShapeFillSettingsState';
import type { ColorCycleStampDitherSettings } from './colorCycleStampDitherState';
import type { StampDitherAlgorithm } from './strokeStampDither';

type PatternTileSettings = Pick<
  BrushSettings,
  | 'patternTileId'
  | 'patternTileScale'
  | 'patternTileInvert'
  | 'patternTileThreshold'
  | 'patternTileOffsetX'
  | 'patternTileOffsetY'
>;

export type ColorCycleBrushSettingsRuntimeContext = {
  getBrushSize(): number;
  getCycleSpeed(): number;
  getLayerBaseSpeed(): number;
  isPressureEnabled(): boolean;
  getMinPressure(): number;
  getMaxPressure(): number;
  getStampShape(): StampShape;
  setCycleSpeed(speed: number): number | null;
  setLayerBaseSpeed(speed: number): ColorCycleLayerBaseSpeedChange | null;
  setBrushSize(size: number): number | null;
  setStampShape(shape: StampShape): void;
  setPressureEnabled(enabled: boolean): void;
  setMinPressure(min: number): void;
  setMaxPressure(max: number): void;
  getShapeFillSettings(): ColorCycleShapeFillSettingsSnapshot;
  isShapeDitherEnabled(): boolean;
  getGradientBands(): number;
  setGradientBands(bands: number): number | null;
  setBandSpacing(spacing: number): number | null;
  normalizeBandSpacingValue(spacing?: number): number;
  deriveBandCountFromDistance(distance: number, spacing?: number): number;
  setShapeDitherEnabled(enabled: boolean): boolean;
  setDitherStrength(strength: number): void;
  setDitherPixelSize(size: number): void;
  setPxlEdgeEnabled(enabled: boolean): void;
  setPerceptualDither(enabled: boolean): void;
  getStampDitherSettings(): ColorCycleStampDitherSettings;
  getStampDitherAlgorithm(): StampDitherAlgorithm;
  getStampDitherPatternStyle(): PatternStyle;
  setStampDitherAlgorithmValue(algorithm?: StampDitherAlgorithm): boolean;
  setStampDitherPatternStyleValue(style?: PatternStyle): boolean;
  setStampDitherPatternTileSettings(settings: PatternTileSettings): void;
  setStampDitherPixelSizeValue(size: number): void;
  setStampDitherBgFill(enabled: boolean): void;
  setStampDitherClears(enabled: boolean): void;
  getFlowMode(): FlowMode;
  getLegacyFlowMode(): FlowMode;
  setRuntimeFlowMode(mode: FlowMode): void;
  setRuntimeLegacyFlowMode(mode: FlowMode): void;
  getFps(): number;
  getPlaybackSpeedScale(): number;
  forEachAnimator(callback: (animator: ColorCycleAnimator, layerId: string) => void): void;
  setPhaseValue(phase: number): void;
  setPlaybackSpeedScaleValue(scale: number): void;
  setFpsValue(fps: number): void;
  getLayerBaseSpeedContext(): ColorCycleLayerBaseSpeedContext;
  getStampDitherSettingsContext(): ColorCycleStampDitherSettingsContext;
  render(force?: boolean): void;
  warn(message: string): void;
  logGradientBrushPath(event: string, data: Record<string, unknown>): void;
};

export function readColorCycleBrushSettings(
  context: ColorCycleBrushSettingsRuntimeContext,
): CCBrushSettings {
  return {
    brushSize: context.getBrushSize(),
    cycleSpeed: context.getCycleSpeed(),
    layerBaseSpeed: context.getLayerBaseSpeed(),
    playbackSpeedScale: context.getPlaybackSpeedScale(),
    fps: context.getFps(),
    pressureEnabled: context.isPressureEnabled(),
    minPressure: context.getMinPressure(),
    maxPressure: context.getMaxPressure(),
    ...context.getShapeFillSettings(),
    stampShape: context.getStampShape(),
    ...context.getStampDitherSettings(),
    flowMode: context.getFlowMode(),
    legacyFlowMode: context.getLegacyFlowMode(),
  };
}

export function applyColorCycleBrushSettings(
  context: ColorCycleBrushSettingsRuntimeContext,
  settings: CCBrushSettingsPatch,
): void {
  applyColorCycleSettingsPatch(settings, {
    current: readColorCycleBrushSettings(context),
    actions: {
      setSpeed: (value) => setColorCycleBrushSpeed(context, value),
      setLayerBaseSpeed: (value) => setColorCycleBrushLayerBaseSpeed(context, value),
      setPlaybackSpeedScale: (value) => setColorCycleBrushPlaybackSpeedScale(context, value),
      setFPS: (value) => setColorCycleBrushFps(context, value),
      setBrushSize: (value) => setColorCycleBrushSize(context, value),
      setGradientBands: (value) => setColorCycleBrushGradientBands(context, value),
      setBandSpacing: (value) => setColorCycleBrushBandSpacing(context, value),
      setPressureEnabled: (value) => setColorCycleBrushPressureEnabled(context, value),
      setMinPressure: (value) => setColorCycleBrushMinPressure(context, value),
      setMaxPressure: (value) => setColorCycleBrushMaxPressure(context, value),
      setDitherEnabled: (value) => setColorCycleBrushDitherEnabled(context, value),
      setDitherStrength: (value) => setColorCycleBrushDitherStrength(context, value),
      setDitherPixelSize: (value) => setColorCycleBrushDitherPixelSize(context, value),
      setPxlEdgeEnabled: (value) => setColorCycleBrushPxlEdgeEnabled(context, value),
      setPerceptualDither: (value) => setColorCycleBrushPerceptualDither(context, value),
      setStampShape: (value) => setColorCycleBrushStampShape(context, value),
      setStampDitherEnabled: (value) => setColorCycleBrushStampDitherEnabled(context, value),
      setStampDitherAlgorithm: (value) => setColorCycleBrushStampDitherAlgorithm(context, value),
      setStampDitherPatternStyle: (value) => setColorCycleBrushStampDitherPatternStyle(context, value),
      setStampDitherPatternTileSettings: (value) => setColorCycleBrushStampDitherPatternTileSettings(context, value),
      setStampDitherPixelSize: (value) => setColorCycleBrushStampDitherPixelSize(context, value),
      setStampDitherPressureLinked: (value) => setColorCycleBrushStampDitherPressureLinked(context, value),
      setStampDitherBgFill: (value) => setColorCycleBrushStampDitherBgFill(context, value),
      setLegacyFlowMode: (value) => setColorCycleBrushLegacyFlowMode(context, value),
      setFlowMode: (value) => setColorCycleBrushFlowMode(context, value),
    },
  });
}

export function setColorCycleBrushPhase(
  context: ColorCycleBrushSettingsRuntimeContext,
  phase: number,
): void {
  context.setPhaseValue(phase);
  context.render(false);
}

export function setColorCycleBrushSpeed(
  context: ColorCycleBrushSettingsRuntimeContext,
  speed: number,
): void {
  const next = context.setCycleSpeed(speed);
  if (next === null) {
    context.warn(`Invalid animation speed: ${speed}`);
    return;
  }
  context.forEachAnimator((animator) => (
    animator.setSpeed(context.getPlaybackSpeedScale())
  ));
}

export function setColorCycleBrushLayerBaseSpeed(
  context: ColorCycleBrushSettingsRuntimeContext,
  speed: number,
): void {
  const change = context.setLayerBaseSpeed(speed);
  if (change === null) {
    context.warn(`Invalid layer base speed: ${speed}`);
    return;
  }
  applyColorCycleLayerBaseSpeedChange(context.getLayerBaseSpeedContext(), change);
}

export function setColorCycleBrushPlaybackSpeedScale(
  context: ColorCycleBrushSettingsRuntimeContext,
  scale: number,
): void {
  if (!Number.isFinite(scale) || scale < 0) {
    context.warn(`Invalid playback speed scale: ${scale}`);
    return;
  }
  context.setPlaybackSpeedScaleValue(scale);
}

export function setColorCycleBrushFps(
  context: ColorCycleBrushSettingsRuntimeContext,
  fps: number,
): void {
  if (!Number.isFinite(fps) || fps <= 0 || fps > 120) {
    context.warn(`Invalid FPS value: ${fps}. Expected value between 1 and 120`);
    return;
  }
  context.setFpsValue(fps);
}

export function setColorCycleBrushSize(
  context: ColorCycleBrushSettingsRuntimeContext,
  size: number,
): void {
  const next = context.setBrushSize(size);
  if (next === null) {
    context.warn(`Invalid brush size: ${size}`);
  }
}

export function setColorCycleBrushGradientBands(
  context: ColorCycleBrushSettingsRuntimeContext,
  bands: number,
): void {
  const next = context.setGradientBands(bands);
  if (next === null) {
    context.warn(`Invalid gradient bands: ${bands}, using default`);
    return;
  }
  context.logGradientBrushPath('setGradientBands', {
    requested: bands,
    applied: next,
    ditherEnabled: context.isShapeDitherEnabled(),
    ditherAlgorithm: context.getStampDitherAlgorithm(),
    patternStyle: context.getStampDitherPatternStyle(),
  });
}

export function setColorCycleBrushBandSpacing(
  context: ColorCycleBrushSettingsRuntimeContext,
  spacing: number,
): void {
  const clamped = context.setBandSpacing(spacing);
  if (clamped === null) {
    context.warn(`Invalid band spacing: ${spacing}, using default`);
  }
}

export function normalizeColorCycleBrushBandSpacing(
  context: ColorCycleBrushSettingsRuntimeContext,
  spacing?: number,
): number {
  return context.normalizeBandSpacingValue(spacing);
}

export function deriveColorCycleBrushBandCountFromDistance(
  context: ColorCycleBrushSettingsRuntimeContext,
  distance: number,
  spacing?: number,
): number {
  return context.deriveBandCountFromDistance(distance, spacing);
}

export function setColorCycleBrushStampShape(
  context: ColorCycleBrushSettingsRuntimeContext,
  shape: StampShape,
): void {
  context.setStampShape(shape);
}

export function setColorCycleBrushPressureEnabled(
  context: ColorCycleBrushSettingsRuntimeContext,
  enabled: boolean,
): void {
  context.setPressureEnabled(enabled);
}

export function setColorCycleBrushMinPressure(
  context: ColorCycleBrushSettingsRuntimeContext,
  min: number,
): void {
  context.setMinPressure(min);
}

export function setColorCycleBrushMaxPressure(
  context: ColorCycleBrushSettingsRuntimeContext,
  max: number,
): void {
  context.setMaxPressure(max);
}

export function setColorCycleBrushDitherEnabled(
  context: ColorCycleBrushSettingsRuntimeContext,
  enabled: boolean,
): void {
  const isEnabled = context.setShapeDitherEnabled(enabled);
  context.logGradientBrushPath('setDitherEnabled', {
    enabled: isEnabled,
    gradientBands: context.getGradientBands(),
    ditherAlgorithm: context.getStampDitherAlgorithm(),
    patternStyle: context.getStampDitherPatternStyle(),
  });
}

export function setColorCycleBrushDitherStrength(
  context: ColorCycleBrushSettingsRuntimeContext,
  strength: number,
): void {
  context.setDitherStrength(strength);
}

export function setColorCycleBrushDitherPixelSize(
  context: ColorCycleBrushSettingsRuntimeContext,
  size: number,
): void {
  context.setDitherPixelSize(size);
}

export function setColorCycleBrushPxlEdgeEnabled(
  context: ColorCycleBrushSettingsRuntimeContext,
  enabled: boolean,
): void {
  context.setPxlEdgeEnabled(enabled);
}

export function setColorCycleBrushPerceptualDither(
  context: ColorCycleBrushSettingsRuntimeContext,
  enabled: boolean,
): void {
  context.setPerceptualDither(enabled);
}

export function setColorCycleBrushStampDitherEnabled(
  context: ColorCycleBrushSettingsRuntimeContext,
  enabled: boolean,
): void {
  setColorCycleStampDitherEnabled(context.getStampDitherSettingsContext(), enabled);
}

export function setColorCycleBrushStampDitherAlgorithm(
  context: ColorCycleBrushSettingsRuntimeContext,
  algorithm?: StampDitherAlgorithm,
): void {
  const next = algorithm || 'sierra-lite';
  if (!context.setStampDitherAlgorithmValue(next)) {
    context.logGradientBrushPath('setStampDitherAlgorithm unchanged', {
      algorithm: next,
      gradientBands: context.getGradientBands(),
      ditherEnabled: context.isShapeDitherEnabled(),
      patternStyle: context.getStampDitherPatternStyle(),
    });
    return;
  }
  context.logGradientBrushPath('setStampDitherAlgorithm', {
    algorithm: next,
    gradientBands: context.getGradientBands(),
    ditherEnabled: context.isShapeDitherEnabled(),
    patternStyle: context.getStampDitherPatternStyle(),
  });
}

export function setColorCycleBrushStampDitherPatternStyle(
  context: ColorCycleBrushSettingsRuntimeContext,
  style?: PatternStyle,
): void {
  const next = style || 'dots';
  if (!context.setStampDitherPatternStyleValue(next)) {
    context.logGradientBrushPath('setStampDitherPatternStyle unchanged', {
      patternStyle: next,
      gradientBands: context.getGradientBands(),
      ditherEnabled: context.isShapeDitherEnabled(),
      ditherAlgorithm: context.getStampDitherAlgorithm(),
    });
    return;
  }
  context.logGradientBrushPath('setStampDitherPatternStyle', {
    patternStyle: next,
    gradientBands: context.getGradientBands(),
    ditherEnabled: context.isShapeDitherEnabled(),
    ditherAlgorithm: context.getStampDitherAlgorithm(),
  });
}

export function setColorCycleBrushStampDitherPatternTileSettings(
  context: ColorCycleBrushSettingsRuntimeContext,
  settings: PatternTileSettings = {},
): void {
  context.setStampDitherPatternTileSettings(settings);
}

export function setColorCycleBrushStampDitherPixelSize(
  context: ColorCycleBrushSettingsRuntimeContext,
  size: number,
): void {
  context.setStampDitherPixelSizeValue(size);
}

export function setColorCycleBrushStampDitherPressureLinked(
  context: ColorCycleBrushSettingsRuntimeContext,
  enabled: boolean,
): void {
  setColorCycleStampDitherPressureLinked(context.getStampDitherSettingsContext(), enabled);
}

export function setColorCycleBrushStampDitherBgFill(
  context: ColorCycleBrushSettingsRuntimeContext,
  enabled: boolean,
): void {
  context.setStampDitherBgFill(enabled);
}

export function setColorCycleBrushStampDitherClears(
  context: ColorCycleBrushSettingsRuntimeContext,
  enabled: boolean,
): void {
  context.setStampDitherClears(enabled);
}

export function setColorCycleBrushFlowMode(
  context: ColorCycleBrushSettingsRuntimeContext,
  mode: FlowMode,
): void {
  context.setRuntimeFlowMode(mode);
}

export function setColorCycleBrushFlowDirection(
  context: ColorCycleBrushSettingsRuntimeContext,
  direction: 'forward' | 'backward',
): void {
  setColorCycleBrushFlowMode(context, direction === 'backward' ? 'reverse' : 'forward');
}

export function getColorCycleBrushFlowMode(
  context: ColorCycleBrushSettingsRuntimeContext,
): FlowMode {
  return context.getFlowMode();
}

export function getColorCycleBrushFlowDirection(
  context: ColorCycleBrushSettingsRuntimeContext,
): 'forward' | 'backward' {
  return context.getFlowMode() === 'reverse' ? 'backward' : 'forward';
}

export function toggleColorCycleBrushFlowDirection(
  context: ColorCycleBrushSettingsRuntimeContext,
): void {
  setColorCycleBrushFlowMode(context, 'forward');
}

export function setColorCycleBrushLegacyFlowMode(
  context: ColorCycleBrushSettingsRuntimeContext,
  mode: FlowMode,
): void {
  context.setRuntimeLegacyFlowMode(mode);
  context.forEachAnimator((animator) => animator.setFlowMode('forward'));
}
