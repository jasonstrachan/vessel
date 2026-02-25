import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';

import type { ProjectPreview } from '@/components/modals/types';

const PREVIEW_MAX_SCALE = 2;

type UsePreviewViewportPanZoomOptions = {
  preview: ProjectPreview | null;
  modalWidth: number;
  modalHeight: number;
};

export function usePreviewViewportPanZoom({
  preview,
  modalWidth,
  modalHeight,
}: UsePreviewViewportPanZoomOptions) {
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
  const [previewScale, setPreviewScale] = useState(1);
  const [isPreviewPanning, setIsPreviewPanning] = useState(false);

  const previewWrapperRef = useRef<HTMLDivElement | null>(null);
  const previewOffsetRef = useRef(previewOffset);
  const panStateRef = useRef({
    isPanning: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
    pointerId: 0,
  });

  const computeCenteredOffset = useCallback((container: number, content: number) => {
    return (container - content) / 2;
  }, []);

  const clampOffset = useCallback((value: number, container: number, content: number) => {
    if (!Number.isFinite(container) || !Number.isFinite(content)) {
      return 0;
    }
    if (content <= container) {
      return (container - content) / 2;
    }
    const min = container - content;
    const max = 0;
    return Math.min(max, Math.max(min, value));
  }, []);

  const stopPreviewPan = useCallback((pointerId?: number) => {
    const wrapper = previewWrapperRef.current;
    if (pointerId !== undefined && wrapper?.hasPointerCapture(pointerId)) {
      wrapper.releasePointerCapture(pointerId);
    }
    panStateRef.current.isPanning = false;
    setIsPreviewPanning(false);
  }, []);

  const centerPreview = useCallback(() => {
    if (!preview?.thumbnail || !previewWrapperRef.current) {
      return;
    }
    const rect = previewWrapperRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const fitScale = Math.min(
      PREVIEW_MAX_SCALE,
      rect.width / preview.width,
      rect.height / preview.height,
    );
    const safeScale = Number.isFinite(fitScale) && fitScale > 0 ? fitScale : PREVIEW_MAX_SCALE;
    setPreviewScale(safeScale);
    const scaledWidth = preview.width * safeScale;
    const scaledHeight = preview.height * safeScale;
    const nextX = clampOffset(
      computeCenteredOffset(rect.width, scaledWidth),
      rect.width,
      scaledWidth,
    );
    const nextY = clampOffset(
      computeCenteredOffset(rect.height, scaledHeight),
      rect.height,
      scaledHeight,
    );
    setPreviewOffset({ x: nextX, y: nextY });
  }, [clampOffset, computeCenteredOffset, preview]);

  const resetPreviewViewport = useCallback(() => {
    stopPreviewPan();
    setPreviewOffset({ x: 0, y: 0 });
    setPreviewScale(1);
  }, [stopPreviewPan]);

  useEffect(() => {
    previewOffsetRef.current = previewOffset;
  }, [previewOffset]);

  useLayoutEffect(() => {
    if (!preview) {
      return;
    }
    let cancelled = false;
    const attemptCenter = () => {
      if (cancelled || isPreviewPanning) {
        return;
      }
      const wrapper = previewWrapperRef.current;
      if (!wrapper) {
        return;
      }
      const rect = wrapper.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        requestAnimationFrame(attemptCenter);
        return;
      }
      centerPreview();
    };
    const frame = requestAnimationFrame(attemptCenter);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [preview, modalWidth, modalHeight, centerPreview, isPreviewPanning]);

  const handlePreviewPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!preview?.thumbnail) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const wrapper = previewWrapperRef.current;
    if (!wrapper) {
      return;
    }
    wrapper.setPointerCapture(event.pointerId);
    panStateRef.current = {
      isPanning: true,
      startX: event.clientX,
      startY: event.clientY,
      baseX: previewOffsetRef.current.x,
      baseY: previewOffsetRef.current.y,
      pointerId: event.pointerId,
    };
    setIsPreviewPanning(true);
  }, [preview]);

  const handlePreviewPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!panStateRef.current.isPanning) {
      return;
    }
    event.preventDefault();
    const dx = event.clientX - panStateRef.current.startX;
    const dy = event.clientY - panStateRef.current.startY;
    const wrapper = previewWrapperRef.current;
    if (!wrapper || !preview) {
      return;
    }
    const rect = wrapper.getBoundingClientRect();
    const scaledWidth = preview.width * previewScale;
    const scaledHeight = preview.height * previewScale;
    setPreviewOffset({
      x: clampOffset(panStateRef.current.baseX + dx, rect.width, scaledWidth),
      y: clampOffset(panStateRef.current.baseY + dy, rect.height, scaledHeight),
    });
  }, [clampOffset, preview, previewScale]);

  const handlePreviewPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!panStateRef.current.isPanning) {
      return;
    }
    stopPreviewPan(event.pointerId);
  }, [stopPreviewPan]);

  const handlePreviewDoubleClick = useCallback(() => {
    centerPreview();
  }, [centerPreview]);

  return {
    previewOffset,
    previewScale,
    isPreviewPanning,
    previewWrapperRef,
    centerPreview,
    resetPreviewViewport,
    handlePreviewPointerDown,
    handlePreviewPointerMove,
    handlePreviewPointerUp,
    handlePreviewDoubleClick,
  };
}

