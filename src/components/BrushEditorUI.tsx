'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { HueSlider } from '@/components/ui/HueSlider';
import { LightnessSlider } from '@/components/ui/LightnessSlider';
import { SaturationSlider } from '@/components/ui/SaturationSlider';
import { useBrushEngineSimplified } from '@/hooks/useBrushEngineSimplified';
import { useKeyboardScope } from '@/hooks/useKeyboardScope';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape } from '@/types';
import { brushCache } from '@/utils/brushCache';
import { scaledBrushCache } from '@/utils/scaledBrushCache';
import { selectBrushEditor, selectBrushSettings, selectCurrentTool } from '@/stores/selectors/toolsSelectors';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const HUE_SLIDER_SAMPLE_COUNT = 24;
const LIGHTNESS_SLIDER_SAMPLE_COUNT = 16;
const SATURATION_SLIDER_SAMPLE_COUNT = 16;
const SATURATION_SLIDER_MAX = 200;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const InlineBrushEditor: React.FC = () => {
  const brushEditor = useAppStore(selectBrushEditor);
  const brushSettings = useAppStore(selectBrushSettings);
  const projectCustomBrushes = useAppStore((state) => state.project?.customBrushes ?? []);
  const customBrushes = projectCustomBrushes;
  const getCustomBrushByIdUnsafe = useAppStore((state) => state.getCustomBrushByIdUnsafe);
  const currentTool = useAppStore(selectCurrentTool);
  const {
    color: brushColor,
    size: brushSize,
    brushShape,
    selectedCustomBrush,
    currentBrushTip,
    hueShift: brushHueShift = 0,
    lightnessAdjust: brushLightnessAdjust = 0,
    saturationAdjust: brushSaturationAdjust = 100,
  } = brushSettings;
  const setBrushEditorHue = useAppStore((state) => state.setBrushEditorHue);
  const setBrushEditorLightness = useAppStore((state) => state.setBrushEditorLightness);
  const setBrushEditorSaturation = useAppStore((state) => state.setBrushEditorSaturation);
  const saveBrushEdit = useAppStore((state) => state.saveBrushEdit);
  const startBrushEdit = useAppStore((state) => state.startBrushEdit);
  const refreshCurrentBrushTipFromSource = useAppStore((state) => state.refreshCurrentBrushTipFromSource);
  const currentOffscreenCanvas = useAppStore((state) => state.currentOffscreenCanvas);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const autoSaveTimeoutRef = useRef<number | null>(null);
  const modificationPendingRef = useRef(false);

  const [basePixels, setBasePixels] = useState<ImageData | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPoint, setLastPoint] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPoint, setLastPanPoint] = useState<{ x: number; y: number } | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPointerActive, setIsPointerActive] = useState(false);

  const brushEngine = useBrushEngineSimplified();

  const editingBounds = brushEditor.editingBounds;
  const isEditing = brushEditor.status === 'EDITING' && !!editingBounds;
  const canvasPixelWidth = editingBounds?.width ?? 0;
  const canvasPixelHeight = editingBounds?.height ?? 0;

  const isCustomBrushActive = brushShape === BrushShape.CUSTOM;
  const hasCustomBrushTipPreview = isCustomBrushActive && !!currentBrushTip?.imageData;

  const previewWidth = currentBrushTip?.width ?? (canvasPixelWidth || 128);
  const previewHeight = currentBrushTip?.height ?? (canvasPixelHeight || 128);

  const activeHueShift = isEditing ? brushEditor.hueShift : brushHueShift;
  const activeLightness = isEditing ? brushEditor.lightness : brushLightnessAdjust;
  const activeSaturation = isEditing ? brushEditor.saturation : brushSaturationAdjust;

  const containerHeight = useMemo(() => {
    const target = (isEditing ? canvasPixelHeight : previewHeight) + 100;
    return Math.max(200, Math.min(target, 420));
  }, [canvasPixelHeight, isEditing, previewHeight]);

  const averageBrushColor = useMemo(() => {
    const imageData = isEditing ? basePixels : currentBrushTip?.imageData ?? basePixels;
    if (!imageData) return null;
    const data = imageData.data;
    let totalAlpha = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      if (alpha <= 0) continue;
      totalAlpha += alpha;
      sumR += data[i] * alpha;
      sumG += data[i + 1] * alpha;
      sumB += data[i + 2] * alpha;
    }

    if (totalAlpha === 0) {
      return null;
    }

    return {
      r: Math.round(sumR / totalAlpha),
      g: Math.round(sumG / totalAlpha),
      b: Math.round(sumB / totalAlpha)
    };
  }, [basePixels, currentBrushTip?.imageData, isEditing]);

  const baseBrushHsl = useMemo(() => {
    if (!averageBrushColor) return null;
    const [h, s, l] = rgbToHsl(averageBrushColor.r, averageBrushColor.g, averageBrushColor.b);
    return { h, s, l };
  }, [averageBrushColor]);

  const hueTrackGradient = useMemo(() => {
    if (!baseBrushHsl) return undefined;
    const lightness = clamp(baseBrushHsl.l + activeLightness, 0, 100);
    const saturation = clamp(baseBrushHsl.s * (activeSaturation / 100), 0, 100);
    const stops: string[] = [];

    for (let i = 0; i <= HUE_SLIDER_SAMPLE_COUNT; i++) {
      const t = i / HUE_SLIDER_SAMPLE_COUNT;
      const sampleHueShift = -180 + 360 * t;
      const hue = (baseBrushHsl.h + sampleHueShift + 360) % 360;
      const [r, g, b] = hslToRgb(hue, saturation, lightness);
      stops.push(`rgb(${r}, ${g}, ${b}) ${(t * 100).toFixed(2)}%`);
    }

    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, [activeLightness, activeSaturation, baseBrushHsl]);

  const lightnessTrackGradient = useMemo(() => {
    if (!baseBrushHsl) return undefined;
    const hue = (baseBrushHsl.h + activeHueShift + 360) % 360;
    const saturation = clamp(baseBrushHsl.s * (activeSaturation / 100), 0, 100);
    const stops: string[] = [];

    for (let i = 0; i <= LIGHTNESS_SLIDER_SAMPLE_COUNT; i++) {
      const t = i / LIGHTNESS_SLIDER_SAMPLE_COUNT;
      const sampleLightness = -100 + 200 * t;
      const lightness = clamp(baseBrushHsl.l + sampleLightness, 0, 100);
      const [r, g, b] = hslToRgb(hue, saturation, lightness);
      stops.push(`rgb(${r}, ${g}, ${b}) ${(t * 100).toFixed(2)}%`);
    }

    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, [activeHueShift, activeSaturation, baseBrushHsl]);

  const saturationTrackGradient = useMemo(() => {
    if (!baseBrushHsl) return undefined;
    const hue = (baseBrushHsl.h + activeHueShift + 360) % 360;
    const lightness = clamp(baseBrushHsl.l + activeLightness, 0, 100);
    const stops: string[] = [];

    for (let i = 0; i <= SATURATION_SLIDER_SAMPLE_COUNT; i++) {
      const t = i / SATURATION_SLIDER_SAMPLE_COUNT;
      const sampleSaturationPercent = SATURATION_SLIDER_MAX * t;
      const saturation = clamp(baseBrushHsl.s * (sampleSaturationPercent / 100), 0, 100);
      const [r, g, b] = hslToRgb(hue, saturation, lightness);
      stops.push(`rgb(${r}, ${g}, ${b}) ${(t * 100).toFixed(2)}%`);
    }

    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, [activeHueShift, activeLightness, baseBrushHsl]);

  const getCanvasContext = useCallback(() => {
    if (!canvasRef.current) return null;
    if (!canvasContextRef.current) {
      canvasContextRef.current = canvasRef.current.getContext('2d', { willReadFrequently: true });
    }
    return canvasContextRef.current;
  }, []);

  const scheduleAutoSave = useCallback(() => {
    if (!isEditing) return;
    if (!canvasRef.current) return;
    if (!currentOffscreenCanvas) return;
    if (!modificationPendingRef.current) return;

    if (autoSaveTimeoutRef.current !== null) {
      window.clearTimeout(autoSaveTimeoutRef.current);
    }

    const canvasToSave = canvasRef.current;
    autoSaveTimeoutRef.current = window.setTimeout(() => {
      autoSaveTimeoutRef.current = null;
      if (!canvasToSave) return;
      saveBrushEdit(canvasToSave);
      modificationPendingRef.current = false;
      const nextSelectedBrush = useAppStore.getState().tools.brushSettings.selectedCustomBrush;
      if (nextSelectedBrush && currentOffscreenCanvas) {
        requestAnimationFrame(() => {
          startBrushEdit(nextSelectedBrush, currentOffscreenCanvas);
        });
      }
    }, 200);
  }, [currentOffscreenCanvas, isEditing, saveBrushEdit, startBrushEdit]);

  useEffect(() => {
    if (isEditing) return;
    if (!hasCustomBrushTipPreview) return;

    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const width = previewWidth;
    const height = previewHeight;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    if (currentBrushTip?.imageData) {
      ctx.putImageData(currentBrushTip.imageData, 0, 0);
    }
  }, [currentBrushTip?.imageData, hasCustomBrushTipPreview, isEditing, previewHeight, previewWidth]);

  useEffect(() => () => {
    if (autoSaveTimeoutRef.current !== null) {
      window.clearTimeout(autoSaveTimeoutRef.current);
    }
  }, []);

  const getCanvasCoordinates = useCallback((clientX: number, clientY: number) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }, []);

  const getPixelColor = useCallback((imageData: ImageData, x: number, y: number) => {
    const index = (y * imageData.width + x) * 4;
    return {
      r: imageData.data[index],
      g: imageData.data[index + 1],
      b: imageData.data[index + 2],
      a: imageData.data[index + 3]
    };
  }, []);

  const hexToRgba = useCallback((hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
          a: 255
        }
      : { r: 0, g: 0, b: 0, a: 255 };
  }, []);

  const floodFillCanvas = useCallback(
    (
      imageData: ImageData,
      x: number,
      y: number,
      fillColor: { r: number; g: number; b: number; a: number },
      targetColor: { r: number; g: number; b: number; a: number }
    ) => {
      const stack = [[x, y]];
      const width = imageData.width;
      const height = imageData.height;
      const data = imageData.data;

      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;

        const index = (cy * width + cx) * 4;
        if (
          data[index] === targetColor.r &&
          data[index + 1] === targetColor.g &&
          data[index + 2] === targetColor.b &&
          data[index + 3] === targetColor.a
        ) {
          data[index] = fillColor.r;
          data[index + 1] = fillColor.g;
          data[index + 2] = fillColor.b;
          data[index + 3] = fillColor.a;

          stack.push([cx + 1, cy]);
          stack.push([cx - 1, cy]);
          stack.push([cx, cy + 1]);
          stack.push([cx, cy - 1]);
        }
      }
    },
    []
  );

  const colorsMatch = useCallback(
    (
      c1: { r: number; g: number; b: number; a: number },
      c2: { r: number; g: number; b: number; a: number }
    ) => c1.r === c2.r && c1.g === c2.g && c1.b === c2.b && c1.a === c2.a,
    []
  );

  useKeyboardScope('modal', brushEditor.status === 'EDITING');

  useEffect(() => {
    if (!currentOffscreenCanvas) return;
    if (brushShape !== BrushShape.CUSTOM) return;
    if (!selectedCustomBrush) return;

    const alreadyEditingTarget =
      brushEditor.status === 'EDITING' && brushEditor.editingBrushId === selectedCustomBrush;
    if (alreadyEditingTarget) return;

    startBrushEdit(selectedCustomBrush, currentOffscreenCanvas);
  }, [
    brushEditor.editingBrushId,
    brushEditor.status,
    brushShape,
    currentOffscreenCanvas,
    selectedCustomBrush,
    startBrushEdit
  ]);

  useEffect(() => {
    if (brushEditor.status === 'EDITING') {
      setSpacePressed(false);
      setIsPanning(false);
      setLastPanPoint(null);
      editorRef.current?.focus();
    } else {
      canvasContextRef.current = null;
    }
  }, [brushEditor.status]);

  useEffect(() => {
    if (isEditing) return;
    if (!hasCustomBrushTipPreview) return;

    const timeout = window.setTimeout(() => {
      refreshCurrentBrushTipFromSource();
    }, 60);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    brushHueShift,
    brushLightnessAdjust,
    brushSaturationAdjust,
    currentBrushTip?.brushId,
    hasCustomBrushTipPreview,
    isEditing,
    refreshCurrentBrushTipFromSource
  ]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current) return;

      const shouldPan = spacePressed || event.button === 1 || event.button === 2;
      if (shouldPan) {
        event.preventDefault();
        setIsPanning(true);
        setLastPanPoint({ x: event.clientX, y: event.clientY });
        setIsPointerActive(true);
        try {
          canvasRef.current.setPointerCapture?.(event.pointerId);
        } catch {}
        return;
      }

      if (event.button !== 0) {
        return;
      }

      const coordinates = getCanvasCoordinates(event.clientX, event.clientY);
      if (!coordinates) return;

      const ctx = getCanvasContext();
      if (!ctx) return;

      setIsPointerActive(true);
      try {
        canvasRef.current.setPointerCapture?.(event.pointerId);
      } catch {}

      const pointerPressure = event.pressure && event.pressure > 0 ? event.pressure : 1;

      if (currentTool === 'fill') {
        const currentImageData = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
        const targetColor = getPixelColor(currentImageData, Math.floor(coordinates.x), Math.floor(coordinates.y));
        const fillColor = hexToRgba(brushColor);

        if (colorsMatch(targetColor, fillColor)) return;

        floodFillCanvas(
          currentImageData,
          Math.floor(coordinates.x),
          Math.floor(coordinates.y),
          fillColor,
          targetColor
        );
        ctx.putImageData(currentImageData, 0, 0);
        modificationPendingRef.current = true;
        scheduleAutoSave();
        return;
      }

      setIsDrawing(true);
      setLastPoint({ x: coordinates.x, y: coordinates.y });

      if (currentTool === 'eraser') {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        const halfSize = brushSize / 2;
        ctx.beginPath();
        ctx.arc(coordinates.x, coordinates.y, halfSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        modificationPendingRef.current = true;
        return;
      }

      brushEngine.resetStroke();
      brushEngine.drawBrush(
        ctx,
        { x: coordinates.x, y: coordinates.y },
        { x: coordinates.x, y: coordinates.y },
        { pressure: pointerPressure }
      );
      modificationPendingRef.current = true;
    },
    [
      brushColor,
      brushEngine,
      brushSize,
      colorsMatch,
      currentTool,
      floodFillCanvas,
      getCanvasContext,
      getCanvasCoordinates,
      getPixelColor,
      hexToRgba,
      scheduleAutoSave,
      spacePressed
    ]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current) return;

      if (isPanning && lastPanPoint) {
        event.preventDefault();
        const dx = event.clientX - lastPanPoint.x;
        const dy = event.clientY - lastPanPoint.y;
        setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
        setLastPanPoint({ x: event.clientX, y: event.clientY });
        return;
      }

      if (!isDrawing || !lastPoint) return;

      const coordinates = getCanvasCoordinates(event.clientX, event.clientY);
      if (!coordinates) return;

      const ctx = getCanvasContext();
      if (!ctx) return;

      if (currentTool === 'eraser') {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(lastPoint.x, lastPoint.y);
        ctx.lineTo(coordinates.x, coordinates.y);
        ctx.stroke();
        ctx.restore();
      } else {
        const pointerPressure = event.pressure && event.pressure > 0 ? event.pressure : 1;
        brushEngine.drawBrush(ctx, lastPoint, { x: coordinates.x, y: coordinates.y }, { pressure: pointerPressure });
      }

      setLastPoint({ x: coordinates.x, y: coordinates.y });
      modificationPendingRef.current = true;
    },
    [
      brushEngine,
      brushSize,
      currentTool,
      getCanvasContext,
      getCanvasCoordinates,
      isDrawing,
      isPanning,
      lastPanPoint,
      lastPoint
    ]
  );

  const handlePointerUp = useCallback(
    (event?: React.PointerEvent<HTMLCanvasElement>) => {
      if (event && canvasRef.current) {
        if (isPanning) {
          event.preventDefault();
        }
        try {
          canvasRef.current.releasePointerCapture?.(event.pointerId);
        } catch {}
      }

      setIsDrawing(false);
      setIsPanning(false);
      setLastPoint(null);
      setLastPanPoint(null);
      setIsPointerActive(false);

      if (isEditing && modificationPendingRef.current) {
        scheduleAutoSave();
      }
    },
    [isEditing, isPanning, scheduleAutoSave]
  );

  const handleContainerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;

      if (!(event.button === 1 || event.button === 2 || spacePressed)) {
        return;
      }

      event.preventDefault();
      setIsPointerActive(true);
      setIsPanning(true);
      setLastPanPoint({ x: event.clientX, y: event.clientY });
      containerRef.current.setPointerCapture?.(event.pointerId);
    },
    [spacePressed]
  );

  const handleContainerPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isPanning || !lastPanPoint) return;

      event.preventDefault();
      const dx = event.clientX - lastPanPoint.x;
      const dy = event.clientY - lastPanPoint.y;
      setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastPanPoint({ x: event.clientX, y: event.clientY });
    },
    [isPanning, lastPanPoint]
  );

  const handleContainerPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (containerRef.current) {
        containerRef.current.releasePointerCapture?.(event.pointerId);
      }
      setIsPanning(false);
      setLastPanPoint(null);
      setIsPointerActive(false);
    },
    []
  );

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
  }, []);

  const handleHueChange = useCallback(
    (value: number[]) => {
      if (value[0] === undefined) return;
      modificationPendingRef.current = true;
      setBrushEditorHue(value[0]);
      scheduleAutoSave();
    },
    [scheduleAutoSave, setBrushEditorHue]
  );

  const handleLightnessChange = useCallback(
    (value: number[]) => {
      if (value[0] === undefined) return;
      modificationPendingRef.current = true;
      setBrushEditorLightness(value[0]);
      scheduleAutoSave();
    },
    [scheduleAutoSave, setBrushEditorLightness]
  );

  const handleSaturationChange = useCallback(
    (value: number[]) => {
      if (value[0] === undefined) return;
      modificationPendingRef.current = true;
      setBrushEditorSaturation(value[0]);
      scheduleAutoSave();
    },
    [scheduleAutoSave, setBrushEditorSaturation]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || spacePressed) {
        return;
      }

      const activeElement = document.activeElement;
      const editorElement = editorRef.current;
      const focusWithin = editorElement ? editorElement.contains(activeElement) : false;

      if (!focusWithin && !isPointerActive) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setSpacePressed(true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !spacePressed) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setSpacePressed(false);
      setIsPanning(false);
      setLastPanPoint(null);
    };

    const listenerOptions: AddEventListenerOptions = { capture: true };
    window.addEventListener('keydown', handleKeyDown, listenerOptions);
    window.addEventListener('keyup', handleKeyUp, listenerOptions);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, listenerOptions);
      window.removeEventListener('keyup', handleKeyUp, listenerOptions);
    };
  }, [isPointerActive, spacePressed]);

  useEffect(() => {
    if (brushEditor.status !== 'EDITING' || !brushEditor.editingBounds || !canvasRef.current) {
      return;
    }

    const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    canvasContextRef.current = ctx;
    modificationPendingRef.current = false;

    const bounds = brushEditor.editingBounds;
    canvasRef.current.width = bounds.width;
    canvasRef.current.height = bounds.height;
    ctx.clearRect(0, 0, bounds.width, bounds.height);

    if (brushEditor.editingBrushId && customBrushes.length > 0) {
      const existingBrush = getCustomBrushByIdUnsafe?.(brushEditor.editingBrushId ?? '') ?? null;
      if (existingBrush && existingBrush.imageData) {
        setBasePixels(existingBrush.imageData);
        ctx.putImageData(existingBrush.imageData, 0, 0);
      } else {
        const emptyData = ctx.getImageData(0, 0, bounds.width, bounds.height);
        setBasePixels(emptyData);
      }
    } else {
      const emptyData = ctx.getImageData(0, 0, bounds.width, bounds.height);
      setBasePixels(emptyData);
    }
  }, [brushEditor.status, brushEditor.editingBounds, brushEditor.editingBrushId, customBrushes, getCustomBrushByIdUnsafe]);

  useEffect(() => {
    if (!basePixels || !canvasRef.current || isDrawing) {
      return;
    }

    const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const adjustedPixels = new ImageData(
      new Uint8ClampedArray(basePixels.data),
      basePixels.width,
      basePixels.height
    );
    const data = adjustedPixels.data;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha === 0) continue;

      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      const newH = (h + brushEditor.hueShift + 360) % 360;
      const newL = Math.max(0, Math.min(100, l + brushEditor.lightness));
      const newS = Math.max(0, Math.min(100, s * (brushEditor.saturation / 100)));
      const [newR, newG, newB] = hslToRgb(newH, newS, newL);

      data[i] = newR;
      data[i + 1] = newG;
      data[i + 2] = newB;
    }

    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.putImageData(adjustedPixels, 0, 0);

    const currentBrushSettings = useAppStore.getState().tools.brushSettings;
    if (
      brushEditor.editingBrushId &&
      currentBrushSettings.brushShape === BrushShape.CUSTOM &&
      currentBrushSettings.selectedCustomBrush === brushEditor.editingBrushId
    ) {
      brushCache.clear();
      scaledBrushCache.clear();

      useAppStore.getState().updateCurrentBrushTip({
        imageData: adjustedPixels,
        brushId: brushEditor.editingBrushId,
        isColorizable: false,
        width: adjustedPixels.width,
        height: adjustedPixels.height
      });
    }
  }, [
    basePixels,
    brushEditor.editingBrushId,
    brushEditor.hueShift,
    brushEditor.lightness,
    brushEditor.saturation,
    isDrawing
  ]);

  useEffect(() => {
    if (brushEditor.status !== 'EDITING') return;

    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      const canvasElement = canvasRef.current;

      if (!container || !canvasElement) {
        setPan({ x: 0, y: 0 });
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const canvasWidth = canvasElement.width;
      const canvasHeight = canvasElement.height;

      const padding = 20;
      const availableWidth = Math.max(containerRect.width - padding * 2, 1);
      const availableHeight = Math.max(containerRect.height - padding * 2, 1);
      const scaleToFit = Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight, 1);

      const offsetX = (containerRect.width - canvasWidth * scaleToFit) / 2;
      const offsetY = (containerRect.height - canvasHeight * scaleToFit) / 2;

      setPan({ x: offsetX, y: offsetY });
      setZoom(scaleToFit);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [
    brushEditor.status,
    brushEditor.editingBrushId,
    brushEditor.editingBounds?.width,
    brushEditor.editingBounds?.height
  ]);

  useEffect(() => {
    if (brushEditor.status !== 'EDITING') return;

    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      const canvasElement = canvasRef.current;
      if (!canvasElement) return;

      if (canvasElement.width === 0 || canvasElement.height === 0) return;

      event.preventDefault();

      const rect = container.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      const scrollSensitivity = 0.001;
      const zoomFactor = 1 - event.deltaY * scrollSensitivity;

      setZoom((previousZoom) => {
        const nextZoom = Math.max(MIN_ZOOM, Math.min(previousZoom * zoomFactor, MAX_ZOOM));
        if (Math.abs(nextZoom - previousZoom) < 0.0001) {
          return previousZoom;
        }

        setPan((previousPan) => {
          const worldX = (mouseX - previousPan.x) / previousZoom;
          const worldY = (mouseY - previousPan.y) / previousZoom;
          const newPanX = mouseX - worldX * nextZoom;
          const newPanY = mouseY - worldY * nextZoom;
          return { x: newPanX, y: newPanY };
        });

        return nextZoom;
      });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [brushEditor.status]);

  return (
    <div
      ref={editorRef}
      className="inline-brush-editor bg-[#1A1A1A] px-4 py-4 focus:outline-none"
      tabIndex={0}
    >
      {isEditing ? (
        <>
          <div className="flex flex-col gap-2">
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-[#AAAAAA]">Hue Shift</label>
              <HueSlider
                value={[brushEditor.hueShift]}
                onValueChange={handleHueChange}
                trackGradient={hueTrackGradient}
                aria-label="Hue Shift"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-[#AAAAAA]">Lightness</label>
              <LightnessSlider
                value={[brushEditor.lightness]}
                onValueChange={handleLightnessChange}
                trackGradient={lightnessTrackGradient}
                aria-label="Lightness"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-[#AAAAAA]">Saturation</label>
              <SaturationSlider
                value={[brushEditor.saturation]}
                onValueChange={handleSaturationChange}
                hue={brushEditor.hueShift}
                max={SATURATION_SLIDER_MAX}
                trackGradient={saturationTrackGradient}
                aria-label="Saturation"
              />
            </div>
          </div>

          <div
            ref={containerRef}
            className="relative overflow-hidden rounded border border-[#2E2E2E] bg-[#3A3A3A]"
            style={{ height: containerHeight }}
            onPointerDown={handleContainerPointerDown}
            onPointerMove={handleContainerPointerMove}
            onPointerUp={handleContainerPointerUp}
            onPointerLeave={handleContainerPointerUp}
            onPointerCancel={handleContainerPointerUp}
            onContextMenu={handleContextMenu}
          >
            <div
            className="absolute inset-0"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              backgroundColor: '#f6f6f8',
              backgroundImage:
                'linear-gradient(45deg, #e9e9ec 25%, transparent 25%),' +
                'linear-gradient(-45deg, #e9e9ec 25%, transparent 25%),' +
                'linear-gradient(45deg, transparent 75%, #e9e9ec 75%),' +
                'linear-gradient(-45deg, transparent 75%, #e9e9ec 75%)',
              backgroundSize: '20px 20px',
              backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
              width: canvasPixelWidth ? `${canvasPixelWidth}px` : 'auto',
              height: canvasPixelHeight ? `${canvasPixelHeight}px` : 'auto'
            }}
          >
              <canvas
                ref={canvasRef}
                className="block"
                style={{
                  imageRendering: 'pixelated',
                  cursor: isPanning ? 'grabbing' : spacePressed ? 'grab' : 'crosshair'
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onContextMenu={handleContextMenu}
              />
            </div>
          </div>
        </>
      ) : hasCustomBrushTipPreview ? (
        <div
          className="relative overflow-hidden rounded border border-[#2E2E2E] bg-[#3A3A3A]"
          style={{ height: containerHeight }}
        >
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              backgroundColor: '#f6f6f8',
              backgroundImage:
                'linear-gradient(45deg, #e9e9ec 25%, transparent 25%),' +
                'linear-gradient(-45deg, #e9e9ec 25%, transparent 25%),' +
                'linear-gradient(45deg, transparent 75%, #e9e9ec 75%),' +
                'linear-gradient(-45deg, transparent 75%, #e9e9ec 75%)',
              backgroundSize: '20px 20px',
              backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
            }}
          >
            <div
              className="flex items-center justify-center"
              style={{
                padding: '20px',
                width: '100%',
                height: '100%'
              }}
            >
              <canvas
                ref={previewCanvasRef}
                className="block"
                style={{
                  imageRendering: 'pixelated',
                  maxWidth: 'calc(100% - 40px)',
                  maxHeight: 'calc(100% - 40px)',
                  width: `${previewWidth}px`,
                  height: `${previewHeight}px`
                }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-[220px] items-center justify-center rounded border border-dashed border-[#343434] bg-[#232323] text-xs uppercase tracking-wide text-[#666666]">
          Select a custom brush to edit
        </div>
      )}
    </div>
  );
};

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        break;
      case gn:
        h = ((bn - rn) / d + 2) / 6;
        break;
      default:
        h = ((rn - gn) / d + 4) / 6;
        break;
    }
  }

  return [h * 360, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = h / 360;
  const sn = s / 100;
  const ln = l / 100;

  if (sn === 0) {
    const gray = Math.round(ln * 255);
    return [gray, gray, gray];
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };

  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;

  const r = hue2rgb(p, q, hn + 1 / 3);
  const g = hue2rgb(p, q, hn);
  const b = hue2rgb(p, q, hn - 1 / 3);

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export default InlineBrushEditor;
