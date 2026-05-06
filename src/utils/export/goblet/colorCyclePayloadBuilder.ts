import type { Layer, Project } from '@/types';
import type { ColorCycleSerializationResult } from '@/utils/export/goblet/gobletTypes';
import type { GobletColorCyclePayloadBuildSource } from '@/utils/export/goblet/colorCycleExportSourceResolver';
import { resolveGobletColorCycleExportSource } from '@/utils/export/goblet/colorCycleExportSourceResolver';
import {
  validateGobletColorCyclePayload,
  type GobletColorCyclePayloadDiagnostic,
  type GobletColorCyclePayloadStats,
} from '@/utils/export/goblet/colorCyclePayloadValidation';

// Boundary: orchestration only. This module resolves a CC source, asks the
// serializer to build a payload, then runs final payload validation.
export type { GobletColorCyclePayloadBuildSource };

export type GobletColorCyclePayloadResult =
  | {
      ok: true;
      layerId: string;
      source: GobletColorCyclePayloadBuildSource;
      layer: Layer;
      payload: ColorCycleSerializationResult;
      diagnostics: GobletColorCyclePayloadDiagnostic[];
      stats?: GobletColorCyclePayloadStats;
    }
  | {
      ok: false;
      layerId: string;
      reason: string;
      diagnostics: GobletColorCyclePayloadDiagnostic[];
    };

export type GobletColorCyclePayloadBuildOptions = {
  forceSpeedBuffer?: boolean;
  layerSpeedScale?: number;
  toolSpeed?: number | null;
  speedWarning?: { warned: boolean };
  serializeResolvedLayer: (
    layer: Layer,
    project: Project,
    speedWarning?: { warned: boolean },
    options?: {
      forceSpeedBuffer?: boolean;
      layerSpeedScale?: number;
      toolSpeed?: number | null;
      resolvedSource?: GobletColorCyclePayloadBuildSource;
    }
  ) => Promise<ColorCycleSerializationResult | undefined>;
};

export const buildGobletColorCyclePayload = async (
  layer: Layer,
  project: Project,
  options: GobletColorCyclePayloadBuildOptions,
): Promise<GobletColorCyclePayloadResult> => {
  const source = await resolveGobletColorCycleExportSource(layer, project);
  if (!source.ok) {
    return source;
  }

  const payload = await options.serializeResolvedLayer(
    source.layer,
    project,
    options.speedWarning,
    {
      forceSpeedBuffer: options.forceSpeedBuffer,
      layerSpeedScale: options.layerSpeedScale,
      toolSpeed: options.toolSpeed,
      resolvedSource: source.source,
    },
  );

  const validation = validateGobletColorCyclePayload(payload?.colorCycle, {
    layerId: layer.id,
    hasContent: layer.colorCycleData?.hasContent,
  });

  const diagnostics = [
    ...source.diagnostics,
    ...validation.diagnostics,
  ];

  if (!payload || !validation.ok) {
    return {
      ok: false,
      layerId: layer.id,
      reason: validation.reason ?? 'missing-color-cycle-payload',
      diagnostics,
    };
  }

  return {
    ok: true,
    layerId: layer.id,
    source: source.source,
    layer: source.layer,
    payload,
    diagnostics,
    stats: validation.stats,
  };
};
