import type { BrushSettings } from '@/types';

import type { CCBrushSettingsPatch } from './colorCycleBrushContracts';

export type ColorCycleSettingsPatchBrush = {
  applySettings?: (settings: CCBrushSettingsPatch) => void;
  setSpeed?: (speed: number) => void;
  setLayerBaseSpeed?: (speed: number) => void;
  setPlaybackSpeedScale?: (scale: number) => void;
  setFPS?: (fps: number) => void;
  setBrushSize?: (size: number) => void;
  setGradientBands?: (bands: number) => void;
  setBandSpacing?: (spacing: number) => void;
  setPressureEnabled?: (enabled: boolean) => void;
  setMinPressure?: (value: number) => void;
  setMaxPressure?: (value: number) => void;
  setDitherEnabled?: (enabled: boolean) => void;
  setDitherStrength?: (value: number) => void;
  setDitherPixelSize?: (value: number) => void;
  setPxlEdgeEnabled?: (enabled: boolean) => void;
  setStampShape?: (shape: NonNullable<CCBrushSettingsPatch['stampShape']>) => void;
  setStampDitherEnabled?: (enabled: boolean) => void;
  setStampDitherAlgorithm?: (algorithm?: BrushSettings['ditherAlgorithm']) => void;
  setStampDitherPatternStyle?: (style?: BrushSettings['patternStyle']) => void;
  setStampDitherPatternTileSettings?: (settings: Pick<
    BrushSettings,
    | 'patternTileId'
    | 'patternTileScale'
    | 'patternTileInvert'
    | 'patternTileThreshold'
    | 'patternTileOffsetX'
    | 'patternTileOffsetY'
  >) => void;
  setStampDitherPressureLinked?: (enabled: boolean) => void;
  setStampDitherBgFill?: (enabled: boolean) => void;
  setStampDitherClears?: (enabled: boolean) => void;
  setStampDitherPixelSize?: (size: number) => void;
  setLegacyFlowMode?: (mode: 'forward' | 'reverse' | 'pingpong') => void;
  setFlowMode?: (mode: 'forward' | 'reverse' | 'pingpong') => void;
  setFlowDirection?: (direction: 'forward' | 'backward') => void;
};

const hasSetting = <K extends keyof CCBrushSettingsPatch>(
  settings: CCBrushSettingsPatch,
  key: K,
): settings is CCBrushSettingsPatch & Required<Pick<CCBrushSettingsPatch, K>> => (
  Object.prototype.hasOwnProperty.call(settings, key)
);

export const applyColorCycleBrushSettingsPatch = (
  brush: ColorCycleSettingsPatchBrush | null,
  settings: CCBrushSettingsPatch,
): void => {
  if (!brush) {
    return;
  }

  const instance = brush as ColorCycleSettingsPatchBrush;
  if (typeof instance.applySettings === 'function') {
    instance.applySettings(settings);
    return;
  }

  if (hasSetting(settings, 'cycleSpeed') && typeof instance.setSpeed === 'function') {
    instance.setSpeed(settings.cycleSpeed);
  }
  if (hasSetting(settings, 'layerBaseSpeed') && typeof instance.setLayerBaseSpeed === 'function') {
    instance.setLayerBaseSpeed(settings.layerBaseSpeed);
  }
  if (hasSetting(settings, 'playbackSpeedScale') && typeof instance.setPlaybackSpeedScale === 'function') {
    instance.setPlaybackSpeedScale(settings.playbackSpeedScale);
  }
  if (hasSetting(settings, 'fps') && typeof instance.setFPS === 'function') {
    instance.setFPS(settings.fps);
  }
  if (hasSetting(settings, 'brushSize') && typeof instance.setBrushSize === 'function') {
    instance.setBrushSize(settings.brushSize);
  }
  if (hasSetting(settings, 'gradientBands') && typeof instance.setGradientBands === 'function') {
    instance.setGradientBands(settings.gradientBands);
  }
  if (hasSetting(settings, 'bandSpacing') && typeof instance.setBandSpacing === 'function') {
    instance.setBandSpacing(settings.bandSpacing);
  }
  if (hasSetting(settings, 'pressureEnabled') && typeof instance.setPressureEnabled === 'function') {
    instance.setPressureEnabled(settings.pressureEnabled);
  }
  if (hasSetting(settings, 'minPressure') && typeof instance.setMinPressure === 'function') {
    instance.setMinPressure(settings.minPressure);
  }
  if (hasSetting(settings, 'maxPressure') && typeof instance.setMaxPressure === 'function') {
    instance.setMaxPressure(settings.maxPressure);
  }
  if (hasSetting(settings, 'ditherEnabled') && typeof instance.setDitherEnabled === 'function') {
    instance.setDitherEnabled(settings.ditherEnabled);
  }
  if (hasSetting(settings, 'ditherStrength') && typeof instance.setDitherStrength === 'function') {
    instance.setDitherStrength(settings.ditherStrength);
  }
  if (hasSetting(settings, 'ditherPixelSize') && typeof instance.setDitherPixelSize === 'function') {
    instance.setDitherPixelSize(settings.ditherPixelSize);
  }
  if (hasSetting(settings, 'pxlEdgeEnabled') && typeof instance.setPxlEdgeEnabled === 'function') {
    instance.setPxlEdgeEnabled(settings.pxlEdgeEnabled);
  }
  if (hasSetting(settings, 'stampShape') && typeof instance.setStampShape === 'function') {
    instance.setStampShape(settings.stampShape);
  }
  if (hasSetting(settings, 'stampDitherEnabled') && typeof instance.setStampDitherEnabled === 'function') {
    instance.setStampDitherEnabled(settings.stampDitherEnabled);
  }
  if (hasSetting(settings, 'stampDitherAlgorithm') && typeof instance.setStampDitherAlgorithm === 'function') {
    instance.setStampDitherAlgorithm(settings.stampDitherAlgorithm);
  }
  if (hasSetting(settings, 'stampDitherPatternStyle') && typeof instance.setStampDitherPatternStyle === 'function') {
    instance.setStampDitherPatternStyle(settings.stampDitherPatternStyle);
  }
  if (
    typeof instance.setStampDitherPatternTileSettings === 'function' &&
    (
      hasSetting(settings, 'stampDitherPatternTileId') ||
      hasSetting(settings, 'stampDitherPatternTileScale') ||
      hasSetting(settings, 'stampDitherPatternTileInvert') ||
      hasSetting(settings, 'stampDitherPatternTileThreshold') ||
      hasSetting(settings, 'stampDitherPatternTileOffsetX') ||
      hasSetting(settings, 'stampDitherPatternTileOffsetY')
    )
  ) {
    instance.setStampDitherPatternTileSettings({
      patternTileId: settings.stampDitherPatternTileId,
      patternTileScale: settings.stampDitherPatternTileScale,
      patternTileInvert: settings.stampDitherPatternTileInvert,
      patternTileThreshold: settings.stampDitherPatternTileThreshold,
      patternTileOffsetX: settings.stampDitherPatternTileOffsetX,
      patternTileOffsetY: settings.stampDitherPatternTileOffsetY,
    });
  }
  if (hasSetting(settings, 'stampDitherPixelSize') && typeof instance.setStampDitherPixelSize === 'function') {
    instance.setStampDitherPixelSize(settings.stampDitherPixelSize);
  }
  if (
    hasSetting(settings, 'stampDitherPressureLinked') &&
    typeof instance.setStampDitherPressureLinked === 'function'
  ) {
    instance.setStampDitherPressureLinked(settings.stampDitherPressureLinked);
  }
  if (hasSetting(settings, 'stampDitherBgFill')) {
    if (typeof instance.setStampDitherBgFill === 'function') {
      instance.setStampDitherBgFill(settings.stampDitherBgFill);
    } else if (typeof instance.setStampDitherClears === 'function') {
      instance.setStampDitherClears(!settings.stampDitherBgFill);
    }
  }
  if (hasSetting(settings, 'legacyFlowMode') && typeof instance.setLegacyFlowMode === 'function') {
    instance.setLegacyFlowMode(settings.legacyFlowMode);
  }
  if (hasSetting(settings, 'flowMode')) {
    if (typeof instance.setFlowMode === 'function') {
      instance.setFlowMode(settings.flowMode);
    } else if (typeof instance.setFlowDirection === 'function') {
      instance.setFlowDirection(settings.flowMode === 'reverse' ? 'backward' : 'forward');
    }
  }
};
