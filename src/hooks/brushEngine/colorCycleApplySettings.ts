import type {
  CCBrushSettings,
  CCBrushSettingsPatch,
} from './colorCycleBrushContracts';

type PatternTileSettings = {
  patternTileId?: string | null;
  patternTileScale?: number | null;
  patternTileInvert?: boolean | null;
  patternTileThreshold?: number | null;
  patternTileOffsetX?: number | null;
  patternTileOffsetY?: number | null;
};

export type ColorCycleApplySettingsContext = {
  current: CCBrushSettings;
  actions: {
    setSpeed: (value: number) => void;
    setLayerBaseSpeed: (value: number) => void;
    setPlaybackSpeedScale: (value: number) => void;
    setFPS: (value: number) => void;
    setBrushSize: (value: number) => void;
    setGradientBands: (value: number) => void;
    setBandSpacing: (value: number) => void;
    setPressureEnabled: (value: boolean) => void;
    setMinPressure: (value: number) => void;
    setMaxPressure: (value: number) => void;
    setDitherEnabled: (value: boolean) => void;
    setDitherStrength: (value: number) => void;
    setDitherPixelSize: (value: number) => void;
    setPxlEdgeEnabled: (value: boolean) => void;
    setPerceptualDither: (value: boolean) => void;
    setStampShape: (value: CCBrushSettings['stampShape']) => void;
    setStampDitherEnabled: (value: boolean) => void;
    setStampDitherAlgorithm: (value: CCBrushSettings['stampDitherAlgorithm']) => void;
    setStampDitherPatternStyle: (value: CCBrushSettings['stampDitherPatternStyle']) => void;
    setStampDitherPatternTileSettings: (value: PatternTileSettings) => void;
    setStampDitherPixelSize: (value: number) => void;
    setStampDitherPressureLinked: (value: boolean) => void;
    setStampDitherBgFill: (value: boolean) => void;
    setLegacyFlowMode: (value: CCBrushSettings['legacyFlowMode']) => void;
    setFlowMode: (value: CCBrushSettings['flowMode']) => void;
  };
};

const hasOwnSetting = <K extends keyof CCBrushSettings>(
  settings: CCBrushSettingsPatch,
  key: K,
): settings is CCBrushSettingsPatch & Pick<CCBrushSettings, K> => (
  Object.prototype.hasOwnProperty.call(settings, key)
);

export const applyColorCycleSettingsPatch = (
  settings: CCBrushSettingsPatch,
  context: ColorCycleApplySettingsContext,
): void => {
  const { current, actions } = context;

  if (hasOwnSetting(settings, 'cycleSpeed') && settings.cycleSpeed !== current.cycleSpeed) {
    actions.setSpeed(settings.cycleSpeed);
  }
  if (hasOwnSetting(settings, 'layerBaseSpeed') && settings.layerBaseSpeed !== current.layerBaseSpeed) {
    actions.setLayerBaseSpeed(settings.layerBaseSpeed);
  }
  if (hasOwnSetting(settings, 'playbackSpeedScale') && settings.playbackSpeedScale !== current.playbackSpeedScale) {
    actions.setPlaybackSpeedScale(settings.playbackSpeedScale);
  }
  if (hasOwnSetting(settings, 'fps') && settings.fps !== current.fps) {
    actions.setFPS(settings.fps);
  }
  if (hasOwnSetting(settings, 'brushSize') && settings.brushSize !== current.brushSize) {
    actions.setBrushSize(settings.brushSize);
  }
  if (hasOwnSetting(settings, 'gradientBands') && settings.gradientBands !== current.gradientBands) {
    actions.setGradientBands(settings.gradientBands);
  }
  if (hasOwnSetting(settings, 'bandSpacing') && settings.bandSpacing !== current.bandSpacing) {
    actions.setBandSpacing(settings.bandSpacing);
  }
  if (hasOwnSetting(settings, 'pressureEnabled') && settings.pressureEnabled !== current.pressureEnabled) {
    actions.setPressureEnabled(settings.pressureEnabled);
  }
  if (hasOwnSetting(settings, 'minPressure') && settings.minPressure !== current.minPressure) {
    actions.setMinPressure(settings.minPressure);
  }
  if (hasOwnSetting(settings, 'maxPressure') && settings.maxPressure !== current.maxPressure) {
    actions.setMaxPressure(settings.maxPressure);
  }
  if (hasOwnSetting(settings, 'ditherEnabled') && settings.ditherEnabled !== current.ditherEnabled) {
    actions.setDitherEnabled(settings.ditherEnabled);
  }
  if (hasOwnSetting(settings, 'ditherStrength') && settings.ditherStrength !== current.ditherStrength) {
    actions.setDitherStrength(settings.ditherStrength);
  }
  if (hasOwnSetting(settings, 'ditherPixelSize') && settings.ditherPixelSize !== current.ditherPixelSize) {
    actions.setDitherPixelSize(settings.ditherPixelSize);
  }
  if (hasOwnSetting(settings, 'pxlEdgeEnabled') && settings.pxlEdgeEnabled !== current.pxlEdgeEnabled) {
    actions.setPxlEdgeEnabled(settings.pxlEdgeEnabled);
  }
  if (hasOwnSetting(settings, 'perceptualDither') && settings.perceptualDither !== current.perceptualDither) {
    actions.setPerceptualDither(settings.perceptualDither);
  }
  if (hasOwnSetting(settings, 'stampShape') && settings.stampShape !== current.stampShape) {
    actions.setStampShape(settings.stampShape);
  }
  if (hasOwnSetting(settings, 'stampDitherEnabled') && settings.stampDitherEnabled !== current.stampDitherEnabled) {
    actions.setStampDitherEnabled(settings.stampDitherEnabled);
  }
  if (hasOwnSetting(settings, 'stampDitherAlgorithm') && settings.stampDitherAlgorithm !== current.stampDitherAlgorithm) {
    actions.setStampDitherAlgorithm(settings.stampDitherAlgorithm);
  }
  if (
    hasOwnSetting(settings, 'stampDitherPatternStyle') &&
    settings.stampDitherPatternStyle !== current.stampDitherPatternStyle
  ) {
    actions.setStampDitherPatternStyle(settings.stampDitherPatternStyle);
  }
  if (
    (hasOwnSetting(settings, 'stampDitherPatternTileId') &&
      settings.stampDitherPatternTileId !== current.stampDitherPatternTileId) ||
    (hasOwnSetting(settings, 'stampDitherPatternTileScale') &&
      settings.stampDitherPatternTileScale !== current.stampDitherPatternTileScale) ||
    (hasOwnSetting(settings, 'stampDitherPatternTileInvert') &&
      settings.stampDitherPatternTileInvert !== current.stampDitherPatternTileInvert) ||
    (hasOwnSetting(settings, 'stampDitherPatternTileThreshold') &&
      settings.stampDitherPatternTileThreshold !== current.stampDitherPatternTileThreshold) ||
    (hasOwnSetting(settings, 'stampDitherPatternTileOffsetX') &&
      settings.stampDitherPatternTileOffsetX !== current.stampDitherPatternTileOffsetX) ||
    (hasOwnSetting(settings, 'stampDitherPatternTileOffsetY') &&
      settings.stampDitherPatternTileOffsetY !== current.stampDitherPatternTileOffsetY)
  ) {
    actions.setStampDitherPatternTileSettings({
      patternTileId: hasOwnSetting(settings, 'stampDitherPatternTileId')
        ? settings.stampDitherPatternTileId
        : current.stampDitherPatternTileId,
      patternTileScale: hasOwnSetting(settings, 'stampDitherPatternTileScale')
        ? settings.stampDitherPatternTileScale
        : current.stampDitherPatternTileScale,
      patternTileInvert: hasOwnSetting(settings, 'stampDitherPatternTileInvert')
        ? settings.stampDitherPatternTileInvert
        : current.stampDitherPatternTileInvert,
      patternTileThreshold: hasOwnSetting(settings, 'stampDitherPatternTileThreshold')
        ? settings.stampDitherPatternTileThreshold
        : current.stampDitherPatternTileThreshold,
      patternTileOffsetX: hasOwnSetting(settings, 'stampDitherPatternTileOffsetX')
        ? settings.stampDitherPatternTileOffsetX
        : current.stampDitherPatternTileOffsetX,
      patternTileOffsetY: hasOwnSetting(settings, 'stampDitherPatternTileOffsetY')
        ? settings.stampDitherPatternTileOffsetY
        : current.stampDitherPatternTileOffsetY,
    });
  }
  if (hasOwnSetting(settings, 'stampDitherPixelSize') && settings.stampDitherPixelSize !== current.stampDitherPixelSize) {
    actions.setStampDitherPixelSize(settings.stampDitherPixelSize);
  }
  if (
    hasOwnSetting(settings, 'stampDitherPressureLinked') &&
    settings.stampDitherPressureLinked !== current.stampDitherPressureLinked
  ) {
    actions.setStampDitherPressureLinked(settings.stampDitherPressureLinked);
  }
  if (hasOwnSetting(settings, 'stampDitherBgFill') && settings.stampDitherBgFill !== current.stampDitherBgFill) {
    actions.setStampDitherBgFill(settings.stampDitherBgFill);
  }
  if (hasOwnSetting(settings, 'legacyFlowMode') && settings.legacyFlowMode !== current.legacyFlowMode) {
    actions.setLegacyFlowMode(settings.legacyFlowMode);
  }
  if (hasOwnSetting(settings, 'flowMode') && settings.flowMode !== current.flowMode) {
    actions.setFlowMode(settings.flowMode);
  }
};
