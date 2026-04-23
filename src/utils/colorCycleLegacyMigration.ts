import type {
  LayerMigrationResult,
  LegacyLayerMigrationContext,
  LegacySerializedLayerLike,
  ProjectRepairRecord,
} from '@/utils/projectLegacyMigrationTypes';
import { LegacyMigrationError, isRecord, valuesDiffer } from '@/utils/projectLegacyMigrationTypes';

type BrushStateLayerSnapshot = {
  layerId?: unknown;
  strokeData?: Record<string, unknown>;
  gradientDefStore?: unknown;
  slotPalettes?: unknown;
  nextGradientDefId?: unknown;
  fgActiveSlot?: unknown;
  activeGradientId?: unknown;
};

const getMatchingBrushSnapshot = (
  colorCycleData: Record<string, unknown>,
  layerId: string,
): BrushStateLayerSnapshot | null => {
  const brushState = isRecord(colorCycleData.brushState) ? colorCycleData.brushState : null;
  const layers = Array.isArray(brushState?.layers) ? brushState.layers : [];
  const match = layers.find((entry) => isRecord(entry) && entry.layerId === layerId);
  return isRecord(match) ? match as BrushStateLayerSnapshot : null;
};

const pushRepair = (repairs: ProjectRepairRecord[], repair: ProjectRepairRecord): void => {
  repairs.push(repair);
};

const dedupePromotedField = (
  params: {
    colorCycleData: Record<string, unknown>;
    snapshot: BrushStateLayerSnapshot | null;
    field: 'gradientDefStore' | 'slotPalettes' | 'nextGradientDefId' | 'fgActiveSlot' | 'activeGradientId';
    layerId: string;
    repairs: ProjectRepairRecord[];
  },
): void => {
  const { colorCycleData, snapshot, field, layerId, repairs } = params;
  if (!snapshot || snapshot[field] === undefined) {
    return;
  }

  if (colorCycleData[field] === undefined) {
    colorCycleData[field] = snapshot[field];
    delete snapshot[field];
    pushRepair(repairs, {
      layerId,
      layerType: 'color-cycle',
      code: `legacy-cc-promoted-${field}`,
      message: `Legacy color-cycle ${field} was promoted from brush snapshot metadata.`,
      semantic: true,
    });
    return;
  }

  if (valuesDiffer(colorCycleData[field], snapshot[field])) {
    throw new LegacyMigrationError({
      layerId,
      layerType: 'color-cycle',
      code: `legacy-cc-ambiguous-${field}`,
      message: `Color-cycle layer ${layerId} has ambiguous legacy ${field} sources.`,
    });
  }

  delete snapshot[field];
  pushRepair(repairs, {
    layerId,
    layerType: 'color-cycle',
    code: `legacy-cc-deduped-${field}`,
    message: `Duplicate legacy color-cycle ${field} metadata was deduplicated during load.`,
    semantic: false,
  });
};

const dedupeStrokeBufferField = (
  params: {
    colorCycleData: Record<string, unknown>;
    snapshot: BrushStateLayerSnapshot | null;
    topLevelField: 'gradientIdBuffer' | 'gradientDefIdBuffer';
    strokeField: 'gradientIdBuffer' | 'gradientDefIdBuffer';
    layerId: string;
    repairs: ProjectRepairRecord[];
  },
): void => {
  const { colorCycleData, snapshot, topLevelField, strokeField, layerId, repairs } = params;
  const strokeData = snapshot && isRecord(snapshot.strokeData) ? snapshot.strokeData : null;
  if (!strokeData || strokeData[strokeField] === undefined) {
    return;
  }

  if (colorCycleData[topLevelField] === undefined) {
    colorCycleData[topLevelField] = strokeData[strokeField];
    delete strokeData[strokeField];
    pushRepair(repairs, {
      layerId,
      layerType: 'color-cycle',
      code: `legacy-cc-promoted-${topLevelField}`,
      message: `Legacy color-cycle ${topLevelField} was promoted from brush snapshot stroke data.`,
      semantic: true,
    });
    return;
  }

  if (valuesDiffer(colorCycleData[topLevelField], strokeData[strokeField])) {
    return;
  }

  delete strokeData[strokeField];
  pushRepair(repairs, {
    layerId,
    layerType: 'color-cycle',
    code: `legacy-cc-deduped-${topLevelField}`,
    message: `Duplicate legacy color-cycle ${topLevelField} payloads were deduplicated during load.`,
    semantic: false,
  });
};

export function migrateColorCycleLegacyLayer<TLayer extends LegacySerializedLayerLike>(
  layer: TLayer,
  context: LegacyLayerMigrationContext,
): LayerMigrationResult<TLayer> {
  const repairs: ProjectRepairRecord[] = [];
  const nextLayer = { ...layer };

  if (nextLayer.layerType === undefined) {
    nextLayer.layerType = 'color-cycle';
    pushRepair(repairs, {
      layerId: nextLayer.id,
      layerType: 'color-cycle',
      code: 'legacy-cc-missing-layer-type',
      message: 'Missing color-cycle layer type was canonicalized during load.',
      semantic: false,
    });
  }

  if (nextLayer.colorCycleData !== undefined && !isRecord(nextLayer.colorCycleData)) {
    throw new LegacyMigrationError({
      layerId: nextLayer.id,
      layerType: 'color-cycle',
      code: 'legacy-cc-invalid-payload',
      message: `Color-cycle layer ${nextLayer.id} has an invalid payload.`,
    });
  }

  const colorCycleData: Record<string, unknown> = isRecord(nextLayer.colorCycleData)
    ? { ...nextLayer.colorCycleData }
    : {};
  nextLayer.colorCycleData = colorCycleData;

  if (typeof colorCycleData.canvasWidth !== 'number' || !Number.isFinite(colorCycleData.canvasWidth)) {
    colorCycleData.canvasWidth = context.projectWidth;
    pushRepair(repairs, {
      layerId: nextLayer.id,
      layerType: 'color-cycle',
      code: 'legacy-cc-defaulted-canvas-width',
      message: 'Legacy color-cycle canvas width was missing and defaulted to the project width.',
      semantic: true,
    });
  }
  if (typeof colorCycleData.canvasHeight !== 'number' || !Number.isFinite(colorCycleData.canvasHeight)) {
    colorCycleData.canvasHeight = context.projectHeight;
    pushRepair(repairs, {
      layerId: nextLayer.id,
      layerType: 'color-cycle',
      code: 'legacy-cc-defaulted-canvas-height',
      message: 'Legacy color-cycle canvas height was missing and defaulted to the project height.',
      semantic: true,
    });
  }

  const snapshot = getMatchingBrushSnapshot(colorCycleData, nextLayer.id);
  dedupePromotedField({ colorCycleData, snapshot, field: 'gradientDefStore', layerId: nextLayer.id, repairs });
  dedupePromotedField({ colorCycleData, snapshot, field: 'slotPalettes', layerId: nextLayer.id, repairs });
  dedupePromotedField({ colorCycleData, snapshot, field: 'nextGradientDefId', layerId: nextLayer.id, repairs });
  dedupePromotedField({ colorCycleData, snapshot, field: 'fgActiveSlot', layerId: nextLayer.id, repairs });
  dedupePromotedField({ colorCycleData, snapshot, field: 'activeGradientId', layerId: nextLayer.id, repairs });
  dedupeStrokeBufferField({
    colorCycleData,
    snapshot,
    topLevelField: 'gradientIdBuffer',
    strokeField: 'gradientIdBuffer',
    layerId: nextLayer.id,
    repairs,
  });
  dedupeStrokeBufferField({
    colorCycleData,
    snapshot,
    topLevelField: 'gradientDefIdBuffer',
    strokeField: 'gradientDefIdBuffer',
    layerId: nextLayer.id,
    repairs,
  });

  return {
    layer: nextLayer,
    repairs,
  };
}
