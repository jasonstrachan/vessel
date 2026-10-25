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


type RecolorGradient = ColorCycleRecolorSettings['gradient'];

class RecolorGradientDelta implements HistoryDelta {
  readonly _tag = 'recolor-gradient';
  readonly approxBytes: number;
  private readonly before: RecolorGradient;
  private readonly after: RecolorGradient;

  constructor(private readonly layerId: string, before: RecolorGradient, after: RecolorGradient) {
    this.before = before.map((stop) => ({ ...stop }));
    this.after = after.map((stop) => ({ ...stop }));
    this.approxBytes = (before.length + after.length) * 64;
  }

  prepare(direction: HistoryDirection): PreparedHistoryDelta {
    return prepareAppStoreHistoryDelta(
      this._tag,
      direction,
      (nextDirection) => {
        const layer = useAppStore.getState().layers.find((entry) => entry.id === this.layerId);
        if (layer?.layerType !== 'color-cycle' || layer.colorCycleData?.mode !== 'recolor' || !layer.colorCycleData.recolorSettings) {
          throw new Error('Recolor gradient history target is unavailable.');
        }
        const stops = nextDirection === 'forward' ? this.after : this.before;
        useAppStore.setState((state) => ({
          layers: state.layers.map((entry) => entry.id === this.layerId ? {
            ...entry,
            colorCycleData: {
              ...entry.colorCycleData,
              recolorSettings: {
                ...entry.colorCycleData!.recolorSettings!,
                gradient: stops.map((stop) => ({ ...stop })),
              },
            },
          } : entry),
          layersNeedRecomposition: true,
        }));
      },
      ['layers', 'layersNeedRecomposition'],
      (targets) => this.collectRehydrationTargets(targets),
    );
  }

  collectRehydrationTargets(targets: HistoryRehydrationTargets): void {
    targets.layerIds.add(this.layerId);
    targets.colorCycleLayerIds.add(this.layerId);
  }
}

export const createRecolorGradientDelta = ({ layerId, before, after }: {
  layerId: string;
  before: RecolorGradient;
  after: RecolorGradient;
}): HistoryDelta | null => JSON.stringify(before) === JSON.stringify(after)
  ? null
  : new RecolorGradientDelta(layerId, before, after);

export interface RecolorControlValues {
  speed: number;
  cycleColors: number;
  flowDirection: ColorCycleRecolorSettings['animation']['flowDirection'];
  mappingMode: ColorCycleRecolorSettings['mappingMode'];
  flowMapping: ColorCycleRecolorSettings['flowMapping'];
  fps: number;
  ticksPerFrame: number;
}

export const readRecolorControls = (settings: ColorCycleRecolorSettings): RecolorControlValues => ({
  speed: settings.animation.speed,
  cycleColors: settings.cycleColors,
  flowDirection: settings.animation.flowDirection,
  mappingMode: settings.mappingMode,
  flowMapping: settings.flowMapping,
  fps: settings.animation.fps,
  ticksPerFrame: settings.animation.ticksPerFrame,
});

export const mergeRecolorControls = (
  settings: ColorCycleRecolorSettings,
  values: Partial<RecolorControlValues>,
): ColorCycleRecolorSettings => ({
  ...settings,
  ...('cycleColors' in values ? { cycleColors: values.cycleColors! } : {}),
  ...('mappingMode' in values ? { mappingMode: values.mappingMode } : {}),
  ...('flowMapping' in values ? { flowMapping: values.flowMapping, phaseMap: undefined } : {}),
  animation: {
    ...settings.animation,
    ...('speed' in values ? { speed: values.speed! } : {}),
    ...('flowDirection' in values ? { flowDirection: values.flowDirection! } : {}),
    ...('fps' in values ? { fps: values.fps! } : {}),
    ...('ticksPerFrame' in values ? { ticksPerFrame: values.ticksPerFrame! } : {}),
  },
});

class RecolorControlDelta implements HistoryDelta {
  readonly _tag = 'recolor-control';
  readonly approxBytes = 128;
  private readonly before: Partial<RecolorControlValues>;
  private readonly after: Partial<RecolorControlValues>;

  constructor(private readonly layerId: string, before: Partial<RecolorControlValues>, after: Partial<RecolorControlValues>) {
    this.before = { ...before };
    this.after = { ...after };
  }

  prepare(direction: HistoryDirection): PreparedHistoryDelta {
    return prepareAppStoreHistoryDelta(this._tag, direction, (nextDirection) => {
      const values = nextDirection === 'forward' ? this.after : this.before;
      const state = useAppStore.getState();
      const target = state.layers.find((layer) => layer.id === this.layerId);
      if (target?.colorCycleData?.mode !== 'recolor' || !target.colorCycleData.recolorSettings) {
        throw new Error('Recolor control history target is unavailable.');
      }
      useAppStore.setState({ layers: state.layers.map((layer) => layer === target ? {
        ...layer,
        colorCycleData: { ...layer.colorCycleData!, recolorSettings: mergeRecolorControls(layer.colorCycleData!.recolorSettings!, values) },
      } : layer), layersNeedRecomposition: true });
    }, ['layers', 'layersNeedRecomposition'], (targets) => this.collectRehydrationTargets(targets));
  }

  collectRehydrationTargets(targets: HistoryRehydrationTargets): void {
    targets.layerIds.add(this.layerId);
    targets.colorCycleLayerIds.add(this.layerId);
  }
}

export const createRecolorControlDelta = ({ layerId, before, after }: {
  layerId: string;
  before: Partial<RecolorControlValues>;
  after: Partial<RecolorControlValues>;
}): HistoryDelta | null => JSON.stringify(before) === JSON.stringify(after) ? null : new RecolorControlDelta(layerId, before, after);

export interface RecolorFPSState {
  fps: number;
  layers: Array<{ id: string; fps: number; ticksPerFrame: number }>;
}

export const readRecolorFPSState = (fps: number): RecolorFPSState => ({
  fps,
  layers: useAppStore.getState().layers.flatMap((layer) => {
    const settings = layer.colorCycleData?.mode === 'recolor' ? layer.colorCycleData.recolorSettings : undefined;
    return settings ? [{ id: layer.id, fps: settings.animation.fps, ticksPerFrame: settings.animation.ticksPerFrame }] : [];
  }),
});

class RecolorFPSDelta implements HistoryDelta {
  readonly _tag = 'recolor-fps';
  readonly approxBytes: number;
  private readonly before: RecolorFPSState;
  private readonly after: RecolorFPSState;

  constructor(before: RecolorFPSState, after: RecolorFPSState) {
    this.before = { fps: before.fps, layers: before.layers.map((layer) => ({ ...layer })) };
    this.after = { fps: after.fps, layers: after.layers.map((layer) => ({ ...layer })) };
    this.approxBytes = 32 + (before.layers.length + after.layers.length) * 48;
  }

  async prepare(direction: HistoryDirection): Promise<PreparedHistoryDelta> {
    const { RecolorManager } = await import('@/lib/colorCycle/RecolorManager');
    const manager = RecolorManager.getInstance();
    const state = useAppStore.getState(), runtimeFPS = manager.getConfiguredFPS();
    const desired = direction === 'forward' ? this.after : this.before;
    let mutated = false;
    const currentProject = () => useAppStore.getState().project?.id === state.project?.id;
    const publish = () => {
      const current = useAppStore.getState();
      useAppStore.setState({ layers: current.layers.map((layer) => {
        const settings = layer.colorCycleData?.mode === 'recolor' ? layer.colorCycleData.recolorSettings : undefined;
        if (!settings) return layer;
        const values = desired.layers.find((entry) => entry.id === layer.id);
        return { ...layer, colorCycleData: { ...layer.colorCycleData!, recolorSettings: mergeRecolorControls(settings, values ? { fps: values.fps, ticksPerFrame: values.ticksPerFrame } : {}) } };
      }), layersNeedRecomposition: true });
    };
    return {
      deltaTag: this._tag,
      apply: () => { if (!currentProject()) throw new Error('Recolor FPS history project changed.'); mutated = true; publish(); },
      requiresCompensation: () => mutated && currentProject(),
      collectRehydrationTargets: (targets) => {
        this.collectRehydrationTargets(targets);
        for (const layer of state.layers) if (layer.colorCycleData?.mode === 'recolor') { targets.layerIds.add(layer.id); targets.colorCycleLayerIds.add(layer.id); }
      },
      finalize: async () => {
        if (!currentProject()) return;
        manager.setFPS(desired.fps);
        // setFPS also rewrites layer timing; restore the exact command-owned metadata.
        publish();
        for (const layer of useAppStore.getState().layers) {
          if (layer.colorCycleData?.mode === 'recolor' && !await manager.restoreLayer(layer)) {
            throw new Error('Recolor FPS runtime rejected restored timing.');
          }
        }
      },
      compensate: () => {
        if (!currentProject()) return;
        // Registered layers now refer to replay copies; preserve pre-replay store objects.
        if (manager.getConfiguredFPS() !== runtimeFPS) manager.setFPS(runtimeFPS);
        useAppStore.setState({ layers: state.layers, layersNeedRecomposition: state.layersNeedRecomposition });
      },
    };
  }

  collectRehydrationTargets(targets: HistoryRehydrationTargets): void {
    for (const { id } of [...this.before.layers, ...this.after.layers]) {
      targets.layerIds.add(id);
      targets.colorCycleLayerIds.add(id);
    }
  }
}

export const createRecolorFPSDelta = ({ before, after }: { before: RecolorFPSState; after: RecolorFPSState }): HistoryDelta | null =>
  JSON.stringify(before) === JSON.stringify(after) ? null : new RecolorFPSDelta(before, after);
