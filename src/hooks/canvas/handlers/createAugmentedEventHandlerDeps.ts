import type React from 'react';
import type {
  ContourLinesState,
  EventHandlerDependencies,
  EventHandlerDynamicDeps,
  Lines2DefaultsCache,
} from '@/hooks/canvas/utils/types';

type DynamicDepKey =
  | 'project'
  | 'canvas'
  | 'tools'
  | 'layers'
  | 'activeLayerId'
  | 'selectionStart'
  | 'selectionEnd'
  | 'selectionMask'
  | 'selectionMaskBounds'
  | 'floatingPaste'
  | 'isDraggingFloatingPaste'
  | 'palette'
  | 'polygonGradientState'
  | 'recolorSampling'
  | 'currentBrushPresetId';

type InjectedDepKey =
  | 'dynamicDepsRef'
  | 'snapStrokeStartRef'
  | 'snapShiftAnchorRef'
  | 'snapLastBrushSampleRef'
  | 'contourLinesStateRef'
  | 'contourLinesDefaultsCacheRef'
  | 'contourLinesFinalizingRef'
  | 'selectionRuntimeRef'
  | 'previewSessionIdRef'
  | 'newPreviewSession'
  | 'isCurrentPreviewSession';

type EventHandlerStaticDeps = Omit<EventHandlerDependencies, DynamicDepKey | InjectedDepKey>;

type BuildAugmentedEventHandlerDepsArgs = {
  staticDeps: EventHandlerStaticDeps;
  dynamicDepsRef: React.MutableRefObject<EventHandlerDynamicDeps>;
  snapStrokeStartRef: React.MutableRefObject<{ x: number; y: number } | null>;
  snapShiftAnchorRef: React.MutableRefObject<{ x: number; y: number } | null>;
  snapLastBrushSampleRef: React.MutableRefObject<{ x: number; y: number } | null>;
  contourLinesStateRef: React.MutableRefObject<ContourLinesState>;
  contourLinesDefaultsCacheRef: React.MutableRefObject<Lines2DefaultsCache | null>;
  contourLinesFinalizingRef: React.MutableRefObject<boolean>;
  selectionRuntimeRef: EventHandlerDependencies['selectionRuntimeRef'];
  previewSessionIdRef: React.MutableRefObject<number>;
  newPreviewSession: () => number;
  isCurrentPreviewSession: (sessionId: number) => boolean;
};

export const createAugmentedEventHandlerDeps = (
  args: BuildAugmentedEventHandlerDepsArgs
): EventHandlerDependencies => {
  const {
    staticDeps,
    dynamicDepsRef,
    snapStrokeStartRef,
    snapShiftAnchorRef,
    snapLastBrushSampleRef,
    contourLinesStateRef,
    contourLinesDefaultsCacheRef,
    contourLinesFinalizingRef,
    selectionRuntimeRef,
    previewSessionIdRef,
    newPreviewSession,
    isCurrentPreviewSession,
  } = args;

  return {
    ...staticDeps,
    dynamicDepsRef,
    snapStrokeStartRef,
    snapShiftAnchorRef,
    snapLastBrushSampleRef,
    contourLinesStateRef,
    contourLinesDefaultsCacheRef,
    contourLinesFinalizingRef,
    selectionRuntimeRef,
    previewSessionIdRef,
    newPreviewSession,
    isCurrentPreviewSession,
    get project() {
      return dynamicDepsRef.current.project;
    },
    get canvas() {
      return dynamicDepsRef.current.canvas;
    },
    get tools() {
      return dynamicDepsRef.current.tools;
    },
    get layers() {
      return dynamicDepsRef.current.layers;
    },
    get activeLayerId() {
      return dynamicDepsRef.current.activeLayerId;
    },
    get selectionStart() {
      return dynamicDepsRef.current.selectionStart;
    },
    get selectionEnd() {
      return dynamicDepsRef.current.selectionEnd;
    },
    get selectionMask() {
      return dynamicDepsRef.current.selectionMask;
    },
    get selectionMaskBounds() {
      return dynamicDepsRef.current.selectionMaskBounds;
    },
    get floatingPaste() {
      return dynamicDepsRef.current.floatingPaste;
    },
    get isDraggingFloatingPaste() {
      return dynamicDepsRef.current.isDraggingFloatingPaste;
    },
    get palette() {
      return dynamicDepsRef.current.palette;
    },
    get polygonGradientState() {
      return dynamicDepsRef.current.polygonGradientState;
    },
    get recolorSampling() {
      return dynamicDepsRef.current.recolorSampling;
    },
    get currentBrushPresetId() {
      return dynamicDepsRef.current.currentBrushPresetId;
    },
  };
};
