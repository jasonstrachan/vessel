import type {
  LayerMigrationResult,
  LegacySerializedLayerLike,
  ProjectRepairRecord,
} from '@/utils/projectLegacyMigrationTypes';
import { LegacyMigrationError } from '@/utils/projectLegacyMigrationTypes';

export function migrateRasterLegacyLayer<TLayer extends LegacySerializedLayerLike>(
  layer: TLayer,
): LayerMigrationResult<TLayer> {
  const repairs: ProjectRepairRecord[] = [];
  const nextLayer = { ...layer };

  if (nextLayer.imageDataUrl === undefined || nextLayer.imageDataUrl === null) {
    nextLayer.imageDataUrl = '';
    repairs.push({
      layerId: nextLayer.id,
      layerType: 'normal' as const,
      code: 'legacy-raster-missing-image-defaulted',
      message: 'Missing raster image payload was defaulted to an empty layer during load.',
      semantic: true,
    });
  } else if (typeof nextLayer.imageDataUrl !== 'string') {
    throw new LegacyMigrationError({
      layerId: nextLayer.id,
      layerType: 'normal',
      code: 'legacy-raster-invalid-image-payload',
      message: `Raster layer ${nextLayer.id} has an invalid image payload.`,
    });
  }

  if (nextLayer.layerType === undefined) {
    nextLayer.layerType = 'normal';
    repairs.push({
      layerId: nextLayer.id,
      layerType: 'normal',
      code: 'legacy-raster-missing-layer-type',
      message: 'Missing raster layer type was canonicalized to normal during load.',
      semantic: false,
    });
  }

  return {
    layer: nextLayer,
    repairs,
  };
}
