import type {
  LayerMigrationResult,
  LegacyLayerMigrationContext,
  LegacySerializedLayerLike,
  ProjectRepairRecord,
} from '@/utils/projectLegacyMigrationTypes';
import { LegacyMigrationError, isRecord } from '@/utils/projectLegacyMigrationTypes';

const normalizePositiveInteger = (value: unknown, fallback: number): number => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(1, numeric);
};

export function migrateSequentialLegacyLayer<TLayer extends LegacySerializedLayerLike>(
  layer: TLayer,
  context: LegacyLayerMigrationContext,
): LayerMigrationResult<TLayer> {
  void context;
  const repairs: ProjectRepairRecord[] = [];
  const nextLayer = { ...layer };

  if (nextLayer.layerType === undefined) {
    nextLayer.layerType = 'sequential';
    repairs.push({
      layerId: nextLayer.id,
      layerType: 'sequential',
      code: 'legacy-sequential-missing-layer-type',
      message: 'Missing sequential layer type was canonicalized during load.',
      semantic: false,
    });
  }

  if (isRecord(nextLayer.state) && typeof nextLayer.state.chunksRef === 'string') {
    return {
      layer: nextLayer,
      repairs,
    };
  }

  if (nextLayer.sequentialData === undefined) {
    nextLayer.sequentialData = {
      frameCount: 1,
      fps: 1,
      durationMs: 1,
      events: [],
    };
    repairs.push({
      layerId: nextLayer.id,
      layerType: 'sequential',
      code: 'legacy-sequential-missing-state-defaulted',
      message: 'Missing sequential payload was defaulted to an empty event stream during load.',
      semantic: true,
    });
    return {
      layer: nextLayer,
      repairs,
    };
  }

  if (!isRecord(nextLayer.sequentialData)) {
    throw new LegacyMigrationError({
      layerId: nextLayer.id,
      layerType: 'sequential',
      code: 'legacy-sequential-invalid-payload',
      message: `Sequential layer ${nextLayer.id} has an invalid payload.`,
    });
  }

  const frameCount = normalizePositiveInteger(nextLayer.sequentialData.frameCount, 1);
  const fps = normalizePositiveInteger(nextLayer.sequentialData.fps, 1);
  const durationMs = normalizePositiveInteger(nextLayer.sequentialData.durationMs, 1);
  const events = Array.isArray(nextLayer.sequentialData.events) ? nextLayer.sequentialData.events : [];

  if (
    frameCount !== nextLayer.sequentialData.frameCount
    || fps !== nextLayer.sequentialData.fps
    || durationMs !== nextLayer.sequentialData.durationMs
    || events !== nextLayer.sequentialData.events
  ) {
    repairs.push({
      layerId: nextLayer.id,
      layerType: 'sequential',
      code: 'legacy-sequential-sanitized',
      message: 'Sequential timing or events were sanitized into the canonical load shape.',
      semantic: true,
    });
  }

  nextLayer.sequentialData = {
    ...nextLayer.sequentialData,
    frameCount,
    fps,
    durationMs,
    events,
  };

  return {
    layer: nextLayer,
    repairs,
  };
}
