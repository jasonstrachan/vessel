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
import { useEffect, useCallback, useMemo, useState } from 'react';
import { brushCache } from '@/utils/brushCache';
import { scaledBrushCache } from '@/utils/scaledBrushCache';
import {
  captureBrushFromCanvas,
  captureBrushFromPath,
  selectionToCaptureBounds,
  captureColorCycleDataFromLayer,
  buildCapturedColorCycleDataFromImage,
} from '@/utils/customBrushCapture';
import type { BrushCaptureResult } from '@/utils/customBrushCapture';
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
  const [ccImportedHint, setCcImportedHint] = useState(false);

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

  const resolveCaptureCanvas = useCallback(() => {
    if (!sampleAllLayers && activeLayer) {
      if (activeLayer.layerType === 'color-cycle') {
        return activeLayer.colorCycleData?.canvas ?? activeLayer.framebuffer;
      }
      return activeLayer.framebuffer;
    }
    return currentOffscreenCanvas;
  }, [sampleAllLayers, activeLayer, currentOffscreenCanvas]);

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
      customBrushColorCycleMode:
        options?.colorCycleData?.schemaVersion === 2 ? options.colorCycleData.mode : 'tip',
      customBrushUseCapturedAlphaMask:
        options?.colorCycleData?.schemaVersion === 2
          ? options.colorCycleData.useAlphaMask !== false
          : true,
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

    const sourceIsColorCycleLayer =
      !sampleAllLayers &&
      activeLayer?.layerType === 'color-cycle';
    const sourceGradient =
      activeLayer?.colorCycleData?.gradient?.map((stop) => ({ ...stop })) ?? undefined;
    const sourceSpeed =
      activeLayer?.colorCycleData?.brushSpeed ?? undefined;
    const capturedColorCycle = sourceIsColorCycleLayer
      ? (
          captureColorCycleDataFromLayer({
            activeLayer,
            sampleAllLayers,
            bounds,
            captureResult,
          }) ??
          buildCapturedColorCycleDataFromImage(captureResult, {
            gradient: sourceGradient,
            speed: sourceSpeed,
          })
        )
      : undefined;

    const enableColorCycle = sourceIsColorCycleLayer;
    setCcImportedHint(enableColorCycle);
    applyCaptureResult(captureResult, {
      colorCycleData: capturedColorCycle,
    });
    clearSelection();
    setCurrentTool('brush');
  }, [
    captureMode,
    selectionStart,
    selectionEnd,
    activeLayer,
    sampleAllLayers,
    resolveCaptureCanvas,
    applyCaptureResult,
    clearSelection,
    setCurrentTool,
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

    const sourceIsColorCycleLayer =
      !sampleAllLayers &&
      activeLayer?.layerType === 'color-cycle';
    const sourceGradient =
      activeLayer?.colorCycleData?.gradient?.map((stop) => ({ ...stop })) ?? undefined;
    const sourceSpeed =
      activeLayer?.colorCycleData?.brushSpeed ?? undefined;
    const capturedColorCycle = sourceIsColorCycleLayer
      ? (
          captureColorCycleDataFromLayer({
            activeLayer,
            sampleAllLayers,
            bounds: freehandPath.bounds,
            captureResult,
          }) ??
          buildCapturedColorCycleDataFromImage(captureResult, {
            gradient: sourceGradient,
            speed: sourceSpeed,
          })
        )
      : undefined;

    const enableColorCycle = sourceIsColorCycleLayer;
    setCcImportedHint(enableColorCycle);
    applyCaptureResult(captureResult, {
      colorCycleData: capturedColorCycle,
    });
    setCustomBrushFreehandPath(null);
    setCurrentTool('brush');
  }, [
    captureMode,
    freehandPath,
    activeLayer,
    sampleAllLayers,
    resolveCaptureCanvas,
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
      selectionEnd &&
      resolveCaptureCanvas()
    ) {
      createBrushFromSelection();
    }
  }, [
    captureMode,
    selectionSource,
    selectionStart,
    selectionEnd,
    resolveCaptureCanvas,
    createBrushFromSelection,
  ]);

  useEffect(() => {
    if (captureMode === 'freehand' && freehandPath) {
      createBrushFromFreehandPath();
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
