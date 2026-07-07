import type {
  ColorCycleBrushPersistenceAnimator,
  ColorCycleBrushPersistenceLayerMeta,
  ColorCycleBrushSerializeSettingsInput,
  ColorCycleLayerDocumentRead,
} from '@/lib/colorCycle/document';
import type { Layer } from '@/types';

import type {
  AnimatorIndexSnapshot,
  ColorCycleBrushCanvasSerialized,
  ColorCycleBrushCanvasState,
  ColorCycleRuntimeMutationReason,
  LayerStrokeState,
  StrokeDataSnapshot,
} from './colorCycleCanvas2DTypes';
import type { RestoreOpts } from './colorCycleCanvas2DUtils';
import type { CCBrushSettingsPatch } from './colorCycleBrushContracts';
import {
  readColorCycleSerializedStateRuntime,
  type ColorCycleSerializedStateReadContext,
} from './colorCycleSerializedStateReadRuntime';
import {
  restoreColorCycleSerializedStateRuntime,
  type ColorCycleSerializedStateRestoreContext,
} from './colorCycleSerializedStateRestoreRuntime';
import { ColorCycleRestoreSessionState } from './colorCycleRestoreSessionState';

export type ColorCycleSerializedStateApiRuntimeDeps = {
  getCurrentStrokeCounter(): number;
  hasCanonicalPaintPayload(layerId: string): boolean;
  applySettings(settings: CCBrushSettingsPatch): void;
  applyLegacyStampDitherClears(clears: boolean): void;
  getLayer(layerId: string): Layer | undefined;
  getStrokeState(layerId: string): LayerStrokeState | undefined;
  brushStateHasPaintPayload(layerId: string, brushState: unknown): boolean;
  hasStrokeState(layerId: string): boolean;
  clearStrokeStateForRestore(layerId: string): void;
  clearAnimator(layerId: string): void;
  clearComposite(): void;
  applyLayerSnapshot(
    layerId: string,
    snapshot: StrokeDataSnapshot,
    animatorIndex: AnimatorIndexSnapshot | undefined,
    reason: ColorCycleRuntimeMutationReason,
  ): void;
  setHighestStrokeCounter(strokeCounter: number): void;
  getAnimators(): Map<string, ColorCycleBrushPersistenceAnimator>;
  getDocumentRead(layerId: string): ColorCycleLayerDocumentRead | undefined;
  ensureStrokeSnapshot(strokeState: LayerStrokeState): void;
  hasPaintContent(paintBuffer: ArrayBuffer | undefined): boolean;
  hasStrokeContent(strokeState: LayerStrokeState): boolean;
  getLayerMeta(layerId: string): ColorCycleBrushPersistenceLayerMeta | null;
  getSerializeSettings(): ColorCycleBrushSerializeSettingsInput;
};

export class ColorCycleSerializedStateApiRuntime {
  private readonly restoreSessionState = new ColorCycleRestoreSessionState();

  constructor(
    private readonly deps: ColorCycleSerializedStateApiRuntimeDeps,
  ) {}

  readonly restoreSerializedState = (
    state: ColorCycleBrushCanvasState = {},
    opts: RestoreOpts = {},
  ): void => {
    restoreColorCycleSerializedStateRuntime(
      this.getRestoreContext(),
      state,
      opts,
    );
  };

  readonly readSerializedState = (): ColorCycleBrushCanvasSerialized => (
    readColorCycleSerializedStateRuntime(this.getReadContext())
  );

  readonly isHistoryRestore = (): boolean => (
    this.restoreSessionState.isHistoryRestore()
  );

  private getRestoreContext(): ColorCycleSerializedStateRestoreContext {
    return {
      getCurrentStrokeCounter: () => this.deps.getCurrentStrokeCounter(),
      hasCanonicalPaintPayload: (layerId) => this.deps.hasCanonicalPaintPayload(layerId),
      setHistoryRestore: (isHistoryRestore) => this.restoreSessionState.setHistoryRestore(isHistoryRestore),
      applySettings: (settings) => this.deps.applySettings(settings),
      applyLegacyStampDitherClears: (clears) => this.deps.applyLegacyStampDitherClears(clears),
      getLayer: (layerId) => this.deps.getLayer(layerId),
      getStrokeState: (layerId) => this.deps.getStrokeState(layerId),
      brushStateHasPaintPayload: (layerId, brushState) => this.deps.brushStateHasPaintPayload(layerId, brushState),
      hasStrokeState: (layerId) => this.deps.hasStrokeState(layerId),
      clearStrokeStateForRestore: (layerId) => this.deps.clearStrokeStateForRestore(layerId),
      clearAnimator: (layerId) => this.deps.clearAnimator(layerId),
      clearComposite: () => this.deps.clearComposite(),
      applyLayerSnapshot: (layerId, snapshot, animatorIndex, reason) => {
        this.deps.applyLayerSnapshot(layerId, snapshot, animatorIndex, reason);
      },
      setHighestStrokeCounter: (strokeCounter) => this.deps.setHighestStrokeCounter(strokeCounter),
    };
  }

  private getReadContext(): ColorCycleSerializedStateReadContext {
    return {
      getAnimators: () => this.deps.getAnimators(),
      getStrokeState: (layerId) => this.deps.getStrokeState(layerId),
      getDocumentRead: (layerId) => this.deps.getDocumentRead(layerId),
      ensureStrokeSnapshot: (strokeState) => this.deps.ensureStrokeSnapshot(strokeState),
      hasPaintContent: (paintBuffer) => this.deps.hasPaintContent(paintBuffer),
      hasStrokeContent: (strokeState) => this.deps.hasStrokeContent(strokeState),
      getLayerMeta: (layerId) => this.deps.getLayerMeta(layerId),
      getFallbackStrokeCounter: () => this.deps.getCurrentStrokeCounter(),
      getSerializeSettings: () => this.deps.getSerializeSettings(),
    };
  }
}
