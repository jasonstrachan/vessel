import type { PersistedLayerType } from '@/utils/projectPersistence';

export type LegacyLayerType = 'normal' | 'color-cycle' | 'sequential' | 'unknown';

export interface LegacySerializedLayerLike {
  id: string;
  layerType?: PersistedLayerType;
  imageDataUrl?: unknown;
  colorCycleData?: unknown;
  sequentialData?: unknown;
  state?: unknown;
}

export interface LegacyLayerMigrationContext {
  projectWidth: number;
  projectHeight: number;
}

export interface ProjectRepairRecord {
  layerId?: string;
  layerType: LegacyLayerType;
  code: string;
  message: string;
  semantic: boolean;
}

export interface LayerMigrationResult<TLayer extends LegacySerializedLayerLike> {
  layer: TLayer;
  repairs: ProjectRepairRecord[];
}

export class LegacyMigrationError extends Error {
  readonly layerId?: string;
  readonly layerType: LegacyLayerType;
  readonly code: string;

  constructor(params: {
    message: string;
    code: string;
    layerId?: string;
    layerType: LegacyLayerType;
  }) {
    super(params.message);
    this.name = 'LegacyMigrationError';
    this.layerId = params.layerId;
    this.layerType = params.layerType;
    this.code = params.code;
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

export const cloneIfRecord = <T extends Record<string, unknown>>(value: T | unknown, fallback: T): T => (
  isRecord(value) ? { ...value } as T : { ...fallback }
);

export const valuesDiffer = (left: unknown, right: unknown): boolean => (
  JSON.stringify(left) !== JSON.stringify(right)
);
