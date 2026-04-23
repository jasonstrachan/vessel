import { migrateColorCycleLegacyLayer } from '@/utils/colorCycleLegacyMigration';
import { normalizePersistedLayerType } from '@/utils/projectPersistence';
import {
  type LayerMigrationResult,
  type LegacyLayerMigrationContext,
  type LegacyLayerType,
  type LegacySerializedLayerLike,
  type ProjectRepairRecord,
} from '@/utils/projectLegacyMigrationTypes';
import { migrateRasterLegacyLayer } from '@/utils/rasterLegacyMigration';
import { migrateSequentialLegacyLayer } from '@/utils/sequentialLegacyMigration';

export interface ProjectLegacyMigrationSummary {
  repairs: ProjectRepairRecord[];
  hasSemanticRepairs: boolean;
  shouldMarkDirty: boolean;
}

export interface ProjectLegacyMigrationResult<TLayer extends LegacySerializedLayerLike> {
  layers: TLayer[];
  summary: ProjectLegacyMigrationSummary;
}

const inferLegacyLayerType = (layer: LegacySerializedLayerLike): LegacyLayerType => {
  if (layer.layerType) {
    return normalizePersistedLayerType(layer.layerType);
  }
  if (layer.colorCycleData) {
    return 'color-cycle';
  }
  if (layer.sequentialData) {
    return 'sequential';
  }
  return 'normal';
};

export function migrateLegacyProjectLayers<TLayer extends LegacySerializedLayerLike>(
  layers: TLayer[],
  context: LegacyLayerMigrationContext,
): ProjectLegacyMigrationResult<TLayer> {
  const repairs: ProjectRepairRecord[] = [];

  const migratedLayers = layers.map((layer) => {
    const inferredType = inferLegacyLayerType(layer);
    let result: LayerMigrationResult<TLayer>;

    if (inferredType === 'color-cycle') {
      result = migrateColorCycleLegacyLayer(layer, context);
    } else if (inferredType === 'sequential') {
      result = migrateSequentialLegacyLayer(layer, context);
    } else {
      result = migrateRasterLegacyLayer(layer);
    }

    repairs.push(...result.repairs);
    return result.layer;
  });

  return {
    layers: migratedLayers,
    summary: {
      repairs,
      hasSemanticRepairs: repairs.some((repair) => repair.semantic),
      shouldMarkDirty: repairs.some((repair) => repair.semantic),
    },
  };
}
