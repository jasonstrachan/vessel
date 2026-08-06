'use client';

import CustomSwitch from '@/components/ui/CustomSwitch';
import DimensionsBox from '@/components/ui/DimensionsBox';
import { useAppStore } from '@/stores/useAppStore';
import {
  selectTemporaryCustomBrush,
  selectCustomBrushCaptureAllLayers,
  selectCustomBrushCaptureMode,
  selectCustomBrushFreehandPath,
  selectBrushSettings,
} from '@/stores/selectors/toolsSelectors';
import { selectSelectionRects } from '@/stores/selectors/pasteSelectors';
import { selectActiveLayer } from '@/stores/selectors/layersSelectors';
import { CustomBrush, BrushShape } from '@/types';
import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { brushCache } from '@/utils/brushCache';
import { scaledBrushCache } from '@/utils/scaledBrushCache';
import {
  captureBrushFromCanvas,
  captureBrushFromPath,
  selectionToCaptureBounds,
  captureColorCycleDataFromLayer,
  MAX_CUSTOM_BRUSH_CAPTURE_PIXELS,
} from '@/utils/customBrushCapture';
import type { BrushCaptureResult } from '@/utils/customBrushCapture';
import {
  getCustomBrushColorCycleDefaultAlphaMaskEnabled,
  getCustomBrushColorCycleDefaultMode,
} from '@/utils/customBrushColorCycle';
import { DEFAULT_GRADIENT_STOPS } from '@/utils/gradientPresets';

export const CustomBrushPanel = () => {
  const temporaryCustomBrush = useAppStore(selectTemporaryCustomBrush);
  const activeLayer = useAppStore(selectActiveLayer);
  const { selectionStart, selectionEnd } = useAppStore(selectSelectionRects);
  const selectionSource = useAppStore((state) => state.selectionLastAction?.source ?? null);
  const clearSelection = useAppStore((state) => state.clearSelection);
  const currentOffscreenCanvas = useAppStore((state) => state.currentOffscreenCanvas);
  const setTemporaryCustomBrush = useAppStore((state) => state.setTemporaryCustomBrush);
  const setBrushSettings = useAppStore((state) => state.setBrushSettings);
  const setGlobalBrushSize = useAppStore((state) => state.setGlobalBrushSize);
  const setCustomBrushSizePercent = useAppStore((state) => state.setCustomBrushSizePercent);
  const sampleAllLayers = useAppStore(selectCustomBrushCaptureAllLayers);
  const captureMode = useAppStore(selectCustomBrushCaptureMode);
  const freehandPath = useAppStore(selectCustomBrushFreehandPath);
  const brushSettings = useAppStore(selectBrushSettings);
  const setCustomBrushSampleAllLayers = useAppStore((state) => state.setCustomBrushSampleAllLayers);
  const setCustomBrushCaptureMode = useAppStore((state) => state.setCustomBrushCaptureMode);
  const setCustomBrushFreehandPath = useAppStore((state) => state.setCustomBrushFreehandPath);
  const setCurrentTool = useAppStore((state) => state.setCurrentTool);
  const saveCustomBrushAsPreset = useAppStore((state) => state.saveCustomBrushAsPreset);
  const ensureColorCycleLayerRuntime = useAppStore(
    (state) => state.ensureColorCycleLayerRuntime,
  );
  const addNotification = useAppStore((state) => state.addNotification);
  const [ccImportedHint, setCcImportedHint] = useState(false);
  const captureInFlightRef = useRef(false);

  const cancelCapture = useCallback(() => {
    const hasTemporaryBrush = Boolean(temporaryCustomBrush);
    setTemporaryCustomBrush(null);
    setCustomBrushFreehandPath(null);
    clearSelection();
    setCcImportedHint(false);

    const selectedBrushId = brushSettings.selectedCustomBrush;
    const isTempSelected = typeof selectedBrushId === 'string' && selectedBrushId.startsWith('temp_brush_');
    if (hasTemporaryBrush || isTempSelected) {
      setBrushSettings({
        brushShape: BrushShape.ROUND,
        selectedCustomBrush: null,
        currentBrushTip: undefined,
      });
    }
  }, [
    temporaryCustomBrush,
    brushSettings.selectedCustomBrush,
    setTemporaryCustomBrush,
    setCustomBrushFreehandPath,
    clearSelection,
    setBrushSettings,
  ]);

  const resolveCaptureSource = useCallback(async () => {
    if (sampleAllLayers || !activeLayer) {
      return {
        sourceCanvas: currentOffscreenCanvas,
        sourceLayer: activeLayer,
        expectsColorCycle: false,
      };
    }

    if (activeLayer.layerType !== 'color-cycle') {
      return {
        sourceCanvas: activeLayer.framebuffer,
        sourceLayer: activeLayer,
        expectsColorCycle: false,
      };
    }

    try {
      await ensureColorCycleLayerRuntime(activeLayer.id, {
        target: 'active',
      });
    } catch {
      // Continue with the raster source. Canonical capture below will fail
      // closed and surface the explicit raster-fallback notification.
    }
    return {
      sourceCanvas: activeLayer.colorCycleData?.canvas ?? activeLayer.framebuffer,
      sourceLayer: activeLayer,
      expectsColorCycle: true,
    };
  }, [
    activeLayer,
    currentOffscreenCanvas,
    ensureColorCycleLayerRuntime,
    sampleAllLayers,
  ]);

  const applyCaptureResult = useCallback((
    captureResult: BrushCaptureResult,
    options?: {
      colorCycleData?: CustomBrush['colorCycle'];
    }
  ) => {
    const {
      imageData,
      width,
      height,
      naturalWidth,
      naturalHeight,
      maxDimension,
      thumbnail,
    } = captureResult;

    const hasColorCycle = Boolean(options?.colorCycleData);
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
      colorCycle: options?.colorCycleData,
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
      pressureEnabled: false,
      minPressure: 99,
      maxPressure: undefined,
      customBrushColorCycle: hasColorCycle,
      customBrushColorCycleMode: getCustomBrushColorCycleDefaultMode(options?.colorCycleData),
      customBrushUseCapturedAlphaMask:
        getCustomBrushColorCycleDefaultAlphaMaskEnabled(options?.colorCycleData),
      colorCycleGradient: hasColorCycle
        ? (options?.colorCycleData?.gradient?.map((stop) => ({ ...stop })) ??
          DEFAULT_GRADIENT_STOPS.map((stop) => ({ ...stop })))
        : undefined,
      colorCycleSpeed: hasColorCycle
        ? Math.max(0, Math.min(2.64, Number(options?.colorCycleData?.speed ?? 0.1)))
        : undefined,
      customBrushCcPhaseMode: hasColorCycle ? (options?.colorCycleData?.phaseMode ?? 'global') : undefined,
      customBrushCcPhaseJitter: hasColorCycle ? (options?.colorCycleData?.phaseJitter ?? 0) : undefined,
      currentBrushTip: {
        imageData: tempBrush.imageData,
        brushId: tempBrush.id,
        width: tempBrush.width,
        height: tempBrush.height,
        naturalWidth: tempBrush.naturalWidth ?? tempBrush.width,
        naturalHeight: tempBrush.naturalHeight ?? tempBrush.height,
        maxDimension: tempBrush.maxDimension ?? Math.max(tempBrush.width, tempBrush.height),
        colorCycle: tempBrush.colorCycle,
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

  const notifyRasterFallback = useCallback(() => {
    addNotification({
      type: 'warning',
      title: 'Captured as raster brush',
      message: 'The color-cycle layer data was unavailable, so no synthetic CC payload was created.',
      timestamp: new Date(),
    });
  }, [addNotification]);

  const notifyCaptureTooLarge = useCallback(() => {
    addNotification({
      type: 'warning',
      title: 'Brush capture is too large',
      message: 'Choose a region no larger than 4,194,304 pixels.',
      timestamp: new Date(),
    });
  }, [addNotification]);

  const createBrushFromSelection = useCallback(async () => {
    if (captureMode !== 'rectangle') {
      return;
    }

    if (!selectionStart || !selectionEnd) return;

    const bounds = selectionToCaptureBounds(selectionStart, selectionEnd);
    if (!bounds) {
      return;
    }
    if (bounds.width * bounds.height > MAX_CUSTOM_BRUSH_CAPTURE_PIXELS) {
      notifyCaptureTooLarge();
      return;
    }

    if (captureInFlightRef.current) {
      return;
    }
    captureInFlightRef.current = true;

    try {
      const { sourceCanvas, sourceLayer, expectsColorCycle } = await resolveCaptureSource();
      if (!sourceCanvas) {
        return;
      }

      const captureResult = captureBrushFromCanvas(sourceCanvas, bounds);
      if (!captureResult) {
        return;
      }

      const capturedColorCycle = expectsColorCycle && sourceLayer?.layerType === 'color-cycle'
        ? captureColorCycleDataFromLayer({
            activeLayer: sourceLayer,
            sampleAllLayers,
            bounds,
            captureResult,
          })
        : undefined;

      if (expectsColorCycle && !capturedColorCycle) {
        notifyRasterFallback();
      }
      setCcImportedHint(Boolean(capturedColorCycle));
      applyCaptureResult(captureResult, { colorCycleData: capturedColorCycle });
      clearSelection();
      setCurrentTool('brush');
    } finally {
      captureInFlightRef.current = false;
    }
  }, [
    captureMode,
    selectionStart,
    selectionEnd,
    sampleAllLayers,
    resolveCaptureSource,
    notifyRasterFallback,
    notifyCaptureTooLarge,
    applyCaptureResult,
    clearSelection,
    setCurrentTool,
  ]);

  const createBrushFromFreehandPath = useCallback(async () => {
    if (captureMode !== 'freehand' || !freehandPath) {
      return;
    }

    if (!freehandPath.bounds || freehandPath.points.length < 3) {
      return;
    }
    if (
      freehandPath.bounds.width * freehandPath.bounds.height >
      MAX_CUSTOM_BRUSH_CAPTURE_PIXELS
    ) {
      notifyCaptureTooLarge();
      return;
    }

    if (captureInFlightRef.current) {
      return;
    }
    captureInFlightRef.current = true;

    try {
      const { sourceCanvas, sourceLayer, expectsColorCycle } = await resolveCaptureSource();
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

      const capturedColorCycle = expectsColorCycle && sourceLayer?.layerType === 'color-cycle'
        ? captureColorCycleDataFromLayer({
            activeLayer: sourceLayer,
            sampleAllLayers,
            bounds: freehandPath.bounds,
            captureResult,
          })
        : undefined;

      if (expectsColorCycle && !capturedColorCycle) {
        notifyRasterFallback();
      }
      setCcImportedHint(Boolean(capturedColorCycle));
      applyCaptureResult(captureResult, { colorCycleData: capturedColorCycle });
      setCustomBrushFreehandPath(null);
      setCurrentTool('brush');
    } finally {
      captureInFlightRef.current = false;
    }
  }, [
    captureMode,
    freehandPath,
    sampleAllLayers,
    resolveCaptureSource,
    notifyRasterFallback,
    notifyCaptureTooLarge,
    applyCaptureResult,
    setCustomBrushFreehandPath,
    setCurrentTool,
  ]);

  // Preview bounds update continuously; capture only the completed marquee.
  useEffect(() => {
    if (
      captureMode === 'rectangle' &&
      selectionSource === 'custom-selection-final' &&
      selectionStart &&
      selectionEnd
    ) {
      void createBrushFromSelection();
    }
  }, [
    captureMode,
    selectionSource,
    selectionStart,
    selectionEnd,
    createBrushFromSelection,
  ]);

  useEffect(() => {
    if (captureMode === 'freehand' && freehandPath) {
      void createBrushFromFreehandPath();
    }
  }, [captureMode, createBrushFromFreehandPath, freehandPath]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      cancelCapture();
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [cancelCapture]);

  const handleSaveCustomBrush = () => {
    if (!temporaryCustomBrush) return;
    saveCustomBrushAsPreset(temporaryCustomBrush.id);
    setCcImportedHint(false);
  };


  const canCreateBrush = captureMode === 'rectangle'
    ? Boolean(selectionStart && selectionEnd)
    : Boolean(freehandPath && freehandPath.points.length >= 3);
  const hasTemporaryBrush = !!temporaryCustomBrush;
  const captureBounds = useMemo(() => {
    if (captureMode === 'rectangle') {
      return selectionToCaptureBounds(selectionStart, selectionEnd);
    }

    return freehandPath?.bounds ?? null;
  }, [captureMode, freehandPath?.bounds, selectionEnd, selectionStart]);

  return (
    <div className="p-4 bg-[#2a2a2a] border-t border-[#404040]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[#D9D9D9] text-base font-light">
          {hasTemporaryBrush ? 'Brush ready' : 'Custom brush'}
        </h3>
        {hasTemporaryBrush ? (
          <div className="flex gap-2">
            <button
              onClick={handleSaveCustomBrush}
              className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white text-sm transition-colors"
              title="Save brush to library"
            >
              Save
            </button>
            <button
              onClick={cancelCapture}
              className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-sm transition-colors"
              title="Discard captured brush"
            >
              Discard
            </button>
          </div>
        ) : (
          <div className="text-sm text-gray-400">
            {canCreateBrush ? 'Selection ready' : ''}
          </div>
        )}
      </div>

      {!hasTemporaryBrush && <div className="mb-3">
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
                aria-pressed={isActive}
                className={`${
                  isActive ? 'bg-white text-black' : 'bg-[#1f1f1f] text-gray-300'
                } px-3 py-1 text-sm border border-[#3a3a3a] transition-colors`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>}

      {!hasTemporaryBrush && <div className="mt-2 flex items-center justify-between">
        <span className="text-sm text-gray-300">All layers</span>
        <CustomSwitch
          aria-label="All layers"
          checked={sampleAllLayers}
          onChange={setCustomBrushSampleAllLayers}
        />
      </div>}
      {!hasTemporaryBrush && captureBounds ? (
        <DimensionsBox
          label={captureMode === 'rectangle' ? 'Selection' : 'Capture bounds'}
          width={captureBounds.width}
          height={captureBounds.height}
          className="mt-3"
        />
      ) : null}
      {/* Show temporary brush preview if available */}
      {hasTemporaryBrush && (
        <div className="mt-4 p-3 bg-[#1a1a1a]">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img 
              src={temporaryCustomBrush.thumbnail} 
              alt="Temporary brush"
              className="w-16 h-16 border border-gray-600"
              style={{ imageRendering: 'pixelated' }}
            />
            <div className="flex-1">
              <p className="text-sm text-gray-300">Ready to paint</p>
              <p className="text-xs text-gray-500">
                Size: {temporaryCustomBrush.width}×{temporaryCustomBrush.height}
              </p>
              {ccImportedHint && (
                <p className="text-xs text-amber-400 mt-1">
                  Imported color-cycle gradient and speed from active CC layer.
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCurrentTool('custom')}
            className="mt-3 w-full border border-[#4a4a4a] px-3 py-1 text-sm text-gray-300 hover:bg-[#2a2a2a]"
          >
            Recapture
          </button>
        </div>
      )}

    </div>
  );
};
