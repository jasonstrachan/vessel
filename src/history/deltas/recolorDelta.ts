import type { HistoryDelta, HistoryDirection, HistoryRehydrationTargets, PreparedHistoryDelta } from '@/history/actionTypes';
import { prepareAppStoreHistoryDelta } from '@/history/storeStateCompensation';
import { useAppStore } from '@/stores/useAppStore';
import type { ColorCycleRecolorSettings } from '@/types';

export const cloneRecolorSettings = (
  settings: ColorCycleRecolorSettings | undefined,
): ColorCycleRecolorSettings | undefined => settings ? {
  ...settings,
  animation: { ...settings.animation },
  gradient: settings.gradient.map((stop) => ({ ...stop })),
  indexBuffer: settings.indexBuffer?.slice(),
  palette: settings.palette?.slice(),
  colorMap: settings.colorMap ? new Map(settings.colorMap) : undefined,
  phaseMap: settings.phaseMap?.slice(),
  indexPhaseMap: settings.indexPhaseMap?.slice(),
  originalImageData: settings.originalImageData ? new ImageData(
    new Uint8ClampedArray(settings.originalImageData.data),
    settings.originalImageData.width,
    settings.originalImageData.height,
  ) : undefined,
} : undefined;

const settingsBytes = (settings: ColorCycleRecolorSettings | undefined): number => (
  (settings?.originalImageData?.data.byteLength ?? 0)
  + (settings?.indexBuffer?.byteLength ?? 0)
  + (settings?.palette?.byteLength ?? 0)
  + (settings?.phaseMap?.byteLength ?? 0)
  + (settings?.indexPhaseMap?.byteLength ?? 0)
  + (settings?.colorMap?.size ?? 0) * 16
  + (settings?.gradient.length ?? 0) * 64
);

class RecolorDelta implements HistoryDelta {
  readonly _tag = 'recolor';
  readonly approxBytes: number;
  private readonly before: ColorCycleRecolorSettings | undefined;
  private readonly after: ColorCycleRecolorSettings | undefined;

  constructor(
    private readonly layerId: string,
    before: ColorCycleRecolorSettings | undefined,
    after: ColorCycleRecolorSettings | undefined,
  ) {
    this.before = cloneRecolorSettings(before);
    this.after = cloneRecolorSettings(after);
    this.approxBytes = settingsBytes(before) + settingsBytes(after);
  }

  prepare(direction: HistoryDirection): PreparedHistoryDelta {
    return prepareAppStoreHistoryDelta(
      this._tag,
      direction,
      (nextDirection) => this.applyReplay(nextDirection),
      ['layers', 'layersNeedRecomposition'],
      (targets) => this.collectRehydrationTargets(targets),
    );
  }

  applyReplay(direction: HistoryDirection): void {
    const settings = direction === 'forward' ? this.after : this.before;
    useAppStore.setState((state) => ({
      layers: state.layers.map((layer) => layer.id === this.layerId ? {
        ...layer,
        colorCycleData: {
          ...layer.colorCycleData,
          recolorSettings: cloneRecolorSettings(settings),
        },
      } : layer),
      layersNeedRecomposition: true,
    }));
  }

  collectRehydrationTargets(targets: HistoryRehydrationTargets): void {
    targets.layerIds.add(this.layerId);
    targets.colorCycleLayerIds.add(this.layerId);
  }
}

export const createRecolorDelta = ({ layerId, before, after }: {
  layerId: string;
  before: ColorCycleRecolorSettings | undefined;
  after: ColorCycleRecolorSettings | undefined;
}): HistoryDelta | null => before || after ? new RecolorDelta(layerId, before, after) : null;
