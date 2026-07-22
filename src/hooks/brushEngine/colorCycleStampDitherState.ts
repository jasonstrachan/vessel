import {
  createCcCustomTileThresholdResolver,
  type CcCustomTilePatternSettings,
} from '@/utils/colorCycle/ccCustomTilePattern';
import type {
  BrushSettings,
  CcCustomTilePattern,
} from '@/types';
import type { PatternStyle } from '@/utils/ditherAlgorithms';
import { localDitherPatternRegistry } from '@/utils/ditherPatterns/ditherPatternRegistry';

import {
  clearStampDitherRuntime,
  createStampDitherRuntime,
  syncStampDitherRuntimeVersion,
  type StampDitherAlgorithm,
  type StampDitherConfig,
} from './strokeStampDither';

type StampDitherTileSettingsPatch = Pick<
  BrushSettings,
  | 'patternTileId'
  | 'patternTileScale'
  | 'patternTileInvert'
  | 'patternTileThreshold'
  | 'patternTileOffsetX'
  | 'patternTileOffsetY'
>;

export type ColorCycleStampDitherSettings = {
  stampDitherEnabled: boolean;
  stampDitherPixelSize: number;
  stampDitherAlgorithm: StampDitherAlgorithm;
  stampDitherPatternStyle: PatternStyle;
  stampDitherPatternTileId: string | null;
  stampDitherPatternTileScale: number | null;
  stampDitherPatternTileInvert: boolean | null;
  stampDitherPatternTileThreshold: number | null;
  stampDitherPatternTileOffsetX: number | null;
  stampDitherPatternTileOffsetY: number | null;
  stampDitherBgFill: boolean;
  stampDitherPressureLinked: boolean;
};

export class ColorCycleStampDitherState {
  private enabled = false;
  private pixelSize = 1;
  private algorithm: StampDitherAlgorithm = 'sierra-lite';
  private patternStyle: PatternStyle = 'dots';
  private patternTileId: string | null = null;
  private patternTileScale: number | null = null;
  private patternTileInvert: boolean | null = null;
  private patternTileThreshold: number | null = null;
  private patternTileOffsetX: number | null = null;
  private patternTileOffsetY: number | null = null;
  private imageTileResolverKey: string | null = null;
  private imageTileResolver: ((x: number, y: number) => number | null) | undefined;
  private cacheVersion = 0;
  private readonly runtime = createStampDitherRuntime(this.cacheVersion);
  private bgFill = true;
  private pressureLinked = false;

  isEnabled(): boolean {
    return this.enabled;
  }

  getAlgorithm(): StampDitherAlgorithm {
    return this.algorithm;
  }

  getPatternStyle(): PatternStyle {
    return this.patternStyle;
  }

  getPixelSize(): number {
    return this.pixelSize;
  }

  keepsBackgroundFill(): boolean {
    return this.bgFill;
  }

  isPressureLinked(): boolean {
    return this.pressureLinked;
  }

  getRuntime(): ReturnType<typeof createStampDitherRuntime> {
    this.syncRuntimeVersion();
    return this.runtime;
  }

  clearRuntime(): void {
    this.cacheVersion += 1;
    clearStampDitherRuntime(this.runtime, this.cacheVersion);
  }

  syncRuntimeVersion(): void {
    syncStampDitherRuntimeVersion(this.runtime, this.cacheVersion);
  }

  setEnabled(enabled: boolean): boolean {
    this.enabled = !!enabled;
    if (this.enabled) {
      this.clearRuntime();
    }
    return this.enabled;
  }

  setAlgorithm(algorithm?: StampDitherAlgorithm): boolean {
    const next = algorithm || 'sierra-lite';
    if (next === this.algorithm) {
      return false;
    }
    this.algorithm = next;
    this.clearRuntime();
    return true;
  }

  setPatternStyle(style?: PatternStyle): boolean {
    const next = style || 'dots';
    if (next === this.patternStyle) {
      return false;
    }
    this.patternStyle = next;
    this.clearRuntime();
    return true;
  }

  setPatternTileSettings(settings: StampDitherTileSettingsPatch = {}): boolean {
    const nextTileId = settings.patternTileId ?? null;
    const nextScale = Number.isFinite(settings.patternTileScale)
      ? Math.max(1, Math.round(Number(settings.patternTileScale)))
      : null;
    const nextInvert = typeof settings.patternTileInvert === 'boolean'
      ? settings.patternTileInvert
      : null;
    const nextThreshold = Number.isFinite(settings.patternTileThreshold)
      ? Math.max(0, Math.min(1, Number(settings.patternTileThreshold)))
      : null;
    const nextOffsetX = Number.isFinite(settings.patternTileOffsetX)
      ? Math.round(Number(settings.patternTileOffsetX))
      : null;
    const nextOffsetY = Number.isFinite(settings.patternTileOffsetY)
      ? Math.round(Number(settings.patternTileOffsetY))
      : null;

    if (
      nextTileId === this.patternTileId &&
      nextScale === this.patternTileScale &&
      nextInvert === this.patternTileInvert &&
      nextThreshold === this.patternTileThreshold &&
      nextOffsetX === this.patternTileOffsetX &&
      nextOffsetY === this.patternTileOffsetY
    ) {
      return false;
    }

    this.patternTileId = nextTileId;
    this.patternTileScale = nextScale;
    this.patternTileInvert = nextInvert;
    this.patternTileThreshold = nextThreshold;
    this.patternTileOffsetX = nextOffsetX;
    this.patternTileOffsetY = nextOffsetY;
    this.clearRuntime();
    return true;
  }

  setPixelSize(size: number): boolean {
    const next = Math.max(1, Math.floor(size));
    if (next === this.pixelSize) {
      return false;
    }
    this.pixelSize = next;
    this.clearRuntime();
    return true;
  }

  setPressureLinked(enabled: boolean): void {
    this.pressureLinked = !!enabled;
  }

  setBgFill(enabled: boolean): void {
    this.bgFill = !!enabled;
  }

  setClears(enabled: boolean): void {
    this.bgFill = !enabled;
  }

  getSettings(): ColorCycleStampDitherSettings {
    return {
      stampDitherEnabled: this.enabled,
      stampDitherPixelSize: this.pixelSize,
      stampDitherAlgorithm: this.algorithm,
      stampDitherPatternStyle: this.patternStyle,
      stampDitherPatternTileId: this.patternTileId,
      stampDitherPatternTileScale: this.patternTileScale,
      stampDitherPatternTileInvert: this.patternTileInvert,
      stampDitherPatternTileThreshold: this.patternTileThreshold,
      stampDitherPatternTileOffsetX: this.patternTileOffsetX,
      stampDitherPatternTileOffsetY: this.patternTileOffsetY,
      stampDitherBgFill: this.bgFill,
      stampDitherPressureLinked: this.pressureLinked,
    };
  }

  createConfig(params: {
    patterns: CcCustomTilePattern[] | undefined;
    seed: number;
  }): StampDitherConfig {
    return {
      algorithm: this.algorithm,
      pixelSize: this.pixelSize,
      patternStyle: this.patternStyle,
      imageTileThresholdResolver: this.getImageTileThresholdResolver(params.patterns),
      bgFill: this.bgFill,
      pressureLinked: this.pressureLinked,
      seed: params.seed,
    };
  }

  getPatternTileSettings(): CcCustomTilePatternSettings {
    return {
      patternTileId: this.patternTileId,
      patternTileScale: this.patternTileScale,
      patternTileInvert: this.patternTileInvert,
      patternTileThreshold: this.patternTileThreshold,
      patternTileOffsetX: this.patternTileOffsetX,
      patternTileOffsetY: this.patternTileOffsetY,
    };
  }

  getImageTileThresholdResolver(
    patterns: CcCustomTilePattern[] | undefined,
  ): ((x: number, y: number) => number | null) | undefined {
    const settings = this.getPatternTileSettings();
    const tile = patterns?.find((pattern) => pattern.id === settings.patternTileId);
    const resolverKey = this.getImageTileResolverKey(tile, settings);
    if (resolverKey === this.imageTileResolverKey) {
      return this.imageTileResolver;
    }
    this.imageTileResolverKey = resolverKey;
    this.imageTileResolver = createCcCustomTileThresholdResolver(
      patterns,
      settings,
    ) ?? undefined;
    return this.imageTileResolver;
  }

  private getImageTileResolverKey(
    tile: CcCustomTilePattern | undefined,
    settings: CcCustomTilePatternSettings,
  ): string {
    if (!settings.patternTileId) {
      return 'none';
    }
    if (!tile) {
      const localPattern = localDitherPatternRegistry.resolve(settings.patternTileId);
      if (!localPattern) {
        return 'none';
      }
      return [
        'local',
        localPattern.definition.payloadHash,
        settings.patternTileScale ?? 'auto',
        settings.patternTileOffsetX ?? 'auto',
        settings.patternTileOffsetY ?? 'auto',
      ].join('|');
    }
    return [
      settings.patternTileId,
      tile.width,
      tile.height,
      tile.updatedAt,
      tile.rgbaBase64,
      settings.patternTileScale ?? 'auto',
      settings.patternTileInvert ?? 'auto',
      settings.patternTileThreshold ?? 'auto',
      settings.patternTileOffsetX ?? 'auto',
      settings.patternTileOffsetY ?? 'auto',
    ].join('|');
  }
}
