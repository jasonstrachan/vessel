import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import type { ShapeBeforeSnapshot } from '@/hooks/canvas/utils/snapshots';
import type { Layer } from '@/types';

export const clearShapeBeforeSnapshot = ({
  shapeBeforeImageRef,
  shapeBeforeSnapshotCapturedRef,
}: {
  shapeBeforeImageRef: React.MutableRefObject<ShapeBeforeSnapshot | null>;
  shapeBeforeSnapshotCapturedRef: React.MutableRefObject<boolean>;
}): void => {
  shapeBeforeImageRef.current = null;
  shapeBeforeSnapshotCapturedRef.current = false;
};

export const capturePendingShapeSnapshot = ({
  shapeBeforeSnapshotCapturedRef,
  shapeBeforeImageRef,
  storeRef,
  project,
  shapePointsRef,
  strokeCapturePaddingRef,
  roiPadding,
  captureRegionFromPoints,
  captureLayerRegionImageData,
}: {
  shapeBeforeSnapshotCapturedRef: React.MutableRefObject<boolean>;
  shapeBeforeImageRef: React.MutableRefObject<ShapeBeforeSnapshot | null>;
  storeRef: React.MutableRefObject<AppState>;
  project: { width: number; height: number } | null;
  shapePointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  strokeCapturePaddingRef: React.MutableRefObject<number>;
  roiPadding: number;
  captureRegionFromPoints: (
    points: Array<{ x: number; y: number }> | undefined,
    padding: number,
    project: { width: number; height: number } | null
  ) => CaptureRegion | null | undefined;
  captureLayerRegionImageData: (layer: Layer | null | undefined, roi: CaptureRegion) => ImageData | null;
}): void => {
  if (shapeBeforeSnapshotCapturedRef.current) {
    return;
  }
  const state = storeRef.current;
  const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!activeLayer || activeLayer.layerType === 'color-cycle') {
    shapeBeforeSnapshotCapturedRef.current = true;
    return;
  }
  const projectDimensions =
    project ?? state.project ?? (activeLayer.imageData
      ? { width: activeLayer.imageData.width, height: activeLayer.imageData.height }
      : activeLayer.framebuffer
        ? { width: activeLayer.framebuffer.width, height: activeLayer.framebuffer.height }
        : null);
  if (!projectDimensions) {
    return;
  }
  const roi = captureRegionFromPoints(
    shapePointsRef.current,
    roiPadding + strokeCapturePaddingRef.current,
    projectDimensions
  );
  if (!roi) {
    return;
  }
  const regionData = captureLayerRegionImageData(activeLayer, roi);
  if (!regionData) {
    return;
  }
  if (
    roi.x <= 0 &&
    roi.y <= 0 &&
    roi.width >= projectDimensions.width &&
    roi.height >= projectDimensions.height
  ) {
    shapeBeforeImageRef.current = { kind: 'full', image: regionData };
  } else {
    shapeBeforeImageRef.current = { kind: 'region', image: regionData, roi };
  }
  shapeBeforeSnapshotCapturedRef.current = true;
};
