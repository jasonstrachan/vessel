import type { BrushSettings, CcCustomTilePattern } from '@/types';

import type {
  CCBrushSettingsPatch,
} from './colorCycleBrushContracts';
import {
  applyColorCycleBrushSettings,
  deriveColorCycleBrushBandCountFromDistance,
  getColorCycleBrushFlowDirection,
  getColorCycleBrushFlowMode,
  normalizeColorCycleBrushBandSpacing,
  readColorCycleBrushSettings,
  setColorCycleBrushBandSpacing,
  setColorCycleBrushDitherEnabled,
  setColorCycleBrushDitherPixelSize,
  setColorCycleBrushDitherStrength,
  setColorCycleBrushFlowDirection,
  setColorCycleBrushFlowMode,
  setColorCycleBrushFps,
  setColorCycleBrushGradientBands,
  setColorCycleBrushLayerBaseSpeed,
  setColorCycleBrushLegacyFlowMode,
  setColorCycleBrushMaxPressure,
  setColorCycleBrushMinPressure,
  setColorCycleBrushPerceptualDither,
  setColorCycleBrushPhase,
  setColorCycleBrushPlaybackSpeedScale,
  setColorCycleBrushPressureEnabled,
  setColorCycleBrushPxlEdgeEnabled,
  setColorCycleBrushSize,
  setColorCycleBrushSpeed,
  setColorCycleBrushStampDitherAlgorithm,
  setColorCycleBrushStampDitherBgFill,
  setColorCycleBrushStampDitherClears,
  setColorCycleBrushStampDitherEnabled,
  setColorCycleBrushStampDitherPatternStyle,
  setColorCycleBrushStampDitherPatternTileSettings,
  setColorCycleBrushStampDitherPixelSize,
  setColorCycleBrushStampDitherPressureLinked,
  setColorCycleBrushStampShape,
  toggleColorCycleBrushFlowDirection,
  type ColorCycleBrushSettingsRuntimeContext,
} from './colorCycleBrushSettingsRuntime';
import type { StampDitherAlgorithm } from './strokeStampDither';
import type { PatternStyle } from '@/utils/ditherAlgorithms';
import type { StampShape } from './colorCycleBrushContracts';
import type { LayerStrokeState } from './colorCycleCanvas2DTypes';
import {
  ColorCycleCoreBrushSettingsState,
  type ColorCycleLayerBaseSpeedChange,
} from './colorCycleCoreBrushSettingsState';
import type { ColorCycleLayerBaseSpeedContext } from './colorCycleLayerBaseSpeedRuntime';
import { ColorCycleStampDitherState } from './colorCycleStampDitherState';
import type { ColorCycleStampDitherSettingsContext } from './colorCycleStampDitherSettingsRuntime';

type StampDitherPatternTileSettings = Pick<
  BrushSettings,
  | 'patternTileId'
  | 'patternTileScale'
  | 'patternTileInvert'
  | 'patternTileThreshold'
  | 'patternTileOffsetX'
  | 'patternTileOffsetY'
>;

export type ColorCycleBrushSettingsApiRuntimeDeps =
  Pick<
    ColorCycleBrushSettingsRuntimeContext,
    | 'getShapeFillSettings'
    | 'isShapeDitherEnabled'
    | 'getGradientBands'
    | 'setGradientBands'
    | 'setBandSpacing'
    | 'normalizeBandSpacingValue'
    | 'deriveBandCountFromDistance'
    | 'setShapeDitherEnabled'
    | 'setDitherStrength'
    | 'setDitherPixelSize'
    | 'setPxlEdgeEnabled'
    | 'setPerceptualDither'
    | 'getFlowMode'
    | 'getLegacyFlowMode'
    | 'setRuntimeFlowMode'
    | 'setRuntimeLegacyFlowMode'
    | 'getFps'
    | 'getPlaybackSpeedScale'
    | 'forEachAnimator'
    | 'setPhaseValue'
    | 'setPlaybackSpeedScaleValue'
    | 'setFpsValue'
    | 'render'
    | 'warn'
    | 'logGradientBrushPath'
  >
  & {
    getStrokeStateValues: ColorCycleStampDitherSettingsContext['getStrokeStateValues'];
    getStrokeStateEntries(): Iterable<[string, LayerStrokeState]>;
    getActiveLayerId(): string | null;
    getStrokeCounter(): number;
    publishLayerBaseSpeed: ColorCycleLayerBaseSpeedContext['publishLayerBaseSpeed'];
    getAnimator: ColorCycleLayerBaseSpeedContext['getAnimator'];
  };

export class ColorCycleBrushSettingsApiRuntime {
  private readonly coreSettings = new ColorCycleCoreBrushSettingsState();
  private readonly stampDitherState = new ColorCycleStampDitherState();

  constructor(
    private readonly deps: ColorCycleBrushSettingsApiRuntimeDeps,
  ) {}

  getSettings = () => readColorCycleBrushSettings(this.getContext());
  applySettings = (settings: CCBrushSettingsPatch): void => applyColorCycleBrushSettings(this.getContext(), settings);
  setPhase = (phase: number): void => setColorCycleBrushPhase(this.getContext(), phase);
  setSpeed = (speed: number): void => setColorCycleBrushSpeed(this.getContext(), speed);
  setLayerBaseSpeed = (speed: number): void => setColorCycleBrushLayerBaseSpeed(this.getContext(), speed);
  setPlaybackSpeedScale = (scale: number): void => setColorCycleBrushPlaybackSpeedScale(this.getContext(), scale);
  setFPS = (fps: number): void => setColorCycleBrushFps(this.getContext(), fps);
  setBrushSize = (size: number): void => setColorCycleBrushSize(this.getContext(), size);
  setGradientBands = (bands: number): void => setColorCycleBrushGradientBands(this.getContext(), bands);
  setBandSpacing = (spacing: number): void => setColorCycleBrushBandSpacing(this.getContext(), spacing);
  normalizeBandSpacingValue = (spacing?: number): number => normalizeColorCycleBrushBandSpacing(this.getContext(), spacing);
  deriveBandCountFromDistance = (distance: number, spacing?: number): number =>
    deriveColorCycleBrushBandCountFromDistance(this.getContext(), distance, spacing);
  setStampShape = (shape: StampShape): void => setColorCycleBrushStampShape(this.getContext(), shape);
  setPressureEnabled = (enabled: boolean): void => setColorCycleBrushPressureEnabled(this.getContext(), enabled);
  setMinPressure = (min: number): void => setColorCycleBrushMinPressure(this.getContext(), min);
  setMaxPressure = (max: number): void => setColorCycleBrushMaxPressure(this.getContext(), max);
  setDitherEnabled = (enabled: boolean): void => setColorCycleBrushDitherEnabled(this.getContext(), enabled);
  setDitherStrength = (strength: number): void => setColorCycleBrushDitherStrength(this.getContext(), strength);
  setDitherPixelSize = (size: number): void => setColorCycleBrushDitherPixelSize(this.getContext(), size);
  setPxlEdgeEnabled = (enabled: boolean): void => setColorCycleBrushPxlEdgeEnabled(this.getContext(), enabled);
  setPerceptualDither = (enabled: boolean): void => setColorCycleBrushPerceptualDither(this.getContext(), enabled);
  setStampDitherEnabled = (enabled: boolean): void => setColorCycleBrushStampDitherEnabled(this.getContext(), enabled);
  setStampDitherAlgorithm = (algorithm?: StampDitherAlgorithm): void =>
    setColorCycleBrushStampDitherAlgorithm(this.getContext(), algorithm);
  setStampDitherPatternStyle = (style?: PatternStyle): void =>
    setColorCycleBrushStampDitherPatternStyle(this.getContext(), style);
  setStampDitherPatternTileSettings = (settings: StampDitherPatternTileSettings = {}): void =>
    setColorCycleBrushStampDitherPatternTileSettings(this.getContext(), settings);
  setStampDitherPixelSize = (size: number): void => setColorCycleBrushStampDitherPixelSize(this.getContext(), size);
  setStampDitherPressureLinked = (enabled: boolean): void =>
    setColorCycleBrushStampDitherPressureLinked(this.getContext(), enabled);
  setStampDitherBgFill = (enabled: boolean): void => setColorCycleBrushStampDitherBgFill(this.getContext(), enabled);
  setStampDitherClears = (enabled: boolean): void => setColorCycleBrushStampDitherClears(this.getContext(), enabled);
  setFlowMode = (mode: 'forward' | 'reverse' | 'pingpong'): void => setColorCycleBrushFlowMode(this.getContext(), mode);
  setLegacyFlowMode = (mode: 'forward' | 'reverse' | 'pingpong'): void =>
    setColorCycleBrushLegacyFlowMode(this.getContext(), mode);
  setFlowDirection = (direction: 'forward' | 'backward'): void =>
    setColorCycleBrushFlowDirection(this.getContext(), direction);
  getFlowMode = (): 'forward' | 'reverse' | 'pingpong' => getColorCycleBrushFlowMode(this.getContext());
  getFlowDirection = (): 'forward' | 'backward' => getColorCycleBrushFlowDirection(this.getContext());
  toggleFlowDirection = (): void => toggleColorCycleBrushFlowDirection(this.getContext());

  setInitialBrushSize = (brushSize?: number): void => {
    if (typeof brushSize === 'number') {
      this.coreSettings.setBrushSize(brushSize);
    }
  };

  getBrushSizeValue = (): number => this.coreSettings.getBrushSize();
  getCycleSpeedValue = (): number => this.coreSettings.getCycleSpeed();
  getLayerBaseSpeedValue = (): number => this.coreSettings.getLayerBaseSpeed();
  isPressureEnabledValue = (): boolean => this.coreSettings.isPressureEnabled();
  getMinPressureValue = (): number => this.coreSettings.getMinPressure();
  getMaxPressureValue = (): number => this.coreSettings.getMaxPressure();
  getStampShapeValue = (): StampShape => this.coreSettings.getStampShape();
  setCycleSpeedValue = (speed: number): number | null => this.coreSettings.setCycleSpeed(speed);
  setLayerBaseSpeedValue = (speed: number): ColorCycleLayerBaseSpeedChange | null =>
    this.coreSettings.setLayerBaseSpeed(speed);
  setBrushSizeValue = (size: number): number | null => this.coreSettings.setBrushSize(size);
  setStampShapeValue = (shape: StampShape): void => {
    this.coreSettings.setStampShape(shape);
  };
  setPressureEnabledValue = (enabled: boolean): void => {
    this.coreSettings.setPressureEnabled(enabled);
  };
  setMinPressureValue = (min: number): void => {
    this.coreSettings.setMinPressure(min);
  };
  setMaxPressureValue = (max: number): void => {
    this.coreSettings.setMaxPressure(max);
  };
  shouldPreserveGradientPhaseOnChange = (): boolean => (
    this.coreSettings.shouldPreserveGradientPhaseOnChange()
  );
  setPreserveGradientPhaseOnChange = (enabled: boolean): void => {
    this.coreSettings.setPreserveGradientPhaseOnChange(enabled);
  };
  resolvePressureBrushSize = (pressure: number): number => (
    this.coreSettings.resolvePressureBrushSize(pressure)
  );
  getResolvedWriteCycleSpeed = (rawSpeed?: number | null): number => (
    this.coreSettings.getResolvedWriteCycleSpeed(rawSpeed)
  );

  getStampDitherSettings = () => this.stampDitherState.getSettings();
  isStampDitherEnabled = (): boolean => this.stampDitherState.isEnabled();
  getStampDitherAlgorithm = (): StampDitherAlgorithm => this.stampDitherState.getAlgorithm();
  getStampDitherPatternStyle = (): PatternStyle => this.stampDitherState.getPatternStyle();
  getStampDitherPixelSize = (): number => this.stampDitherState.getPixelSize();
  keepsStampDitherBackgroundFill = (): boolean => this.stampDitherState.keepsBackgroundFill();
  isStampDitherPressureLinked = (): boolean => this.stampDitherState.isPressureLinked();
  getStampDitherRuntime = () => this.stampDitherState.getRuntime();
  clearStampDitherRuntime = (): void => this.stampDitherState.clearRuntime();
  setStampDitherEnabledValue = (enabled: boolean): boolean => this.stampDitherState.setEnabled(enabled);
  setStampDitherAlgorithmValue = (algorithm?: StampDitherAlgorithm): boolean =>
    this.stampDitherState.setAlgorithm(algorithm);
  setStampDitherPatternStyleValue = (style?: PatternStyle): boolean =>
    this.stampDitherState.setPatternStyle(style);
  setStampDitherPatternTileSettingsValue = (settings: StampDitherPatternTileSettings = {}): boolean =>
    this.stampDitherState.setPatternTileSettings(settings);
  setStampDitherPixelSizeValue = (size: number): boolean => this.stampDitherState.setPixelSize(size);
  setStampDitherPressureLinkedValue = (enabled: boolean): void => {
    this.stampDitherState.setPressureLinked(enabled);
  };
  setStampDitherBgFillValue = (enabled: boolean): void => {
    this.stampDitherState.setBgFill(enabled);
  };
  setStampDitherClearsValue = (enabled: boolean): void => {
    this.stampDitherState.setClears(enabled);
  };
  createStampDitherConfig = (options: { patterns: CcCustomTilePattern[] | undefined; seed: number }) =>
    this.stampDitherState.createConfig(options);
  getStampDitherImageTileThresholdResolver = (patterns: CcCustomTilePattern[] | undefined) =>
    this.stampDitherState.getImageTileThresholdResolver(patterns);

  private getContext = (): ColorCycleBrushSettingsRuntimeContext => ({
    getBrushSize: () => this.getBrushSizeValue(),
    getCycleSpeed: () => this.getCycleSpeedValue(),
    getLayerBaseSpeed: () => this.getLayerBaseSpeedValue(),
    isPressureEnabled: () => this.isPressureEnabledValue(),
    getMinPressure: () => this.getMinPressureValue(),
    getMaxPressure: () => this.getMaxPressureValue(),
    getStampShape: () => this.getStampShapeValue(),
    setCycleSpeed: (speed) => this.setCycleSpeedValue(speed),
    setLayerBaseSpeed: (speed) => this.setLayerBaseSpeedValue(speed),
    setBrushSize: (size) => this.setBrushSizeValue(size),
    setStampShape: (shape) => this.setStampShapeValue(shape),
    setPressureEnabled: (enabled) => this.setPressureEnabledValue(enabled),
    setMinPressure: (min) => this.setMinPressureValue(min),
    setMaxPressure: (max) => this.setMaxPressureValue(max),
    getShapeFillSettings: () => this.deps.getShapeFillSettings(),
    isShapeDitherEnabled: () => this.deps.isShapeDitherEnabled(),
    getGradientBands: () => this.deps.getGradientBands(),
    setGradientBands: (bands) => this.deps.setGradientBands(bands),
    setBandSpacing: (spacing) => this.deps.setBandSpacing(spacing),
    normalizeBandSpacingValue: (spacing) => this.deps.normalizeBandSpacingValue(spacing),
    deriveBandCountFromDistance: (distance, spacing) =>
      this.deps.deriveBandCountFromDistance(distance, spacing),
    setShapeDitherEnabled: (enabled) => this.deps.setShapeDitherEnabled(enabled),
    setDitherStrength: (strength) => this.deps.setDitherStrength(strength),
    setDitherPixelSize: (size) => this.deps.setDitherPixelSize(size),
    setPxlEdgeEnabled: (enabled) => this.deps.setPxlEdgeEnabled(enabled),
    setPerceptualDither: (enabled) => this.deps.setPerceptualDither(enabled),
    getStampDitherSettings: () => this.getStampDitherSettings(),
    getStampDitherAlgorithm: () => this.getStampDitherAlgorithm(),
    getStampDitherPatternStyle: () => this.getStampDitherPatternStyle(),
    setStampDitherAlgorithmValue: (algorithm) => this.setStampDitherAlgorithmValue(algorithm),
    setStampDitherPatternStyleValue: (style) => this.setStampDitherPatternStyleValue(style),
    setStampDitherPatternTileSettings: (settings) => this.setStampDitherPatternTileSettingsValue(settings),
    setStampDitherPixelSizeValue: (size) => this.setStampDitherPixelSizeValue(size),
    setStampDitherBgFill: (enabled) => this.setStampDitherBgFillValue(enabled),
    setStampDitherClears: (enabled) => this.setStampDitherClearsValue(enabled),
    getFlowMode: () => this.deps.getFlowMode(),
    getLegacyFlowMode: () => this.deps.getLegacyFlowMode(),
    setRuntimeFlowMode: (mode) => this.deps.setRuntimeFlowMode(mode),
    setRuntimeLegacyFlowMode: (mode) => this.deps.setRuntimeLegacyFlowMode(mode),
    getFps: () => this.deps.getFps(),
    getPlaybackSpeedScale: () => this.deps.getPlaybackSpeedScale(),
    forEachAnimator: (callback) => this.deps.forEachAnimator(callback),
    setPhaseValue: (phase) => this.deps.setPhaseValue(phase),
    setPlaybackSpeedScaleValue: (scale) => this.deps.setPlaybackSpeedScaleValue(scale),
    setFpsValue: (fps) => this.deps.setFpsValue(fps),
    getLayerBaseSpeedContext: () => this.getLayerBaseSpeedContext(),
    getStampDitherSettingsContext: () => this.getStampDitherSettingsContext(),
    render: (force) => this.deps.render(force),
    warn: (message) => this.deps.warn(message),
    logGradientBrushPath: (event, data) => this.deps.logGradientBrushPath(event, data),
  });

  private getStampDitherSettingsContext = (): ColorCycleStampDitherSettingsContext => ({
    setStampDitherEnabled: (enabled) => this.setStampDitherEnabledValue(enabled),
    setStampDitherPressureLinked: (enabled) => this.setStampDitherPressureLinkedValue(enabled),
    getStrokeStateValues: () => this.deps.getStrokeStateValues(),
  });

  private getLayerBaseSpeedContext = (): ColorCycleLayerBaseSpeedContext => ({
    getStrokeStateEntries: () => this.deps.getStrokeStateEntries(),
    getActiveLayerId: () => this.deps.getActiveLayerId(),
    isStampDitherEnabled: () => this.isStampDitherEnabled(),
    getStrokeCounter: () => this.deps.getStrokeCounter(),
    getResolvedWriteCycleSpeed: () => this.getResolvedWriteCycleSpeed(),
    publishLayerBaseSpeed: (layerId, nextBaseSpeed, strokeData, pixelsChanged) =>
      this.deps.publishLayerBaseSpeed(layerId, nextBaseSpeed, strokeData, pixelsChanged),
    getAnimator: (layerId) => this.deps.getAnimator(layerId),
    forEachAnimator: (callback) => this.deps.forEachAnimator(callback),
    getPlaybackSpeedScale: () => this.deps.getPlaybackSpeedScale(),
    render: (force) => this.deps.render(force),
  });
}
