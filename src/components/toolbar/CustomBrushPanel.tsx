'use client';

import CustomSwitch from '@/components/ui/CustomSwitch';
import { useAppStore } from '@/stores/useAppStore';
import { selectCustomBrushes } from '@/stores/selectors/projectSelectors';
import {
  selectTemporaryCustomBrush,
  selectCustomBrushCaptureAllLayers,
  selectCustomBrushCaptureMode,
  selectCustomBrushFreehandPath,
} from '@/stores/selectors/toolsSelectors';
import { selectSelectionRects } from '@/stores/selectors/pasteSelectors';
import { selectActiveLayer } from '@/stores/selectors/layersSelectors';
import { CustomBrush, BrushShape } from '@/types';
import { useEffect, useCallback } from 'react';
import { brushCache } from '@/utils/brushCache';
import { scaledBrushCache } from '@/utils/scaledBrushCache';
import { captureBrushFromCanvas, captureBrushFromPath, selectionToCaptureBounds } from '@/utils/customBrushCapture';
import type { BrushCaptureResult } from '@/utils/customBrushCapture';

export const CustomBrushPanel = () => {
  const addCustomBrush = useAppStore((state) => state.addCustomBrush);
  const customBrushes = useAppStore(selectCustomBrushes);
  const temporaryCustomBrush = useAppStore(selectTemporaryCustomBrush);
  const activeLayer = useAppStore(selectActiveLayer);
  const { selectionStart, selectionEnd } = useAppStore(selectSelectionRects);
  const clearSelection = useAppStore((state) => state.clearSelection);
  const currentOffscreenCanvas = useAppStore((state) => state.currentOffscreenCanvas);
  const setTemporaryCustomBrush = useAppStore((state) => state.setTemporaryCustomBrush);
  const setBrushSettings = useAppStore((state) => state.setBrushSettings);
  const setGlobalBrushSize = useAppStore((state) => state.setGlobalBrushSize);
  const setCustomBrushSizePercent = useAppStore((state) => state.setCustomBrushSizePercent);
  const sampleAllLayers = useAppStore(selectCustomBrushCaptureAllLayers);
  const captureMode = useAppStore(selectCustomBrushCaptureMode);
  const freehandPath = useAppStore(selectCustomBrushFreehandPath);
  const setCustomBrushSampleAllLayers = useAppStore((state) => state.setCustomBrushSampleAllLayers);
  const setCustomBrushCaptureMode = useAppStore((state) => state.setCustomBrushCaptureMode);
  const setCustomBrushFreehandPath = useAppStore((state) => state.setCustomBrushFreehandPath);

  const resolveCaptureCanvas = useCallback(() => {
    if (!sampleAllLayers && activeLayer) {
      if (activeLayer.layerType === 'color-cycle') {
        return activeLayer.colorCycleData?.canvas ?? activeLayer.framebuffer;
      }
      return activeLayer.framebuffer;
    }
    return currentOffscreenCanvas;
  }, [sampleAllLayers, activeLayer, currentOffscreenCanvas]);

  // Clear temporary brush when there's no selection (i.e., when custom tool is deactivated)
  useEffect(() => {
    if (!selectionStart && !selectionEnd) {
      setTemporaryCustomBrush(null);
    }
  }, [selectionStart, selectionEnd, setTemporaryCustomBrush]);

  const applyCaptureResult = useCallback((captureResult: BrushCaptureResult) => {
    const {
      imageData,
      width,
      height,
      naturalWidth,
      naturalHeight,
      maxDimension,
      thumbnail,
    } = captureResult;

    const tempBrush: CustomBrush = {
      id: `temp_brush_${Date.now()}`,
      name: 'Temp Brush',
      imageData,
      thumbnail: thumbnail ?? '',
      width,
      height,
      createdAt: Date.now(),
      naturalWidth,
      naturalHeight,
      maxDimension,
    };

    setTemporaryCustomBrush(tempBrush);
    brushCache.clear();
    scaledBrushCache.clear();

    const normalizedSize = Math.max(1, Math.round(maxDimension));
    setGlobalBrushSize(normalizedSize);
    setBrushSettings({
      brushShape: BrushShape.CUSTOM,
      selectedCustomBrush: tempBrush.id,
      size: normalizedSize,
      customBrushSizePercent: 100,
      currentBrushTip: {
        imageData: tempBrush.imageData,
        brushId: tempBrush.id,
        width: tempBrush.width,
        height: tempBrush.height,
        naturalWidth: tempBrush.naturalWidth ?? tempBrush.width,
        naturalHeight: tempBrush.naturalHeight ?? tempBrush.height,
        maxDimension: tempBrush.maxDimension ?? Math.max(tempBrush.width, tempBrush.height),
        isColorizable: false
      }
    });
    setCustomBrushSizePercent(100);
  }, [
    setTemporaryCustomBrush,
    setBrushSettings,
    setGlobalBrushSize,
    setCustomBrushSizePercent
  ]);

  const createBrushFromSelection = useCallback(() => {
    if (captureMode !== 'rectangle') {
      return;
    }

    if (!selectionStart || !selectionEnd) return;

    const bounds = selectionToCaptureBounds(selectionStart, selectionEnd);
    if (!bounds) {
      return;
    }

    const sourceCanvas = resolveCaptureCanvas();
    if (!sourceCanvas) {
      return;
    }

    const captureResult = captureBrushFromCanvas(sourceCanvas, bounds);
    if (!captureResult) {
      return;
    }

    applyCaptureResult(captureResult);
  }, [
    captureMode,
    selectionStart,
    selectionEnd,
    resolveCaptureCanvas,
    applyCaptureResult
  ]);

  const createBrushFromFreehandPath = useCallback(() => {
    if (captureMode !== 'freehand' || !freehandPath) {
      return;
    }

    if (!freehandPath.bounds || freehandPath.points.length < 3) {
      return;
    }

    const sourceCanvas = resolveCaptureCanvas();
    if (!sourceCanvas) {
      return;
    }

    const captureResult = captureBrushFromPath(sourceCanvas, {
      points: freehandPath.points,
      bounds: freehandPath.bounds,
    });

    if (!captureResult) {
      return;
    }

    applyCaptureResult(captureResult);
    setCustomBrushFreehandPath(null);
  }, [
    captureMode,
    freehandPath,
    resolveCaptureCanvas,
    applyCaptureResult,
    setCustomBrushFreehandPath
  ]);

  // Create brush immediately when selection changes
  useEffect(() => {
    // Create brush immediately if we have a valid selection
    if (captureMode === 'rectangle' && selectionStart && selectionEnd && resolveCaptureCanvas()) {
      createBrushFromSelection();
    }
  }, [captureMode, selectionStart, selectionEnd, resolveCaptureCanvas, createBrushFromSelection]);

  useEffect(() => {
    if (captureMode === 'freehand' && freehandPath) {
      createBrushFromFreehandPath();
    }
  }, [captureMode, createBrushFromFreehandPath, freehandPath]);

  const handleSaveCustomBrush = () => {
    if (!temporaryCustomBrush) return;
    
    // Deep clone the ImageData to avoid reference issues
    const clonedImageData = new ImageData(
      new Uint8ClampedArray(temporaryCustomBrush.imageData.data),
      temporaryCustomBrush.imageData.width,
      temporaryCustomBrush.imageData.height
    );
    
    // Create a permanent brush from the temporary one
    const baseNaturalWidth = temporaryCustomBrush.naturalWidth ?? temporaryCustomBrush.width;
    const baseNaturalHeight = temporaryCustomBrush.naturalHeight ?? temporaryCustomBrush.height;
    const baseMaxDimension = temporaryCustomBrush.maxDimension ?? Math.max(baseNaturalWidth, baseNaturalHeight);

    const permanentBrush: CustomBrush = {
      ...temporaryCustomBrush,
      id: `brush_${Date.now()}`,
      name: `Custom ${customBrushes.length + 1}`,
      imageData: clonedImageData,
      naturalWidth: baseNaturalWidth,
      naturalHeight: baseNaturalHeight,
      maxDimension: baseMaxDimension,
    };
    
    
    // Add the brush to the project
    addCustomBrush(permanentBrush);
    
    
    // Update brush settings to use the new permanent brush at 100% size
    try { console.log('[CUSTOM/BRUSH] saving brush', { id: permanentBrush.id, w: permanentBrush.width, h: permanentBrush.height }); } catch {}
    const normalizedSize = Math.max(1, Math.round(permanentBrush.maxDimension ?? Math.max(permanentBrush.width, permanentBrush.height)));
    setGlobalBrushSize(normalizedSize);
    setBrushSettings({
      brushShape: BrushShape.CUSTOM,
      selectedCustomBrush: permanentBrush.id,
      size: normalizedSize,
      customBrushSizePercent: 100,
      currentBrushTip: {
        imageData: permanentBrush.imageData,
        brushId: permanentBrush.id,
        width: permanentBrush.width,
        height: permanentBrush.height,
        naturalWidth: permanentBrush.naturalWidth ?? permanentBrush.width,
        naturalHeight: permanentBrush.naturalHeight ?? permanentBrush.height,
        maxDimension: permanentBrush.maxDimension ?? Math.max(permanentBrush.width, permanentBrush.height),
        isColorizable: false
      }
    });
    setCustomBrushSizePercent(100);
    
    
    // Clear temporary brush and selection after a small delay
    setTimeout(() => {
      setTemporaryCustomBrush(null);
      clearSelection();
    }, 50);
  };


  const canCreateBrush = captureMode === 'rectangle'
    ? Boolean(selectionStart && selectionEnd)
    : Boolean(freehandPath && freehandPath.points.length >= 3);
  const hasTemporaryBrush = !!temporaryCustomBrush;

  return (
    <div className="p-4 bg-[#2a2a2a] border-t border-[#404040]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[#D9D9D9] text-base font-light">Custom brush</h3>
        {hasTemporaryBrush ? (
          <div className="flex gap-2">
            <button
              onClick={handleSaveCustomBrush}
              className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white text-sm rounded transition-colors"
              title="Save brush to library"
            >
              Save
            </button>
            <button
              onClick={() => {
                setTemporaryCustomBrush(null);
                clearSelection();
                setBrushSettings({
                  brushShape: BrushShape.ROUND, // Reset to round brush
                  selectedCustomBrush: null,
                  currentBrushTip: undefined
                });
              }}
              className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-sm rounded transition-colors"
              title="Cancel"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="text-sm text-gray-400">
            {canCreateBrush ? 'Selection ready' : 'Press C and select an area'}
          </div>
        )}
      </div>

      <div className="mb-3">
        <p className="text-sm text-gray-300 mb-2">Capture shape</p>
        <div className="flex gap-2" role="group" aria-label="Custom brush capture mode">
          {(
            [
              { label: 'Box', value: 'rectangle' as const },
              { label: 'Freehand', value: 'freehand' as const }
            ]
          ).map((option) => {
            const isActive = captureMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setCustomBrushCaptureMode(option.value)}
                className={`${
                  isActive ? 'bg-white text-black' : 'bg-[#1f1f1f] text-gray-300'
                } px-3 py-1 text-sm rounded border border-[#3a3a3a] transition-colors`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {captureMode === 'rectangle'
            ? 'Press C and drag a marquee to capture a box area.'
            : 'Draw a freehand outline directly on the canvas; release to capture that exact region.'}
        </p>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm text-gray-300">All layers</span>
        <CustomSwitch
          aria-label="All layers"
          checked={sampleAllLayers}
          onChange={setCustomBrushSampleAllLayers}
        />
      </div>
      <p className="mt-1 text-xs text-gray-500">
        When off, capture only the active layer.
      </p>

      {/* Show temporary brush preview if available */}
      {hasTemporaryBrush && (
        <div className="mt-4 p-3 bg-[#1a1a1a] rounded">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img 
              src={temporaryCustomBrush.thumbnail} 
              alt="Temporary brush"
              className="w-16 h-16 border border-gray-600"
              style={{ imageRendering: 'pixelated' }}
            />
            <div className="flex-1">
              <p className="text-sm text-gray-300">Testing temporary brush</p>
              <p className="text-xs text-gray-500">
                Size: {temporaryCustomBrush.width}×{temporaryCustomBrush.height}
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
