import type {
  AnimatorIndexSnapshot,
  ColorCycleBrushCanvasSerialized,
  ColorCycleBrushCanvasState,
  ColorCycleRuntimeMutationReason,
  StrokeDataSnapshot,
} from './colorCycleCanvas2DTypes';
import type { RestoreOpts } from './colorCycleCanvas2DUtils';

type LayerSnapshotOptions = { suppressClearAudit?: boolean };

export type ColorCycleSerializedStateRegistrationContext = {
  readSerializedState(): ColorCycleBrushCanvasSerialized;
  restoreSerializedState(state?: ColorCycleBrushCanvasState, options?: RestoreOpts): void;
};

export type ColorCycleLayerSnapshotRegistrationContext = {
  applyLayerSnapshot(
    layerId: string,
    snapshot: StrokeDataSnapshot,
    animatorIndex?: AnimatorIndexSnapshot,
    reason?: ColorCycleRuntimeMutationReason,
    options?: LayerSnapshotOptions,
  ): void;
};

export type ColorCycleSerializedStateRegistrationRuntime = {
  read(): ColorCycleBrushCanvasSerialized;
  restore(state?: unknown, options?: unknown): void;
};

export type ColorCycleLayerSnapshotRegistrationRuntime = {
  apply(
    layerId: string,
    snapshot: unknown,
    animatorIndex?: unknown,
    reason?: string,
    options?: LayerSnapshotOptions,
  ): void;
};

export function createColorCycleSerializedStateRegistrationRuntime(
  context: ColorCycleSerializedStateRegistrationContext,
): ColorCycleSerializedStateRegistrationRuntime {
  return {
    read: () => context.readSerializedState(),
    restore: (state, options) => {
      context.restoreSerializedState(
        state as ColorCycleBrushCanvasState | undefined,
        options as RestoreOpts | undefined,
      );
    },
  };
}

export function createColorCycleLayerSnapshotRegistrationRuntime(
  context: ColorCycleLayerSnapshotRegistrationContext,
): ColorCycleLayerSnapshotRegistrationRuntime {
  return {
    apply: (layerId, snapshot, animatorIndex, reason, options) => {
      context.applyLayerSnapshot(
        layerId,
        snapshot as StrokeDataSnapshot,
        animatorIndex as AnimatorIndexSnapshot | undefined,
        reason as ColorCycleRuntimeMutationReason | undefined,
        options,
      );
    },
  };
}
