import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { ManagedColorCycleBrush } from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import type { FinalizeColorCycleBrushDeps } from '@/hooks/canvas/handlers/colorCycle/colorCycleFinalize';

export type FinalizeColorCycleBrushBaseDeps = Omit<
  FinalizeColorCycleBrushDeps,
  'drawingCanvas' | 'drawingCtx'
>;

export const createFinalizeColorCycleBrushBaseDeps = ({
  storeRef,
  brushEngine,
  drawingCanvasHasContent,
  colorCycleAnimationRef,
  brushSamplingPreviewActiveRef,
  autoSamplePointsRef,
  autoSampleLastUpdateRef,
  autoSampleLastAppliedHashRef,
  finalizeInProgressRef,
  computeAutoSampleStops,
  clearBrushSamplingPreview,
  getBrushForLayer,
  getEffectiveColorCyclePlaying,
  startPlaybackRef,
}: {
  storeRef: React.MutableRefObject<AppState>;
  brushEngine: FinalizeColorCycleBrushDeps['brushEngine'];
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  colorCycleAnimationRef: React.MutableRefObject<number | null>;
  brushSamplingPreviewActiveRef: React.MutableRefObject<boolean>;
  autoSamplePointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  autoSampleLastUpdateRef: React.MutableRefObject<number>;
  autoSampleLastAppliedHashRef: React.MutableRefObject<string>;
  finalizeInProgressRef?: React.MutableRefObject<boolean>;
  computeAutoSampleStops: FinalizeColorCycleBrushDeps['computeAutoSampleStops'];
  clearBrushSamplingPreview: () => void;
  getBrushForLayer: (layerId: string) => ManagedColorCycleBrush | undefined;
  getEffectiveColorCyclePlaying: () => boolean;
  startPlaybackRef: React.MutableRefObject<((reason?: string) => void) | null>;
}): FinalizeColorCycleBrushBaseDeps => ({
  storeRef,
  brushEngine,
  drawingCanvasHasContent,
  colorCycleAnimationRef,
  brushSamplingPreviewActiveRef,
  autoSamplePointsRef,
  autoSampleLastUpdateRef,
  autoSampleLastAppliedHashRef,
  finalizeInProgressRef,
  computeAutoSampleStops,
  clearBrushSamplingPreview,
  getBrushForLayer,
  getEffectiveColorCyclePlaying,
  startPlaybackRef,
});

export const createFinalizeColorCycleBrushDeps = ({
  base,
  drawingCanvas,
  drawingCtx,
}: {
  base: FinalizeColorCycleBrushBaseDeps;
  drawingCanvas: HTMLCanvasElement | null;
  drawingCtx: CanvasRenderingContext2D | null;
}): FinalizeColorCycleBrushDeps => ({
  ...base,
  drawingCanvas,
  drawingCtx,
});
