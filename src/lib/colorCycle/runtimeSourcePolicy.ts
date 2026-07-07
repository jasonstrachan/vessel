import type { Layer } from '@/types';
import type { ColorCycleLayerDocument } from '@/lib/colorCycle/document';
import type { ColorCyclePersistenceDiagnostic } from '@/lib/colorCycle/persistence';

export type ColorCycleRuntimeSourcePolicy = {
  isColorCycleLayer: boolean;
  hasEditableSource: boolean;
  hasRecoverableRuntimeSource: boolean;
  hasRuntimeRestoreSource: boolean;
  hasPlaybackWarmupSource: boolean;
  isPreviewOnly: boolean;
  diagnostics: ColorCyclePersistenceDiagnostic[];
};

export type ResolveColorCycleRuntimeSourcePolicyOptions = {
  document?: Pick<ColorCycleLayerDocument, 'runtimePolicy'> | null;
};

const emptyPolicy = (): ColorCycleRuntimeSourcePolicy => ({
  isColorCycleLayer: false,
  hasEditableSource: false,
  hasRecoverableRuntimeSource: false,
  hasRuntimeRestoreSource: false,
  hasPlaybackWarmupSource: false,
  isPreviewOnly: false,
  diagnostics: [],
});

const policyFromDocument = (
  document: Pick<ColorCycleLayerDocument, 'runtimePolicy'>,
): ColorCycleRuntimeSourcePolicy => ({
  isColorCycleLayer: true,
  hasEditableSource: document.runtimePolicy.hasEditableSource,
  hasRecoverableRuntimeSource: document.runtimePolicy.hasRuntimeRestoreSource,
  hasRuntimeRestoreSource: document.runtimePolicy.hasRuntimeRestoreSource,
  hasPlaybackWarmupSource: document.runtimePolicy.hasPlaybackWarmupSource,
  isPreviewOnly: document.runtimePolicy.isPreviewOnly,
  diagnostics: [{
    source: 'document',
    kind: 'source-selected',
    message: 'Selected color-cycle document residency policy.',
  }],
});

const missingDocumentPolicy = (): ColorCycleRuntimeSourcePolicy => ({
  isColorCycleLayer: true,
  hasEditableSource: false,
  hasRecoverableRuntimeSource: false,
  hasRuntimeRestoreSource: false,
  hasPlaybackWarmupSource: false,
  isPreviewOnly: true,
  diagnostics: [{
    source: 'document',
    kind: 'source-rejected',
    message: 'No color-cycle document is available for runtime source policy.',
  }],
});

export const resolveColorCycleRuntimeSourcePolicy = (
  layer: Layer | null | undefined,
  options: ResolveColorCycleRuntimeSourcePolicyOptions = {},
): ColorCycleRuntimeSourcePolicy => {
  if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return emptyPolicy();
  }

  if (options.document) {
    return policyFromDocument(options.document);
  }

  return missingDocumentPolicy();
};

export const hasColorCycleEditableRuntimeSource = (
  layer: Layer | null | undefined,
  options: ResolveColorCycleRuntimeSourcePolicyOptions = {},
): boolean => resolveColorCycleRuntimeSourcePolicy(layer, options).hasEditableSource;

export const hasColorCycleWarmableRuntimeSource = (
  layer: Layer | null | undefined,
  options: ResolveColorCycleRuntimeSourcePolicyOptions = {},
): boolean => {
  return resolveColorCycleRuntimeSourcePolicy(layer, options).hasRuntimeRestoreSource;
};
