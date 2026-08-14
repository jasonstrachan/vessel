import type { StateCreator } from 'zustand';

import {
  normalizeReferenceAsset,
  normalizeReferenceAssets,
  normalizeReferenceSamplingSource,
} from '@/referenceStudio/referenceAssets';
import type { ReferenceAsset, ReferenceSamplingSource } from '@/types';

type AppState = import('../useAppStore').AppState;

export interface ReferenceStudioSlice {
  addReferenceAsset: (asset: ReferenceAsset) => void;
  updateReferenceAsset: (id: string, updates: Partial<ReferenceAsset>) => void;
  removeReferenceAsset: (id: string) => void;
  reorderReferenceAssets: (orderedIds: string[]) => void;
  setReferenceSamplingSource: (source: ReferenceSamplingSource) => void;
}

export const createReferenceStudioSlice: StateCreator<
  AppState,
  [],
  [],
  ReferenceStudioSlice
> = (set, get) => {
  const markProjectDirty = (): void => {
    get().markAutosaveDirty('project-change');
  };

  return {
    addReferenceAsset: (asset) => {
      let didChange = false;
      set((state) => {
        if (!state.project) return state;
        const normalized = normalizeReferenceAsset(asset);
        if (!normalized) return state;
        const current = normalizeReferenceAssets(state.project.referenceAssets);
        if (current.some((entry) => entry.id === normalized.id)) return state;
        didChange = true;
        return {
          project: {
            ...state.project,
            referenceAssets: [...current, normalized],
            updatedAt: new Date(),
          },
        };
      });
      if (didChange) markProjectDirty();
    },

    updateReferenceAsset: (id, updates) => {
      let didChange = false;
      set((state) => {
        if (!state.project) return state;
        const current = normalizeReferenceAssets(state.project.referenceAssets);
        const index = current.findIndex((asset) => asset.id === id);
        if (index < 0) return state;
        const next = normalizeReferenceAsset({
          ...current[index],
          ...updates,
          id,
          updatedAt: Date.now(),
        }, index);
        if (!next) return state;
        const referenceAssets = current.map((asset, assetIndex) => (
          assetIndex === index ? next : asset
        ));
        didChange = true;
        return {
          project: {
            ...state.project,
            referenceAssets,
            updatedAt: new Date(),
          },
        };
      });
      if (didChange) markProjectDirty();
    },

    removeReferenceAsset: (id) => {
      let didChange = false;
      set((state) => {
        if (!state.project) return state;
        const current = normalizeReferenceAssets(state.project.referenceAssets);
        const referenceAssets = current.filter((asset) => asset.id !== id);
        if (referenceAssets.length === current.length) return state;
        const currentSource = state.project.referenceSamplingSource ?? { kind: 'canvas' as const };
        const referenceSamplingSource =
          currentSource.kind === 'asset' && currentSource.assetId === id
            ? { kind: 'canvas' as const }
            : currentSource;
        didChange = true;
        return {
          project: {
            ...state.project,
            referenceAssets,
            referenceSamplingSource,
            updatedAt: new Date(),
          },
          colorPickerPreferReferenceLayer: referenceSamplingSource.kind !== 'canvas',
        };
      });
      if (didChange) markProjectDirty();
    },

    reorderReferenceAssets: (orderedIds) => {
      let didChange = false;
      set((state) => {
        if (!state.project) return state;
        const current = normalizeReferenceAssets(state.project.referenceAssets);
        if (current.length < 2) return state;
        const order = new Map(orderedIds.map((id, index) => [id, index]));
        const referenceAssets = [...current].sort((left, right) => (
          (order.get(left.id) ?? Number.MAX_SAFE_INTEGER)
          - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER)
        ));
        if (referenceAssets.every((asset, index) => asset.id === current[index]?.id)) return state;
        didChange = true;
        return {
          project: {
            ...state.project,
            referenceAssets,
            updatedAt: new Date(),
          },
        };
      });
      if (didChange) markProjectDirty();
    },

    setReferenceSamplingSource: (source) => {
      let didChange = false;
      set((state) => {
        if (!state.project) return state;
        const referenceAssets = normalizeReferenceAssets(state.project.referenceAssets);
        const referenceSamplingSource = normalizeReferenceSamplingSource({
          source,
          assets: referenceAssets,
          layers: state.layers,
        });
        const nextReferenceLayerId = referenceSamplingSource.kind === 'layer'
          ? referenceSamplingSource.layerId
          : state.referenceLayerId;
        const currentSource = state.project.referenceSamplingSource;
        if (
          currentSource !== undefined
          && JSON.stringify(currentSource) === JSON.stringify(referenceSamplingSource)
          && state.referenceLayerId === nextReferenceLayerId
        ) {
          return state;
        }
        didChange = true;
        return {
          referenceLayerId: nextReferenceLayerId,
          colorPickerPreferReferenceLayer: referenceSamplingSource.kind !== 'canvas',
          project: {
            ...state.project,
            referenceAssets,
            referenceLayerId: nextReferenceLayerId,
            referenceSamplingSource,
            updatedAt: new Date(),
          },
        };
      });
      if (didChange) markProjectDirty();
    },
  };
};
