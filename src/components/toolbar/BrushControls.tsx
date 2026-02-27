"use client";

// Simple brush controls for proof of concept
// Based on /docs/03_Features/Drawing_Tools.md (lines 8-48)

import React from "react";
import { selectEffectiveColorCyclePlaying, useAppStore } from "@/stores/useAppStore";
import {
  selectActiveLayerId,
  selectLayers,
} from '@/stores/selectors/layersSelectors';
import {
  selectBrushSettings,
  selectCcGradientSource,
  selectCurrentTool,
  selectEraserSettings,
  selectGlobalBrushSize,
  selectShapeMode,
} from '@/stores/selectors/toolsSelectors';
import { BrushShape, type BrushSettings } from "@/types";
import CommittedNumberInput from "../ui/CommittedNumberInput";
import Input from "../ui/Input";
import CommittedProgressSlider from "../ui/CommittedProgressSlider";
import ProgressSlider from "../ui/ProgressSlider";
// Using ProgressSlider to match pixel square brush opacity style
import Dropdown from "../ui/Dropdown";
import ButtonGroup from "../ui/ButtonGroup";
import { drawTestSwatches } from "@/utils/drawTestSwatches";
import { GradientEditor } from "../ui/GradientEditor";
import { GradientPalette } from '@/lib/GradientPalette';
import CustomSwitch from "../ui/CustomSwitch";
import { isStrokeBrush, supportsDither } from "@/utils/brushCategories";
import {
  DEFAULT_GRADIENT_STOPS,
  getPresetOptions as getRectGradientPresetOptions,
  getPresetStops
} from '@/utils/gradientPresets';
import {
  buildForegroundDerivedGradientSpec,
  clampForegroundDerivedBands,
  deriveForegroundGradientStops,
  getShapeModeForBrush,
  isColorCycleBrush,
  setSharedColorCycleGradient
} from "../../utils/colorCycleGradients";
import { getPreviewGradientForActiveMark } from '@/hooks/canvas/utils/colorCycleMarkSession';
import {
  PRESSURE_BASE_PERCENT,
  clampPressureDeltaPercent,
  getDefaultMaxPressurePercent,
} from '@/utils/pressureSettings';
import {
  MIN_BRUSH_COLOR_CYCLE_SPEED,
  MAX_BRUSH_COLOR_CYCLE_SPEED,
  COLOR_CYCLE_SPEED_STEP,
} from '@/constants/colorCycle';
import ShapeFillControls from "./ShapeFillControls";
import DitherControls, { DITHER_OPTIONS, PATTERN_STYLES } from './DitherControls';
import { getPresetCapabilities, type BrushCapabilities } from '@/presets/brushPresets';

const PRESSURE_MIN_BOUND = 0;
const CONTROL_LABEL_CLASS = 'text-[#D9D9D9] w-16';
const CONTROL_LABEL_STYLE: React.CSSProperties = { fontSize: '14px' };
type SliderComponent = React.ComponentType<React.ComponentProps<typeof ProgressSlider>>;
const PREVIEW_PALETTE_SIZE = 256;

type RisoControlsProps = {
  settings: BrushSettings;
  onChange: (updates: Partial<BrushSettings>) => void;
  idSuffix: string;
  Slider: SliderComponent;
};

const RisoControls: React.FC<RisoControlsProps> = ({ settings, onChange, idSuffix, Slider }) => {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
          Riso
        </label>
        <Slider
          value={settings.risographIntensity || 0}
          min={0}
          max={100}
          step={1}
          onChange={(value) => onChange({ risographIntensity: Math.round(value) })}
          aria-label="Risograph Intensity"
          className="flex-1"
        />
      </div>

      {(settings.risographIntensity || 0) > 0 && (
        <>
          <div className="flex items-center gap-2 mt-1">
            <label className={`${CONTROL_LABEL_CLASS} text-xs`}>
              Hue Jitter
            </label>
            <Slider
              value={settings.risographColorShift ?? 3}
              min={0}
              max={10}
              step={1}
              onChange={(value) => onChange({ risographColorShift: Math.round(value) })}
              aria-label="Riso Hue Jitter"
              className="flex-1"
            />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <label
              htmlFor={`riso-outline-${idSuffix}`}
              className={`${CONTROL_LABEL_CLASS} text-xs`}
            >
              Edges
            </label>
            <CustomSwitch
              id={`riso-outline-${idSuffix}`}
              checked={settings.risographOutline || false}
              onChange={(checked) => onChange({ risographOutline: checked })}
            />
          </div>
        </>
      )}
    </div>
  );
};

type PigmentLiftControlsProps = {
  settings: BrushSettings;
  onChange: (updates: Partial<BrushSettings>) => void;
  idSuffix: string;
  Slider: SliderComponent;
};

type VelocityLinkToggleProps = {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
};

const VelocityLinkToggle: React.FC<VelocityLinkToggleProps> = ({ id, checked, onChange, title }) => (
  <div className="flex items-center gap-1 ml-1" title={title}>
    <label
      htmlFor={id}
      className="text-[#9CA3AF]"
      style={{ fontSize: '11px' }}
    >
      Vel
    </label>
    <CustomSwitch
      id={id}
      checked={checked}
      onChange={onChange}
    />
  </div>
);

const PigmentLiftControls: React.FC<PigmentLiftControlsProps> = ({ settings, onChange, idSuffix, Slider }) => {
  const strength = settings.pigmentLiftStrength ?? 0.18;
  const feather = settings.pigmentLiftFeather ?? 3;
  const noise = settings.pigmentLiftNoise ?? 0.4;

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <label
          htmlFor={`pigment-lift-${idSuffix}`}
          className={CONTROL_LABEL_CLASS}
          style={CONTROL_LABEL_STYLE}
        >
          PigLift
        </label>
        <CustomSwitch
          id={`pigment-lift-${idSuffix}`}
          checked={!!settings.pigmentLiftEnabled}
          onChange={(checked) => onChange({ pigmentLiftEnabled: checked })}
        />
      </div>

      {settings.pigmentLiftEnabled && (
        <>
          <div className="flex items-center gap-2 mt-1">
            <label className={`${CONTROL_LABEL_CLASS} text-xs`} style={CONTROL_LABEL_STYLE}>
              Strength
            </label>
            <Slider
              value={strength}
              min={0}
              max={1}
              step={0.02}
              onChange={(value) => onChange({ pigmentLiftStrength: Math.max(0, Math.min(1, value)) })}
              aria-label="Pigment Lift Strength"
              className="flex-1"
            />
          </div>

          <div className="flex items-center gap-2 mt-1">
            <label className={`${CONTROL_LABEL_CLASS} text-xs`} style={CONTROL_LABEL_STYLE}>
              Feather
            </label>
            <Slider
              value={feather}
              min={0}
              max={12}
              step={0.5}
              onChange={(value) => onChange({ pigmentLiftFeather: Math.max(0, value) })}
              aria-label="Pigment Lift Feather"
              className="flex-1"
            />
          </div>

          <div className="flex items-center gap-2 mt-1">
            <label className={`${CONTROL_LABEL_CLASS} text-xs`} style={CONTROL_LABEL_STYLE}>
              Texture
            </label>
            <Slider
              value={noise}
              min={0}
              max={1}
              step={0.02}
              onChange={(value) => onChange({ pigmentLiftNoise: Math.max(0, Math.min(1, value)) })}
              aria-label="Pigment Lift Texture"
              className="flex-1"
            />
          </div>
        </>
      )}
    </div>
  );
};

type SampledGradientPreviewProps = {
  stops: Array<{ position: number; color: string }>;
  speed: number;
  flowMode?: 'forward' | 'reverse' | 'pingpong' | 'bounce' | 'backward';
  isPaused: boolean;
};

const SampledGradientPreview: React.FC<SampledGradientPreviewProps> = ({
  stops,
  speed,
  flowMode,
  isPaused,
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const canvasCtxRef = React.useRef<CanvasRenderingContext2D | null>(null);
  const paletteRef = React.useRef<Uint8ClampedArray | null>(null);
  const stripCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const stripCtxRef = React.useRef<CanvasRenderingContext2D | null>(null);
  const stripImageRef = React.useRef<ImageData | null>(null);
  const stripDataRef = React.useRef<Uint8ClampedArray | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const t0Ref = React.useRef<number | null>(null);
  const pausePhaseRef = React.useRef<number>(0);
  const lastPhaseRef = React.useRef<number>(0);
  const isPausedRef = React.useRef<boolean>(isPaused);
  isPausedRef.current = isPaused;

  React.useEffect(() => {
    try {
      const palette = new GradientPalette(stops);
      paletteRef.current = palette.getPaletteColors();
    } catch {
      paletteRef.current = null;
    }
  }, [stops]);

  React.useEffect(() => {
    if (!stripCanvasRef.current) {
      const stripCanvas = document.createElement('canvas');
      stripCanvas.width = PREVIEW_PALETTE_SIZE;
      stripCanvas.height = 1;
      stripCanvasRef.current = stripCanvas;
      stripCtxRef.current = stripCanvas.getContext('2d', { willReadFrequently: false });
    }
    if (!stripDataRef.current) {
      stripDataRef.current = new Uint8ClampedArray(PREVIEW_PALETTE_SIZE * 4);
    }
    if (!stripImageRef.current && stripCtxRef.current) {
      stripImageRef.current = stripCtxRef.current.createImageData(PREVIEW_PALETTE_SIZE, 1);
    }
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    canvas.width = PREVIEW_PALETTE_SIZE;
    canvas.height = 24;
    canvasCtxRef.current = canvas.getContext('2d', { willReadFrequently: false });
  }, []);

  const drawFrame = React.useCallback((phase: number) => {
    const canvas = canvasRef.current;
    const ctx = canvasCtxRef.current;
    const palette = paletteRef.current;
    const stripData = stripDataRef.current;
    const stripImage = stripImageRef.current;
    const stripCtx = stripCtxRef.current;
    const stripCanvas = stripCanvasRef.current;
    if (!canvas || !ctx || !palette || !stripData || !stripImage || !stripCtx || !stripCanvas) {
      return;
    }

    const shift = (Math.floor(phase * PREVIEW_PALETTE_SIZE) & 255) * 4;
    for (let i = 0; i < PREVIEW_PALETTE_SIZE; i += 1) {
      const src = (shift + i * 4) & (PREVIEW_PALETTE_SIZE * 4 - 1);
      const dst = i * 4;
      stripData[dst] = palette[src];
      stripData[dst + 1] = palette[src + 1];
      stripData[dst + 2] = palette[src + 2];
      stripData[dst + 3] = palette[src + 3];
    }

    stripImage.data.set(stripData);
    stripCtx.putImageData(stripImage, 0, 0);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(stripCanvas, 0, 0, stripCanvas.width, stripCanvas.height, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }, []);

  React.useEffect(() => {
    const resolvedSpeed = Math.max(0, Math.min(MAX_BRUSH_COLOR_CYCLE_SPEED, Math.abs(speed)));
    const direction = flowMode === 'reverse' || flowMode === 'backward' ? -1 : 1;
    const effectiveSpeed = resolvedSpeed * direction;
    const canAnimate =
      typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';

    const stop = () => {
      if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const tick = (timestamp: number) => {
      const tSeconds = timestamp / 1000;
      if (t0Ref.current === null) {
        t0Ref.current = tSeconds;
      }
      let phase = pausePhaseRef.current;
      if (!isPausedRef.current) {
        const raw = (tSeconds - t0Ref.current) * effectiveSpeed;
        phase = ((raw % 1) + 1) % 1;
        pausePhaseRef.current = phase;
      }
      lastPhaseRef.current = phase;
      drawFrame(phase);
      rafRef.current = requestAnimationFrame(tick);
    };

    stop();
    if (resolvedSpeed > 0 && !isPaused && canAnimate) {
      const nowSeconds = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      if (effectiveSpeed !== 0) {
        t0Ref.current = nowSeconds - pausePhaseRef.current / effectiveSpeed;
      } else {
        t0Ref.current = nowSeconds;
      }
      rafRef.current = requestAnimationFrame(tick);
      return () => stop();
    }

    drawFrame(lastPhaseRef.current);
    return () => stop();
  }, [drawFrame, flowMode, isPaused, speed]);

  return (
    <canvas
      ref={canvasRef}
      className="h-6 w-full rounded border border-white/10"
      style={{ imageRendering: 'pixelated' }}
    />
  );
};

const BrushControls = () => {
  // Use individual selectors to avoid unstable object references
  const setBrushSettings = useAppStore(state => state.setBrushSettings);
  const setEraserSettings = useAppStore(state => state.setEraserSettings);
  const setGlobalBrushSize = useAppStore(state => state.setGlobalBrushSize);
  const setCustomBrushSizePercent = useAppStore(state => state.setCustomBrushSizePercent);
  const setCcGradientSource = useAppStore(state => state.setCcGradientSource);
  const updateLayer = useAppStore(state => state.updateLayer);
  const currentBrushPresetId = useAppStore(state => state.currentBrushPreset?.id ?? null);
  const isColorCycleGradientPreset = currentBrushPresetId === 'color-cycle-gradient';
  const brushSettings = useAppStore(selectBrushSettings);
  const eraserSettings = useAppStore(selectEraserSettings);
  const currentTool = useAppStore(selectCurrentTool);
  const globalBrushSize = useAppStore(selectGlobalBrushSize);
  const ccGradientSource = useAppStore(selectCcGradientSource);
  const ccGradientSampleCount = useAppStore((state) => state.ccGradientSampleCount);
  const resetCcGradientSample = useAppStore((state) => state.resetCcGradientSample);
  const palette = useAppStore((state) => state.palette);
  const temporaryCustomBrush = useAppStore((state) => state.temporaryCustomBrush);
  const getCustomBrushByIdUnsafe = useAppStore((state) => state.getCustomBrushByIdUnsafe);
  const customBrushPercent = brushSettings.customBrushSizePercent ?? 100;
  const shapeMode = useAppStore(selectShapeMode);
  const setShapeMode = useAppStore(state => state.setShapeMode);
  const setBrushPreset = useAppStore(state => state.setBrushPreset);
  const brushPresets = useAppStore((state) => state.brushPresets);
  const isDitherPreset =
    currentBrushPresetId === 'dither-stroke' ||
    currentBrushPresetId === 'dither-shape';
  const isDitherStrokePreset = currentBrushPresetId === 'dither-stroke';
  const isDitherShapePreset = currentBrushPresetId === 'dither-shape';
  const isMosaicPreset = currentBrushPresetId === 'mosaic';
  // For per-layer CC brush speed
  const activeLayerId = useAppStore(selectActiveLayerId);
  const layers = useAppStore(selectLayers);
  const addNotification = useAppStore((state) => state.addNotification);
  const desiredColorCyclePlaying = useAppStore(state => state.colorCyclePlayback.desiredPlaying);
  const effectiveColorCyclePlaying = useAppStore(selectEffectiveColorCyclePlaying);
  const playColorCycle = useAppStore(state => state.playColorCycle);
  const pauseColorCycle = useAppStore(state => state.pauseColorCycle);
  const colorCycleRuntimeHandlers = useAppStore(state => state.colorCycleRuntimeHandlers);
  const activeLayer = React.useMemo(
    () => layers.find((layer) => layer.id === activeLayerId) ?? null,
    [layers, activeLayerId]
  );
  
  const showColorCycleLayerHint = React.useCallback(() => {
    if (typeof addNotification !== 'function') {
      return;
    }

    addNotification({
      type: 'info',
      title: 'Select a color cycle layer',
      message: 'Custom brush color cycling only works on color cycle layers. Pick one in the Layers panel first.',
      timestamp: new Date()
    });
  }, [addNotification]);

  // Determine if current brush is custom (uses percentage) or default (uses pixels)
  const activeSettings =
    currentTool === 'eraser' ? eraserSettings : brushSettings;
  const isActiveCustomBrush = activeSettings.brushShape === BrushShape.CUSTOM;
  const selectedCustomBrushId = activeSettings.selectedCustomBrush;
  const activeCustomBrushColorCycle = React.useMemo(() => {
    if (!isActiveCustomBrush || !selectedCustomBrushId) {
      return activeSettings.currentBrushTip?.colorCycle;
    }
    if (activeSettings.currentBrushTip?.brushId === selectedCustomBrushId) {
      return activeSettings.currentBrushTip.colorCycle;
    }
    if (temporaryCustomBrush?.id === selectedCustomBrushId) {
      return temporaryCustomBrush.colorCycle;
    }
    return typeof getCustomBrushByIdUnsafe === 'function'
      ? getCustomBrushByIdUnsafe(selectedCustomBrushId)?.colorCycle
      : activeSettings.currentBrushTip?.colorCycle;
  }, [
    activeSettings.currentBrushTip,
    getCustomBrushByIdUnsafe,
    isActiveCustomBrush,
    selectedCustomBrushId,
    temporaryCustomBrush
  ]);
  const hasCapturedColorCyclePayload = Boolean(
    activeCustomBrushColorCycle?.schemaVersion === 2 &&
    activeCustomBrushColorCycle.mode === 'captured-data' &&
    activeCustomBrushColorCycle.mapWidth > 0 &&
    activeCustomBrushColorCycle.mapHeight > 0 &&
    (activeCustomBrushColorCycle.phaseMap || activeCustomBrushColorCycle.indexMap)
  );
  const customColorCycleMode = activeSettings.customBrushColorCycleMode ?? 'tip';
  const sizeUnit = isActiveCustomBrush ? '%' : 'px';
  const sizeLabel = isActiveCustomBrush ? 'Tip Scale %' : `Size ${sizeUnit}`;
  const hideShapeToggle = (isDitherStrokePreset || isDitherShapePreset) && !isActiveCustomBrush;
  const capability: BrushCapabilities = currentBrushPresetId
    ? getPresetCapabilities(
        currentBrushPresetId,
        (useAppStore.getState().currentBrushPreset as { capabilities?: BrushCapabilities } | null) || undefined
      )
    : {};
  const canDitherForShape = (shape?: BrushShape) =>
    isActiveCustomBrush
      ? false
      : capability.canDither !== undefined
        ? capability.canDither
        : supportsDither(shape ?? BrushShape.ROUND);

  const NonCcSlider = isColorCycleBrush(activeSettings.brushShape)
    ? ProgressSlider
    : CommittedProgressSlider;

  // Use the appropriate settings and setter based on current tool
  const setActiveSettings =
    currentTool === 'eraser' ? setEraserSettings : setBrushSettings;

  const useCommittedSliderValue = (
    value: number,
    onCommitValue: (next: number) => void
  ) => {
    const [localValue, setLocalValue] = React.useState(value);
    const isEditingRef = React.useRef(false);
    const latestRef = React.useRef(value);

    React.useEffect(() => {
      latestRef.current = localValue;
    }, [localValue]);

    React.useEffect(() => {
      if (!isEditingRef.current) {
        setLocalValue(value);
      }
    }, [value]);

    const handleChange = React.useCallback((next: number) => {
      isEditingRef.current = true;
      setLocalValue(next);
    }, []);

    const handleCommit = React.useCallback(() => {
      const next = latestRef.current;
      if (isEditingRef.current) {
        isEditingRef.current = false;
        if (next !== value) {
          onCommitValue(next);
        }
      }
    }, [onCommitValue, value]);

    return { value: localValue, onChange: handleChange, onCommit: handleCommit };
  };

  // Shared dither gradient palette helpers (kept outside branches to preserve hook order)
  const clampStopCount = React.useCallback((count: number) => Math.min(6, Math.max(2, Math.round(count))), []);
  const normalizeHex = React.useCallback((hex: string): string => {
    const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
    return match ? `#${match[1].toUpperCase()}` : hex.trim().toUpperCase();
  }, []);
  const toRgb = React.useCallback((hex: string): [number, number, number] => {
    const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
    if (!match) {
      return [255, 255, 255];
    }
    const val = match[1];
    return [
      parseInt(val.slice(0, 2), 16),
      parseInt(val.slice(2, 4), 16),
      parseInt(val.slice(4, 6), 16)
    ];
  }, []);
  const toHex = React.useCallback((rgb: [number, number, number]) =>
    `#${rgb[0].toString(16).padStart(2, '0')}${rgb[1].toString(16).padStart(2, '0')}${rgb[2]
      .toString(16)
      .padStart(2, '0')}`.toUpperCase(), []);
  const lerp = React.useCallback((a: number, b: number, t: number) => a + (b - a) * t, []);
  const lerpHex = React.useCallback(
    (aHex: string, bHex: string, t: number) => {
      const a = toRgb(aHex);
      const b = toRgb(bHex);
      return toHex([
        Math.round(lerp(a[0], b[0], t)),
        Math.round(lerp(a[1], b[1], t)),
        Math.round(lerp(a[2], b[2], t))
      ]);
    },
    [lerp, toHex, toRgb]
  );
  const areStopsEqual = React.useCallback(
    (a?: string[], b?: string[]) => {
      if (!a || !b) return false;
      if (a.length !== b.length) return false;
      return a.every((stop, idx) => normalizeHex(stop) === normalizeHex(b[idx] ?? ''));
    },
    [normalizeHex]
  );
  const areStopsLinear = React.useCallback(
    (stops?: string[]) => {
      if (!stops || stops.length < 2) return false;
      const first = stops[0];
      const last = stops[stops.length - 1];
      for (let i = 0; i < stops.length; i += 1) {
        const t = stops.length === 1 ? 0 : i / (stops.length - 1);
        const expected = lerpHex(first, last, t);
        if (normalizeHex(stops[i]) !== normalizeHex(expected)) {
          return false;
        }
      }
      return true;
    },
    [lerpHex, normalizeHex]
  );

  const fgColor = React.useMemo(
    () => palette?.foregroundColor ?? activeSettings.color ?? '#000000',
    [palette?.foregroundColor, activeSettings.color]
  );
  const bgColor = React.useMemo(
    () => palette?.backgroundColor ?? '#ffffff',
    [palette?.backgroundColor]
  );

  const resolvedGradientSource = ccGradientSource ?? 'manual';
  const useForegroundDerivedGradient = resolvedGradientSource === 'fg';
  const isGradientSampleMode = resolvedGradientSource === 'sampled';
  const gradientModeValue = resolvedGradientSource === 'sampled'
    ? 'sample'
    : resolvedGradientSource === 'fg'
      ? 'fg'
      : 'manual';
  const colorCycleFillModeValue =
    activeSettings.colorCycleFillMode === 'linear' ? 'linear' : 'concentric';
  const ccGradientSamplePerShapeEnabled = Boolean(activeSettings.ccGradientSamplePerShape);
  const fgDerivedLightness = activeSettings.colorCycleFgLightness ?? 50;
  const fgDerivedHueShift = activeSettings.colorCycleFgHueShift ?? 0;
  const fgDerivedSaturationShift = activeSettings.colorCycleFgSaturationShift ?? 0;
  const fgDerivedOpacity = activeSettings.colorCycleFgOpacity ?? 100;
  const effectiveGlobalBrushSize = globalBrushSize ?? activeSettings.size ?? 1;

  const sizeSlider = useCommittedSliderValue(effectiveGlobalBrushSize, (nextRaw) => {
    const next = Math.min(500, Math.max(1, Math.round(nextRaw)));
    setGlobalBrushSize(next);
    if (currentTool === 'eraser') {
      setEraserSettings({ size: next });
    }
  });

  const spacingSlider = useCommittedSliderValue(activeSettings.spacing ?? 1, (nextRaw) => {
    const next = Math.max(1, Math.round(nextRaw));
    setActiveSettings({ spacing: next });
  });

  const clampFgLightness = React.useCallback(
    (next: number) => Math.max(0, Math.min(100, Math.round(next))),
    []
  );
  const clampFgHueShift = React.useCallback(
    (next: number) => Math.max(-320, Math.min(320, Math.round(next))),
    []
  );
  const clampFgSatShift = React.useCallback(
    (next: number) => Math.max(-45, Math.min(45, Math.round(next))),
    []
  );

  const fgOpacitySlider = useCommittedSliderValue(fgDerivedOpacity, (nextRaw) => {
    const next = Math.max(0, Math.min(100, Math.round(nextRaw)));
    setActiveSettings({ colorCycleFgOpacity: next });
  });

  const fgStopsSlider = useCommittedSliderValue(activeSettings.colorCycleFgStops ?? 2, (nextRaw) => {
    const next = Math.max(2, Math.min(6, Math.round(nextRaw)));
    setActiveSettings({ colorCycleFgStops: next });
  });

  const setColorCycleSpeed = React.useCallback((nextRaw: number) => {
    const next = Math.max(
      MIN_BRUSH_COLOR_CYCLE_SPEED,
      Math.min(MAX_BRUSH_COLOR_CYCLE_SPEED, Number(nextRaw))
    );
    setActiveSettings({ colorCycleSpeed: next });
    if (activeLayer?.layerType === 'color-cycle' && activeLayerId) {
      updateLayer(activeLayerId, {
        colorCycleData: { brushSpeed: next, controllerSpeedCps: next },
      });
    }
  }, [activeLayer?.layerType, activeLayerId, setActiveSettings, updateLayer]);

  const speedSlider = useCommittedSliderValue(
    activeSettings.colorCycleSpeed ?? MIN_BRUSH_COLOR_CYCLE_SPEED,
    setColorCycleSpeed
  );
  const bandsSlider = useCommittedSliderValue(activeSettings.gradientBands ?? 12, (nextRaw) => {
    const next = Math.max(2, Math.min(128, Math.round(nextRaw)));
    setActiveSettings({ gradientBands: next });
  });

  const lostEdgeSlider = useCommittedSliderValue(activeSettings.lostEdge ?? 0, (nextRaw) => {
    const next = Math.max(0, Math.min(100, Math.round(nextRaw)));
    setActiveSettings({ lostEdge: next });
  });
  const fgDerivedBands = clampForegroundDerivedBands(activeSettings.colorCycleFgStops);
  const foregroundDerivedSpec = React.useMemo(
    () =>
      buildForegroundDerivedGradientSpec({
        baseColor: fgColor,
        lightness: fgDerivedLightness,
        hueShift: fgDerivedHueShift,
        saturationShift: fgDerivedSaturationShift,
        opacity: fgDerivedOpacity,
        bands: fgDerivedBands,
      }),
    [fgColor, fgDerivedBands, fgDerivedLightness, fgDerivedHueShift, fgDerivedSaturationShift, fgDerivedOpacity]
  );
  const foregroundDerivedStops = React.useMemo(
    () => deriveForegroundGradientStops(foregroundDerivedSpec),
    [foregroundDerivedSpec]
  );
  const foregroundDerivedCss = React.useMemo(() => {
    if (!foregroundDerivedStops.length) {
      return 'none';
    }
    return `linear-gradient(to right, ${foregroundDerivedStops
      .map((stop) => `${stop.color} ${Math.round(stop.position * 100)}%`)
      .join(', ')})`;
  }, [foregroundDerivedStops]);

  const isCustomColorCycleEnabled = isActiveCustomBrush && !!activeSettings.customBrushColorCycle;
  const isCapturedDataMode = isCustomColorCycleEnabled && customColorCycleMode === 'captured-data';
  React.useEffect(() => {
    if (!isCustomColorCycleEnabled) {
      return;
    }
    if (customColorCycleMode === 'captured-data' && !hasCapturedColorCyclePayload) {
      setActiveSettings({ customBrushColorCycleMode: 'tip' });
    }
  }, [
    customColorCycleMode,
    hasCapturedColorCyclePayload,
    isCustomColorCycleEnabled,
    setActiveSettings,
  ]);
  const showColorCycleBands =
    !isColorCycleGradientPreset &&
    (isColorCycleBrush(activeSettings.brushShape as BrushShape | undefined) || isCustomColorCycleEnabled);
  const isRegularBrush =
    currentTool === 'brush' &&
    !isColorCycleBrush(activeSettings.brushShape as BrushShape | undefined) &&
    activeSettings.brushShape !== BrushShape.RESAMPLER;
  const isShapeFillBrush = brushSettings.brushShape === BrushShape.SHAPE_FILL;
  const isDitherGradient = brushSettings.brushShape === BrushShape.DITHER_GRADIENT;
  const isDitherGradSampling = Boolean(activeSettings.ditherGradSampleEnabled);

  const currentStops = React.useMemo(() => {
    const stored = activeSettings.ditherGradStops;
    if (Array.isArray(stored) && stored.length >= 2) {
      return stored.slice(0, 6);
    }
    return [fgColor, bgColor];
  }, [activeSettings.ditherGradStops, fgColor, bgColor]);

  const ditherGradAutoRef = React.useRef<boolean | null>(null);
  const ditherGradAutoStopsRef = React.useRef<string[] | null>(null);

  const buildAutoStops = React.useCallback(
    (count: number): string[] => {
      const clamped = clampStopCount(count);
      if (clamped <= 2) {
        return [fgColor, bgColor];
      }
      const result: string[] = [];
      for (let i = 0; i < clamped; i += 1) {
        const t = clamped === 1 ? 0 : i / (clamped - 1);
        result.push(lerpHex(fgColor, bgColor, t));
      }
      return result;
    },
    [bgColor, clampStopCount, fgColor, lerpHex]
  );

  React.useEffect(() => {
    if (brushSettings.brushShape !== BrushShape.DITHER_GRADIENT) return;
    if (activeSettings.ditherGradSampleEnabled) {
      if (ditherGradAutoRef.current !== false) {
        ditherGradAutoRef.current = false;
        ditherGradAutoStopsRef.current = null;
      }
      return;
    }
    if (ditherGradAutoRef.current !== null) return;
    const stored = activeSettings.ditherGradStops;
    if (!stored || stored.length < 2) {
      ditherGradAutoRef.current = true;
      return;
    }
    const autoStops = buildAutoStops(stored.length);
    const isAuto = areStopsEqual(stored, autoStops) || areStopsLinear(stored);
    ditherGradAutoRef.current = isAuto;
    if (ditherGradAutoRef.current) {
      ditherGradAutoStopsRef.current = stored;
    }
  }, [
    activeSettings.ditherGradStops,
    activeSettings.ditherGradSampleEnabled,
    areStopsEqual,
    areStopsLinear,
    brushSettings.brushShape,
    buildAutoStops
  ]);

  React.useEffect(() => {
    if (brushSettings.brushShape !== BrushShape.DITHER_GRADIENT) return;
    if (activeSettings.ditherGradSampleEnabled) return;
    if (!ditherGradAutoRef.current) return;
    const targetCount = clampStopCount(activeSettings.ditherGradStops?.length ?? 2);
    const nextStops = buildAutoStops(targetCount);
    if (!areStopsEqual(activeSettings.ditherGradStops ?? [], nextStops)) {
      ditherGradAutoStopsRef.current = nextStops;
      setActiveSettings({ ditherGradStops: nextStops });
    }
  }, [
    activeSettings.ditherGradStops,
    areStopsEqual,
    brushSettings.brushShape,
    buildAutoStops,
    clampStopCount,
    setActiveSettings,
    activeSettings.ditherGradSampleEnabled
  ]);

  const resizeStops = React.useCallback(
    (count: number): string[] => {
      const clamped = clampStopCount(count);
      const base = currentStops.length >= 2 ? currentStops : [fgColor, bgColor];
      if (clamped === base.length) return base;

      const result: string[] = [];
      for (let i = 0; i < clamped; i += 1) {
        const t = clamped === 1 ? 0 : i / (clamped - 1);
        const samplePos = (base.length - 1) * t;
        const idx = Math.floor(samplePos);
        const nextIdx = Math.min(base.length - 1, idx + 1);
        const localT = samplePos - idx;
        result.push(localT <= 0 ? base[idx] : lerpHex(base[idx], base[nextIdx], localT));
      }
      return result;
    },
    [bgColor, clampStopCount, currentStops, fgColor, lerpHex]
  );

  const handleStopCountChange = React.useCallback(
    (value: number) => {
      const useAuto = ditherGradAutoRef.current !== false;
      const resized = useAuto ? buildAutoStops(value) : resizeStops(value);
      const nextMaxTransparent = Math.max(0, Math.min(6, resized.length - 1));
      const currentTrans = activeSettings.trans;
      if (typeof currentTrans === 'number' && Number.isFinite(currentTrans)) {
        const nextTrans = Math.max(0, Math.min(nextMaxTransparent, Math.round(currentTrans)));
        if (nextTrans !== currentTrans) {
          setActiveSettings({ ditherGradStops: resized, trans: nextTrans });
          if (useAuto) {
            ditherGradAutoRef.current = true;
            ditherGradAutoStopsRef.current = resized;
          }
          return;
        }
      }
      setActiveSettings({ ditherGradStops: resized });
      if (useAuto) {
        ditherGradAutoRef.current = true;
        ditherGradAutoStopsRef.current = resized;
      }
    },
    [activeSettings.trans, buildAutoStops, resizeStops, setActiveSettings]
  );

  const handleStopColorChange = React.useCallback(
    (index: number, nextHex: string) => {
      const clampedHex = /^#([0-9a-fA-F]{6})$/.test(nextHex.trim())
        ? nextHex.trim()
        : currentStops[index] ?? fgColor;
      const updated = currentStops.map((c, i) => (i === index ? clampedHex : c));
      ditherGradAutoRef.current = false;
      setActiveSettings({ ditherGradStops: updated });
    },
    [currentStops, fgColor, setActiveSettings]
  );

  const [pressureDraft, setPressureDraft] = React.useState(() => ({
    min: (activeSettings.minPressure ?? PRESSURE_MIN_BOUND).toString(),
    max: (
      activeSettings.maxPressure ?? getDefaultMaxPressurePercent(activeSettings.brushShape)
    ).toString(),
  }));
  const [pressureEditing, setPressureEditing] = React.useState<{ min: boolean; max: boolean }>({
    min: false,
    max: false,
  });

  React.useEffect(() => {
    if (
      currentTool === 'brush' &&
      capability.forceDither &&
      brushSettings.ditherEnabled !== true
    ) {
      setBrushSettings({ ditherEnabled: true });
    }
  }, [currentTool, capability.forceDither, brushSettings.ditherEnabled, setBrushSettings]);

  const updatePressureEditing = React.useCallback((key: 'min' | 'max', value: boolean) => {
    setPressureEditing((prev) => {
      if (prev[key] === value) {
        return prev;
      }
      return { ...prev, [key]: value };
    });
  }, []);

  React.useEffect(() => {
    if (pressureEditing.min) {
      return;
    }
    const nextMin = (activeSettings.minPressure ?? PRESSURE_MIN_BOUND).toString();
    setPressureDraft((draft) => (draft.min === nextMin ? draft : { ...draft, min: nextMin }));
  }, [activeSettings.minPressure, pressureEditing.min]);

  React.useEffect(() => {
    if (pressureEditing.max) {
      return;
    }
    const nextMax = (
      activeSettings.maxPressure ?? getDefaultMaxPressurePercent(activeSettings.brushShape)
    ).toString();
    setPressureDraft((draft) => (draft.max === nextMax ? draft : { ...draft, max: nextMax }));
  }, [activeSettings.maxPressure, activeSettings.brushShape, pressureEditing.max]);

  React.useEffect(() => {
    if (activeSettings.pressureEnabled) {
      return;
    }
    setPressureEditing((prev) =>
      prev.min === false && prev.max === false ? prev : { min: false, max: false }
    );
    const nextMin = (activeSettings.minPressure ?? PRESSURE_MIN_BOUND).toString();
    const nextMax = (
      activeSettings.maxPressure ?? getDefaultMaxPressurePercent(activeSettings.brushShape)
    ).toString();
    setPressureDraft((draft) =>
      draft.min === nextMin && draft.max === nextMax ? draft : { min: nextMin, max: nextMax }
    );
  }, [
    activeSettings.pressureEnabled,
    activeSettings.minPressure,
    activeSettings.maxPressure,
    activeSettings.brushShape,
  ]);

  const handleMinChange = React.useCallback(
    (raw: string) => {
      if (raw === '') {
        setPressureDraft((draft) => (draft.min === '' ? draft : { ...draft, min: '' }));
        return;
      }
      const parsed = Number.parseInt(raw, 10);
      if (Number.isNaN(parsed)) {
        return;
      }
      const clamped = clampPressureDeltaPercent(parsed);
      setActiveSettings({ minPressure: clamped });
      setPressureDraft((draft) => {
        const minString = clamped.toString();
        if (draft.min === minString) {
          return draft;
        }
        return { ...draft, min: minString };
      });
    },
    [setActiveSettings]
  );

  const handleMinFocus = React.useCallback(() => {
    updatePressureEditing('min', true);
  }, [updatePressureEditing]);

  const handleMinBlur = React.useCallback(() => {
    updatePressureEditing('min', false);
    if (pressureDraft.min === '') {
      const fallback = clampPressureDeltaPercent(activeSettings.minPressure ?? PRESSURE_MIN_BOUND);
      setActiveSettings({ minPressure: fallback });
      setPressureDraft((draft) => {
        const minString = fallback.toString();
        if (draft.min === minString) {
          return draft;
        }
        return { ...draft, min: minString };
      });
      return;
    }
    handleMinChange(pressureDraft.min);
  }, [
    pressureDraft.min,
    activeSettings.minPressure,
    updatePressureEditing,
    handleMinChange,
    setActiveSettings,
  ]);

  const handleMaxChange = React.useCallback(
    (raw: string) => {
      if (raw === '') {
        setPressureDraft((draft) => (draft.max === '' ? draft : { ...draft, max: '' }));
        return;
      }
      const parsed = Number.parseInt(raw, 10);
      if (Number.isNaN(parsed)) {
        return;
      }
      const clamped = clampPressureDeltaPercent(parsed);
      const nextString = clamped.toString();
      setActiveSettings({ maxPressure: clamped });
      setPressureDraft((draft) => (draft.max === nextString ? draft : { ...draft, max: nextString }));
    },
    [setActiveSettings]
  );

  const handleMaxFocus = React.useCallback(() => {
    updatePressureEditing('max', true);
  }, [updatePressureEditing]);

  const handleMaxBlur = React.useCallback(() => {
    updatePressureEditing('max', false);
    if (pressureDraft.max === '') {
      setActiveSettings({ maxPressure: undefined });
      const fallbackOver = Math.max(
        0,
        getDefaultMaxPressurePercent(activeSettings.brushShape) - PRESSURE_BASE_PERCENT
      ).toString();
      const fallback = fallbackOver;
      setPressureDraft((draft) => (draft.max === fallback ? draft : { ...draft, max: fallback }));
      return;
    }
    handleMaxChange(pressureDraft.max);
  }, [
    pressureDraft.max,
    activeSettings.brushShape,
    updatePressureEditing,
    handleMaxChange,
    setActiveSettings,
  ]);

  React.useEffect(() => {
    // Only auto-enable shapeMode for SHAPE_FILL when the current tool is 'brush'
    // This prevents shape mode from being enabled when using other tools
    if (isShapeFillBrush && !shapeMode && currentTool === 'brush') {
      setShapeMode(true);
    }
  }, [isShapeFillBrush, shapeMode, setShapeMode, currentTool]);

  const gradientDebounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const gradientFrameRef = React.useRef<number | null>(null);
  const gradientForkRef = React.useRef(false);
  const gradientDirtyRef = React.useRef(false);
  const pendingGradientRef = React.useRef<Array<{ position: number; color: string }>>(
    brushSettings.colorCycleGradient
      ? brushSettings.colorCycleGradient.map(stop => ({ ...stop }))
      : DEFAULT_GRADIENT_STOPS.map(stop => ({ ...stop }))
  );

  const flushPendingGradient = React.useCallback(() => {
    const stops = pendingGradientRef.current;
    const clonedStops = stops.map(stop => ({ ...stop }));
    setActiveSettings({ colorCycleGradient: clonedStops });
    setSharedColorCycleGradient(clonedStops, { fork: gradientForkRef.current });
    gradientForkRef.current = false;

    colorCycleRuntimeHandlers?.updateGradient?.(clonedStops);
    pendingGradientRef.current = clonedStops;
    gradientDirtyRef.current = false;
  }, [setActiveSettings, colorCycleRuntimeHandlers]);

  const scheduleFlushFrame = React.useCallback(() => {
    if (gradientFrameRef.current !== null) {
      cancelAnimationFrame(gradientFrameRef.current);
      gradientFrameRef.current = null;
    }

    gradientFrameRef.current = requestAnimationFrame(() => {
      gradientFrameRef.current = null;
      flushPendingGradient();
    });
  }, [flushPendingGradient]);

  const scheduleGradientFlush = React.useCallback(
    (stops: Array<{ position: number; color: string }>, immediate = false) => {
      pendingGradientRef.current = stops.map(stop => ({ ...stop }));
      gradientDirtyRef.current = true;
      if (gradientDebounceTimerRef.current) {
        clearTimeout(gradientDebounceTimerRef.current);
        gradientDebounceTimerRef.current = null;
      }

      if (immediate) {
        scheduleFlushFrame();
        return;
      }

      gradientDebounceTimerRef.current = setTimeout(() => {
        gradientDebounceTimerRef.current = null;
        scheduleFlushFrame();
      }, 80);
    },
    [scheduleFlushFrame]
  );

  React.useEffect(() => {
    return () => {
      if (gradientDebounceTimerRef.current) {
        clearTimeout(gradientDebounceTimerRef.current);
        gradientDebounceTimerRef.current = null;
      }
      if (gradientFrameRef.current !== null) {
        cancelAnimationFrame(gradientFrameRef.current);
        gradientFrameRef.current = null;
      }
      if (gradientDirtyRef.current) {
        flushPendingGradient();
      }
    };
  }, [flushPendingGradient]);

  React.useEffect(() => {
    const currentStops = activeSettings.colorCycleGradient || DEFAULT_GRADIENT_STOPS;
    pendingGradientRef.current = currentStops.map(stop => ({ ...stop }));
    gradientDirtyRef.current = false;
  }, [activeSettings.colorCycleGradient]);

  const handleToggleCustomColorCycle = React.useCallback((checked: boolean) => {
    if (
      checked &&
      activeLayer?.layerType !== 'color-cycle' &&
      !(hasCapturedColorCyclePayload && customColorCycleMode === 'captured-data')
    ) {
      showColorCycleLayerHint();
      setActiveSettings({ customBrushColorCycle: false });
      return;
    }

    const updates: Partial<typeof activeSettings> = {
      customBrushColorCycle: checked
    };

    if (checked) {
      updates.customBrushColorCycleMode =
        hasCapturedColorCyclePayload && activeCustomBrushColorCycle?.schemaVersion === 2
          ? (activeCustomBrushColorCycle.mode ?? 'captured-data')
          : 'tip';
      updates.customBrushUseCapturedAlphaMask =
        activeCustomBrushColorCycle?.schemaVersion === 2
          ? activeCustomBrushColorCycle.useAlphaMask !== false
          : true;
      if (!activeSettings.colorCycleGradient || activeSettings.colorCycleGradient.length === 0) {
        updates.colorCycleGradient = DEFAULT_GRADIENT_STOPS.map(stop => ({ ...stop }));
      }
      if (activeSettings.colorCycleSpeed === undefined || activeSettings.colorCycleSpeed === null) {
        updates.colorCycleSpeed = 0.1;
      }
      if (!activeSettings.customBrushCcPhaseMode) {
        updates.customBrushCcPhaseMode = 'global';
      }
      if (activeSettings.customBrushCcPhaseJitter === undefined || activeSettings.customBrushCcPhaseJitter === null) {
        updates.customBrushCcPhaseJitter = 0;
      }
    }

    setActiveSettings(updates);
  }, [
    activeLayer,
    activeSettings.colorCycleGradient,
    activeSettings.colorCycleSpeed,
    activeSettings.customBrushCcPhaseJitter,
    activeSettings.customBrushCcPhaseMode,
    activeCustomBrushColorCycle,
    customColorCycleMode,
    hasCapturedColorCyclePayload,
    setActiveSettings,
    showColorCycleLayerHint,
  ]);

  // Ensure Color Cycle brushes start with a sensible spacing value even when no preset overrides exist
  React.useEffect(() => {
    const shape = activeSettings.brushShape;
    if (
      shape !== BrushShape.COLOR_CYCLE &&
      shape !== BrushShape.COLOR_CYCLE_TRIANGLE &&
      shape !== BrushShape.COLOR_CYCLE_SHAPE
    ) {
      return;
    }

    const currentSpacing = activeSettings.spacing;
    if (currentSpacing && currentSpacing >= 1) {
      return;
    }

    const fallbackSpacing = shape === BrushShape.COLOR_CYCLE_SHAPE ? 4 : 2;
    setActiveSettings({ spacing: fallbackSpacing });
  }, [activeSettings.brushShape, activeSettings.spacing, setActiveSettings]);
  
  // Handle animation when switching brush types
  const previousBrushShape = React.useRef(activeSettings.brushShape);
  
  React.useEffect(() => {
    const previousShape = previousBrushShape.current;
    const wasColorCycle = isColorCycleBrush(previousShape);
    const isCurrentColorCycle = isColorCycleBrush(activeSettings.brushShape);

    if (!wasColorCycle && isCurrentColorCycle) {
      if (desiredColorCyclePlaying) {
        playColorCycle('toolbar');
      }
    } else if (wasColorCycle && !isCurrentColorCycle) {
      if (desiredColorCyclePlaying) {
        pauseColorCycle('toolbar');
      }
      // Reset Color Cycle speed to default when leaving CC mode
      setActiveSettings({ colorCycleSpeed: 0.1 });
    }

    if (isCurrentColorCycle) {
      const forcedShapeMode = getShapeModeForBrush(activeSettings.brushShape);
      if (forcedShapeMode !== undefined && shapeMode !== forcedShapeMode) {
        setShapeMode(forcedShapeMode);
      }
    }

    previousBrushShape.current = activeSettings.brushShape;
  }, [
    activeSettings.brushShape,
    desiredColorCyclePlaying,
    pauseColorCycle,
    playColorCycle,
    setActiveSettings,
    shapeMode,
    setShapeMode
  ]);


  // Show special controls for Color Cycle brushes (both stroke and shape variants)
  if (isColorCycleBrush(activeSettings.brushShape)) {
    if (typeof window !== 'undefined') {
      const logCC =
        process.env.NODE_ENV !== 'production' &&
        (() => {
          try {
            return Boolean((globalThis as { __TB_DEBUG?: { logCC?: boolean } }).__TB_DEBUG?.logCC);
          } catch {
            return false;
          }
        })();
      if (logCC) {
        console.log('[BrushControls] ColorCycle branch', activeSettings.brushShape);
      }
    }
    return (
      <div className="p-4">
        {currentBrushPresetId !== 'color-cycle-gradient' && (
          <div className="mb-3">
            <ButtonGroup
              options={[
                { label: 'Square', value: 'square' },
                { label: 'Round', value: 'round' },
                { label: 'Diamond', value: 'diamond' },
                { label: 'Diamond5', value: 'diamond5' },
                { label: 'Diamond7', value: 'diamond7' },
                { label: 'Diamond9', value: 'diamond9' },
                { label: 'Triangle', value: 'triangle' },
                { label: 'Shape', value: 'shape' },
                { label: 'Gradient', value: 'gradient' }
              ]}
              value={
                currentBrushPresetId === 'color-cycle-gradient'
                  ? 'gradient'
                  : activeSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE
                    ? 'shape'
                  : activeSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE
                    ? 'triangle'
                    : activeSettings.colorCycleStampShape === 'round'
                      ? 'round'
                      : activeSettings.colorCycleStampShape === 'diamond9'
                        ? 'diamond9'
                        : activeSettings.colorCycleStampShape === 'diamond7'
                          ? 'diamond7'
                      : activeSettings.colorCycleStampShape === 'diamond5'
                        ? 'diamond5'
                      : activeSettings.colorCycleStampShape === 'diamond'
                        ? 'diamond'
                        : 'square'
              }
              onChange={(value) => {
                const strokePreset = brushPresets.find(p => p.id === 'color-cycle-stroke');
                const shapePreset = brushPresets.find(p => p.id === 'color-cycle-shape');
                const trianglePreset = brushPresets.find(p => p.id === 'color-cycle-triangle');
                const gradientPreset = brushPresets.find(p => p.id === 'color-cycle-gradient');
                if (value === 'gradient' && gradientPreset) {
                  setBrushPreset(gradientPreset, true);
                  setActiveSettings({
                    colorCycleStampShape: 'square',
                  });
                } else if (value === 'shape' && shapePreset) {
                  setBrushPreset(shapePreset, true);
                  setActiveSettings({ colorCycleStampShape: 'square' });
                } else if (value === 'triangle' && trianglePreset) {
                  setBrushPreset(trianglePreset, true);
                  setActiveSettings({ colorCycleStampShape: 'triangle' });
                } else if (
                  (
                    value === 'square' ||
                    value === 'round' ||
                    value === 'diamond' ||
                    value === 'diamond5' ||
                    value === 'diamond7' ||
                    value === 'diamond9'
                  ) &&
                  strokePreset
                ) {
                  setBrushPreset(strokePreset, true);
                  setActiveSettings({
                    colorCycleStampShape:
                      value === 'round'
                        ? 'round'
                        : value === 'diamond9'
                          ? 'diamond9'
                          : value === 'diamond7'
                            ? 'diamond7'
                        : value === 'diamond'
                          ? 'diamond'
                          : value === 'diamond5'
                            ? 'diamond5'
                            : 'square'
                  });
                }
              }}
              size="sm"
            />
          </div>
        )}

        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
              {sizeLabel}
            </label>
            <NonCcSlider
              value={sizeSlider.value}
              min={1}
              max={500}
              step={1}
              onChange={(value) => {
                sizeSlider.onChange(Math.min(500, Math.max(1, Math.round(value))));
              }}
              onCommit={sizeSlider.onCommit}
              aria-label={`Brush Size (${sizeUnit})`}
              className="flex-1"
            />
          </div>
        </div>

        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
              Spacing
            </label>
            <NonCcSlider
              value={spacingSlider.value}
              min={1}
              max={64}
              step={1}
              onChange={(value) =>
                spacingSlider.onChange(Math.max(1, Math.round(value)))
              }
              onCommit={spacingSlider.onCommit}
              aria-label="Stamp Spacing"
              className="flex-1"
            />
            <VelocityLinkToggle
              id="velocity-spacing-cc"
              checked={Boolean(activeSettings.velocitySpacingEnabled)}
              onChange={(checked) => setActiveSettings({ velocitySpacingEnabled: checked })}
              title="Link spacing to cursor speed"
            />
          </div>
        </div>

        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
              Speed
            </label>
            <NonCcSlider
              value={speedSlider.value}
              min={MIN_BRUSH_COLOR_CYCLE_SPEED}
              max={MAX_BRUSH_COLOR_CYCLE_SPEED}
              step={COLOR_CYCLE_SPEED_STEP}
              onChange={(value) => {
                speedSlider.onChange(
                  Math.max(
                    MIN_BRUSH_COLOR_CYCLE_SPEED,
                    Math.min(MAX_BRUSH_COLOR_CYCLE_SPEED, Number(value))
                  )
                );
              }}
              onCommit={speedSlider.onCommit}
              aria-label="Speed"
              className="flex-1"
            />
            <VelocityLinkToggle
              id="velocity-animation-speed-cc"
              checked={Boolean(activeSettings.velocityAnimationSpeedEnabled)}
              onChange={(checked) =>
                setActiveSettings({ velocityAnimationSpeedEnabled: checked })
              }
              title="Link animation speed to cursor speed"
            />
          </div>
        </div>

        <div className="mb-2">
          <ButtonGroup
            options={[
              { label: 'FG Grad', value: 'fg' },
              { label: 'Man Grad', value: 'manual' },
              { label: 'Sample', value: 'sample' }
            ]}
            value={gradientModeValue}
            onChange={(value) => {
              const nextSource = value === 'fg' ? 'fg' : value === 'sample' ? 'sampled' : 'manual';
              setCcGradientSource(nextSource);
              if (nextSource === 'manual') {
                // Switching back to manual must never recolor existing pixels.
                // Force a fork so subsequent edits apply to future strokes only.
                gradientForkRef.current = true;
                flushPendingGradient();
              }
            }}
            size="sm"
          />
        </div>

        {isColorCycleGradientPreset && (
          <div className="mb-2">
            <div className="flex items-center gap-1">
              <ButtonGroup
                options={[
                  { label: 'Grad', value: 'linear' },
                  { label: 'Concentric', value: 'concentric' },
                ]}
                value={colorCycleFillModeValue}
                onChange={(value) => {
                  const nextMode = value === 'linear' ? 'linear' : 'concentric';
                  setActiveSettings({ colorCycleFillMode: nextMode });
                }}
                className="flex-1 justify-start"
                size="sm"
              />
            </div>
          </div>
        )}

        {isColorCycleGradientPreset && gradientModeValue === 'manual' && (
          <div className="mb-3">
            <div className="flex items-center gap-1">
              <label
                htmlFor="cc-gradient-sample-per-shape"
                className={CONTROL_LABEL_CLASS}
                style={CONTROL_LABEL_STYLE}
              >
                Sample
              </label>
              <CustomSwitch
                id="cc-gradient-sample-per-shape"
                checked={ccGradientSamplePerShapeEnabled}
                onChange={(checked) => setActiveSettings({ ccGradientSamplePerShape: checked })}
              />
              <span className="text-xs text-[#A0A0A0]">Per Shape</span>
            </div>
          </div>
        )}

        {useForegroundDerivedGradient ? (
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs text-[#D9D9D9] mb-1">
              <span>Foreground Gradient</span>
              <span className="text-[#A0A0A0]">{fgColor.toUpperCase()}</span>
            </div>
            <div
              className="h-6 rounded border border-white/10"
              style={{ background: foregroundDerivedCss }}
            />
            {showColorCycleBands && (
              <div className="flex items-center gap-2 mt-2">
                <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                  Bands
                </label>
                <NonCcSlider
                  value={bandsSlider.value}
                  min={2}
                  max={64}
                  step={1}
                  onChange={(value) => bandsSlider.onChange(Math.round(value))}
                  onCommit={bandsSlider.onCommit}
                  aria-label="Gradient Bands"
                  className="flex-1"
                />
              </div>
            )}
          </div>
        ) : isGradientSampleMode ? (
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs text-[#D9D9D9] mb-1">
              <span>Sampled Gradient</span>
              <span className="text-[#A0A0A0]">Live</span>
            </div>
            <>
              {(() => {
                const previewResult = activeLayerId
                  ? getPreviewGradientForActiveMark(activeLayerId)
                  : null;
                const expectsSampled = resolvedGradientSource === 'sampled';
                const previewStops =
                  previewResult?.stopsStored ??
                  (expectsSampled ? null : activeLayer?.colorCycleData?.gradient) ??
                  activeSettings.colorCycleGradient ??
                  DEFAULT_GRADIENT_STOPS;
                return (
                  <SampledGradientPreview
                    stops={previewStops}
                    speed={activeSettings.colorCycleSpeed ?? MIN_BRUSH_COLOR_CYCLE_SPEED}
                    flowMode={activeSettings.colorCycleFlowMode}
                    isPaused={!effectiveColorCyclePlaying}
                  />
                );
              })()}
              <div className="mt-2 flex items-center justify-between text-xs text-[#A0A0A0]">
                <span>Samples: {ccGradientSampleCount}</span>
                <button
                  type="button"
                  className="rounded border border-white/10 px-2 py-0.5 text-[#D9D9D9] hover:border-white/30"
                  onClick={() => resetCcGradientSample()}
                >
                  Reset
                </button>
              </div>
            </>
          </div>
        ) : (
          <div className="mb-3">
            <GradientEditor
              sampleTarget="brush"
              stops={activeSettings.colorCycleGradient || DEFAULT_GRADIENT_STOPS}
              onChange={(stops) => {
                scheduleGradientFlush(stops);
                if (stops.length && activeSettings.gradientBands && activeSettings.gradientBands < stops.length) {
                  setActiveSettings({ gradientBands: stops.length });
                }
              }}
              onEditStart={() => {
                gradientForkRef.current = true;
              }}
            />
          </div>
        )}

        {useForegroundDerivedGradient && (
          <div className="mb-3">
            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                  Light
                </label>
                <ProgressSlider
                  value={fgDerivedLightness}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(value) =>
                    setActiveSettings({ colorCycleFgLightness: clampFgLightness(value) })
                  }
                  aria-label="Foreground Gradient Lightness"
                  className="flex-1"
                />
              </div>
            </div>
            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                  Hue
                </label>
                <ProgressSlider
                  value={fgDerivedHueShift}
                  min={-320}
                  max={320}
                  step={1}
                  onChange={(value) =>
                    setActiveSettings({ colorCycleFgHueShift: clampFgHueShift(value) })
                  }
                  aria-label="Foreground Gradient Hue Shift"
                  className="flex-1"
                />
              </div>
            </div>
            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                  Sat
                </label>
                <ProgressSlider
                  value={fgDerivedSaturationShift}
                  min={-45}
                  max={45}
                  step={1}
                  onChange={(value) =>
                    setActiveSettings({ colorCycleFgSaturationShift: clampFgSatShift(value) })
                  }
                  aria-label="Foreground Gradient Saturation Shift"
                  className="flex-1"
                />
              </div>
            </div>
            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                  Opacity
                </label>
                <NonCcSlider
                  value={fgOpacitySlider.value}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(value) =>
                    fgOpacitySlider.onChange(Math.max(0, Math.min(100, Math.round(value))))
                  }
                  onCommit={fgOpacitySlider.onCommit}
                  aria-label="Foreground Gradient Opacity"
                  className="flex-1"
                />
              </div>
            </div>
            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                  Stops
                </label>
                <NonCcSlider
                  value={fgStopsSlider.value}
                  min={2}
                  max={6}
                  step={1}
                  onChange={(value) =>
                    fgStopsSlider.onChange(Math.max(2, Math.min(6, Math.round(value))))
                  }
                  onCommit={fgStopsSlider.onCommit}
                  aria-label="Foreground Gradient Stops"
                  className="flex-1"
                />
              </div>
            </div>
          </div>
        )}

        {/* Fill Mode Tabs - only for Color Cycle Shape, not for Color Cycle Stroke */}
        {activeSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE && (
          <DitherControls
            settings={activeSettings}
            onChange={setActiveSettings}
            canToggle
            forceOn={Boolean(capability.forceDither)}
            isDitherPreset={isDitherPreset}
            hideLostEdge
            afterPresRes={
              isColorCycleGradientPreset ? (
                <div className="flex items-center gap-2 mt-2">
                  <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                    Colors
                  </label>
                  <ProgressSlider
                    value={activeSettings.gradientBands ?? 16}
                    min={2}
                    max={16}
                    step={1}
                    onChange={(value) =>
                      setActiveSettings({ gradientBands: Math.max(2, Math.round(value)) })
                    }
                    aria-label="Dither Colors"
                    className="flex-1"
                  />
                </div>
              ) : null
            }
          />
        )}

        {/* Animation + banding */}

        {showColorCycleBands && !useForegroundDerivedGradient && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                Bands
              </label>
              <NonCcSlider
                value={bandsSlider.value}
                min={2}
                max={64}
                step={1}
                onChange={(value) => bandsSlider.onChange(Math.round(value))}
                onCommit={bandsSlider.onCommit}
                aria-label="Gradient Bands"
                className="flex-1"
              />
            </div>
          </div>
        )}

        {(activeSettings.brushShape === BrushShape.COLOR_CYCLE ||
          activeSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE) && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="stamp-dither-color-cycle"
                className={CONTROL_LABEL_CLASS}
                style={CONTROL_LABEL_STYLE}
              >
                Dither
              </label>
              <CustomSwitch
                id="stamp-dither-color-cycle"
                checked={Boolean(activeSettings.colorCycleStampDitherEnabled)}
                onChange={(checked) =>
                  setActiveSettings({ colorCycleStampDitherEnabled: checked })
                }
              />
            </div>
            {activeSettings.colorCycleStampDitherEnabled && (
              <>
                <div className="flex items-center gap-2 mt-2">
                  <div className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE} />
                  <Dropdown
                    value={activeSettings.ditherAlgorithm || 'sierra-lite'}
                    options={DITHER_OPTIONS}
                    onChange={(value) =>
                      setActiveSettings({ ditherAlgorithm: value as BrushSettings['ditherAlgorithm'] })
                    }
                    className="flex-1"
                  />
                </div>
                {activeSettings.ditherAlgorithm === 'pattern' && (
                  <div className="flex items-center gap-2 mt-2">
                    <div className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE} />
                    <Dropdown
                      value={activeSettings.patternStyle || 'dots'}
                      options={PATTERN_STYLES}
                      onChange={(value) =>
                        setActiveSettings({
                          ditherAlgorithm: 'pattern',
                          patternStyle: value as NonNullable<BrushSettings['patternStyle']>
                        })
                      }
                      className="flex-1"
                    />
                  </div>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                    Res
                  </label>
                  <NonCcSlider
                    value={activeSettings.colorCycleStampDitherPixelSize ?? 1}
                    min={1}
                    max={32}
                    step={1}
                    onChange={(value) =>
                      setActiveSettings({
                        colorCycleStampDitherPixelSize: Math.max(1, Math.round(value))
                      })
                    }
                    disabled={Boolean(activeSettings.colorCycleStampDitherPressureLinked)}
                    aria-label="Stamp Dither Resolution"
                    className="flex-1"
                  />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                    Pres Res
                  </label>
                  <CustomSwitch
                    id="stamp-dither-pressure-linked-color-cycle"
                    checked={Boolean(activeSettings.colorCycleStampDitherPressureLinked)}
                    onChange={(checked) => {
                      const nextSettings: Partial<BrushSettings> = {
                        colorCycleStampDitherPressureLinked: checked,
                      };
                      if (checked) {
                        const current = activeSettings.colorCycleStampDitherPixelSize ?? 1;
                        if (current <= 1) {
                          nextSettings.colorCycleStampDitherPixelSize = 6;
                        }
                      }
                      setActiveSettings(nextSettings);
                    }}
                  />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                    BG Fill
                  </label>
                  <CustomSwitch
                    id="stamp-dither-clear-color-cycle"
                    checked={
                      typeof activeSettings.colorCycleStampDitherBgFill === 'boolean'
                        ? activeSettings.colorCycleStampDitherBgFill
                        : activeSettings.colorCycleStampDitherClears !== true
                    }
                    onChange={(checked) =>
                      setActiveSettings({
                        colorCycleStampDitherBgFill: checked,
                        colorCycleStampDitherClears: !checked,
                      })
                    }
                  />
                </div>
              </>
            )}
          </div>
        )}

        {/* Shape Mode - Hidden for Color Cycle brushes as it's auto-managed */}

        {/* Pressure - only for Color Cycle stroke variants */}
        {(activeSettings.brushShape === BrushShape.COLOR_CYCLE ||
          activeSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE) && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="pressure-enabled-color-cycle"
                className="text-[#D9D9D9] w-16"
                style={{ fontSize: "14px" }}
              >
                Pressure
              </label>
              <CustomSwitch
                id="pressure-enabled-color-cycle"
                checked={activeSettings.pressureEnabled || false}
                onChange={(checked) => {
                  setActiveSettings({ pressureEnabled: checked });
                }}
              />
              {(activeSettings.pressureEnabled || false) && (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    variant="compact"
                    value={pressureDraft.min}
                    onChange={(e) => handleMinChange(e.target.value)}
                    onFocus={handleMinFocus}
                    onBlur={handleMinBlur}
                    min="1"
                    max="1000"
                    className="w-16 bg-transparent text-right"
                  />
                  <Input
                    type="number"
                    variant="compact"
                    value={pressureDraft.max}
                    onChange={(e) => handleMaxChange(e.target.value)}
                    onFocus={handleMaxFocus}
                    onBlur={handleMaxBlur}
                    min="1"
                    max="1000"
                    className="w-16 bg-transparent text-right"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Rotation - only for stroke variants */}
        {(activeSettings.brushShape === BrushShape.COLOR_CYCLE ||
          activeSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE) && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="rotation-enabled-color-cycle"
                className="text-[#D9D9D9] w-16"
                style={{ fontSize: "14px" }}
              >
                Rotation
              </label>
              <CustomSwitch
                id="rotation-enabled-color-cycle"
                checked={activeSettings.rotationEnabled || false}
                onChange={(checked) =>
                  setActiveSettings({ rotationEnabled: checked })
                }
              />
            </div>
          </div>
        )}

        {/* Lost Edge (edge fade) */}
        <div className="mb-2">
          <div className="flex items-center gap-1">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Lostedge
            </label>
            <NonCcSlider
              value={lostEdgeSlider.value}
              min={0}
              max={100}
              step={1}
              onChange={(value) =>
                lostEdgeSlider.onChange(Math.max(0, Math.min(100, Math.round(value))))
              }
              onCommit={lostEdgeSlider.onCommit}
              aria-label="Lost Edge"
              className="flex-1"
            />
          </div>
        </div>

        {/* Dashed - only for stroke variants */}
        {(activeSettings.brushShape === BrushShape.COLOR_CYCLE ||
          activeSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE) && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="dashed-enabled-color-cycle"
                className="text-[#D9D9D9] w-16"
                style={{ fontSize: "14px" }}
              >
                Dashed
              </label>
              <CustomSwitch
                id="dashed-enabled-color-cycle"
                checked={activeSettings.dashedEnabled || false}
                onChange={(checked) =>
                  setActiveSettings({ dashedEnabled: checked })
                }
              />
              {(activeSettings.dashedEnabled || false) && (
                <>
                  <span className="text-[#D9D9D9]" style={{ fontSize: "12px" }}>
                    L
                  </span>
                  <CommittedNumberInput
                    value={activeSettings.dashLength || 3}
                    onCommit={(next) => setActiveSettings({ dashLength: next })}
                    min={1}
                    max={20}
                    step={0.25}
                    className="w-8 bg-transparent text-right"
                    title="Length units (×brush size)"
                  />
                  <span className="text-[#D9D9D9]" style={{ fontSize: "12px" }}>
                    G
                  </span>
                  <CommittedNumberInput
                    value={activeSettings.dashGap || 2}
                    onCommit={(next) => setActiveSettings({ dashGap: next })}
                    min={1}
                    max={20}
                    step={0.25}
                    className="w-8 bg-transparent text-right"
                    title="Gap units (×brush size)"
                  />
                  <span className="text-[#D9D9D9]" style={{ fontSize: '12px' }}>
                    V
                  </span>
                  <CommittedNumberInput
                    value={activeSettings.velocityDashGapStrength ?? 1}
                    onCommit={(next) => setActiveSettings({ velocityDashGapStrength: next })}
                    min={0}
                    max={10}
                    step={0.25}
                    className="w-8 bg-transparent text-right"
                    title="Speed gap boost strength (0 disables velocity effect)"
                  />
                </>
              )}
            </div>
          </div>
        )}

        {/* Grid Snap removed for Color Cycle brushes */}
      </div>
    );
  }

  // Show special controls for the Spam Text brush
  if (activeSettings.brushShape === BrushShape.SPAM_TEXT) {
    if (typeof window !== 'undefined') {
      console.log('[BrushControls] Spam branch');
    }
    // Define spam text presets
    const spamPresets: Record<string, string> = {
      mixed: 'WINNER!!! TO THE MOON!!! DEAR BENEFICIARY!!! CHEAP MEDS!!! ACT NOW!!! HODL!!! BANK OF NIGERIA!!! FDA APPROVED!!! FREE FREE FREE!!! DIAMOND HANDS!!! MILLION DOLLARS!!! SPECIAL PRICE!!! 100% GUARANTEED!!! PUMP IT!!! URGENT!!! ',
      classic: 'WINNER!!! ACT NOW!!! LIMITED TIME OFFER!!! CONGRATULATIONS!!! FREE FREE FREE!!! CLICK HERE!!! URGENT MESSAGE!!! HOT SINGLES IN YOUR AREA!!! 100% GUARANTEED!!! NO RISK!!! CALL NOW!!! AMAZING OFFER!!! EARN $$$!!! LOSE WEIGHT FAST!!! MIRACLE CURE!!! SECRET REVEALED!!! ',
      crypto: 'TO THE MOON!!! HODL!!! DIAMOND HANDS!!! BUY THE DIP!!! WHALE ALERT!!! 100X GAINS!!! PUMP IT!!! NOT FINANCIAL ADVICE!!! LAMBO SOON!!! MOON MISSION!!! GEM FOUND!!! RUG PROOF!!! DYOR!!! APE IN NOW!!! ',
      prince: 'DEAR BENEFICIARY!!! INHERITANCE FUND!!! BANK OF NIGERIA!!! TRANSFER FEES REQUIRED!!! MILLION DOLLARS!!! TRUSTED BARRISTER!!! URGENT RESPONSE NEEDED!!! STRICTLY CONFIDENTIAL!!! GOD BLESS!!! AWAITING YOUR REPLY!!! KINDLY SEND DETAILS!!! WESTERN UNION!!! ',
      pharma: 'CHEAP MEDS!!! NO PRESCRIPTION!!! FDA APPROVED!!! GENERIC PILLS!!! DISCREET SHIPPING!!! ONLINE PHARMACY!!! SPECIAL PRICE!!! ORDER TODAY!!! DOCTOR APPROVED!!! SAFE & EFFECTIVE!!! FAST DELIVERY!!! '
    };

    return (
      <div className="p-4">
        {/* Content Type - dropdown that pre-populates text */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Content
            </label>
            <Dropdown
              value={activeSettings.spamContentType || 'mixed'}
              onChange={(value) => {
                setActiveSettings({ 
                  spamContentType: value,
                  spamCustomText: spamPresets[value] || spamPresets.mixed
                });
              }}
              options={[
                { label: 'Mixed Chaos', value: 'mixed' },
                { label: 'Classic Spam', value: 'classic' },
                { label: 'Crypto Spam', value: 'crypto' },
                { label: 'Nigerian Prince', value: 'prince' },
                { label: 'Pharma Ads', value: 'pharma' }
              ]}
              className="flex-1"
            />
          </div>
        </div>

        {/* Custom Text Input - no label */}
        <div className="mb-2">
          <textarea
            value={activeSettings.spamCustomText || spamPresets[activeSettings.spamContentType || 'mixed']}
            onChange={(e) => setActiveSettings({ spamCustomText: e.target.value })}
            placeholder="Enter custom text here..."
            className="w-full h-20 p-2 border border-[#D9D9D9] bg-transparent text-[#D9D9D9] resize-none focus:outline-none focus:border-[#F3F3F7]"
            style={{ fontSize: "12px", fontFamily: 'monospace' }}
          />
        </div>

        {/* Font Selection */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Font
            </label>
            <Dropdown
              value={activeSettings.spamFont || 'courier'}
              onChange={(value) => setActiveSettings({ spamFont: value })}
              options={[
                { label: 'Courier New', value: 'courier' },
                { label: 'Consolas', value: 'consolas' },
                { label: 'Monaco', value: 'monaco' },
                { label: 'Lucida Console', value: 'lucida' },
                { label: 'Roboto Mono', value: 'roboto' },
                { label: 'Source Code Pro', value: 'source' },
                { label: 'Terminal', value: 'terminal' },
                { label: 'Menlo', value: 'menlo' }
              ]}
              className="flex-1"
            />
          </div>
        </div>

        {/* Size */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Size px
            </label>
            <NonCcSlider
              value={effectiveGlobalBrushSize}
              min={8}
              max={72}
              step={1}
              onChange={(value) => {
                const next = Math.max(8, value);
                setGlobalBrushSize(next);
                if (currentTool === 'eraser') {
                  setEraserSettings({ size: next });
                }
              }}
              aria-label="Text Size (px)"
              className="flex-1"
            />
          </div>
        </div>

        {/* Opacity */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Opacity
            </label>
            <NonCcSlider
              value={activeSettings.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setActiveSettings({ opacity: value })}
              aria-label="Opacity"
              className="flex-1"
            />
          </div>
        </div>

        {/* Spacing */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Spacing
            </label>
            <NonCcSlider
              value={activeSettings.spacing}
              min={1}
              max={40}
              step={1}
              onChange={(value) =>
                setActiveSettings({ spacing: Math.max(1, Math.round(value)) })
              }
              aria-label="Spacing"
              className="flex-1"
            />
            <VelocityLinkToggle
              id="velocity-spacing-spam"
              checked={Boolean(activeSettings.velocitySpacingEnabled)}
              onChange={(checked) => setActiveSettings({ velocitySpacingEnabled: checked })}
              title="Link spacing to cursor speed"
            />
          </div>
        </div>

        {/* Lost Edge (edge fade) */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Lostedge
            </label>
            <NonCcSlider
              value={activeSettings.lostEdge ?? 0}
              min={0}
              max={100}
              step={1}
              onChange={(value) =>
                setActiveSettings({
                  lostEdge: Math.max(0, Math.min(100, Math.round(value)))
                })
              }
              aria-label="Lost Edge"
              className="flex-1"
            />
          </div>
        </div>

        {isRegularBrush && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="auto-sample-color"
                className={CONTROL_LABEL_CLASS}
                style={CONTROL_LABEL_STYLE}
                title="Pick brush color from the pixel under the cursor (prefers reference layer)"
              >
                Auto Pick
              </label>
              <CustomSwitch
                id="auto-sample-color"
                checked={Boolean(activeSettings.autoSampleColor)}
                onChange={(checked) => setActiveSettings({ autoSampleColor: checked })}
              />
            </div>
          </div>
        )}

        {/* Pressure */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="pressure-enabled-spam"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              Pressure
            </label>
            <CustomSwitch
              id="pressure-enabled-spam"
              checked={activeSettings.pressureEnabled || false}
              onChange={(checked) => setActiveSettings({ pressureEnabled: checked })}
            />
            {(activeSettings.pressureEnabled || false) && (
              <>
                  <Input
                    type="number"
                    variant="compact"
                    value={pressureDraft.min}
                    onChange={(e) => handleMinChange(e.target.value)}
                    onFocus={handleMinFocus}
                    onBlur={handleMinBlur}
                    min="1"
                    max="1000"
                    className="w-16 bg-transparent text-right"
                  />
                <span className="text-[#D9D9D9]" style={{ fontSize: "14px" }}>
                  -
                </span>
                  <Input
                    type="number"
                    variant="compact"
                    value={pressureDraft.max}
                    onChange={(e) => handleMaxChange(e.target.value)}
                    onFocus={handleMaxFocus}
                    onBlur={handleMaxBlur}
                    min="1"
                    max="1000"
                    className="w-16 bg-transparent text-right"
                  />
              </>
            )}
          </div>
        </div>

        {/* Grid Snap */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="grid-snap-enabled-spam"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              Grid Snap
            </label>
            <CustomSwitch
              id="grid-snap-enabled-spam"
              checked={activeSettings.gridSnapEnabled || false}
              onChange={(checked) =>
                setActiveSettings({ gridSnapEnabled: checked })
              }
            />
            <Input
              type="number"
              variant="compact"
              value={Math.max(1, Math.round(activeSettings.gridSnapSize ?? 16))}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (!Number.isFinite(next)) return;
                setActiveSettings({ gridSnapSize: Math.max(1, Math.min(256, Math.round(next))) });
              }}
              min="1"
              max="256"
              className="w-14 bg-transparent text-right"
              title="Grid size in pixels"
            />
            <span className="text-[#D9D9D9]" style={{ fontSize: '12px' }}>
              px
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Show special controls for Mosaic brush
  if (activeSettings.brushShape === BrushShape.MOSAIC) {
    return (
      <div className="p-4">
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
              Size {sizeUnit}
            </label>
            <NonCcSlider
              value={isActiveCustomBrush ? customBrushPercent : effectiveGlobalBrushSize}
              min={isActiveCustomBrush ? 5 : 1}
              max={isActiveCustomBrush ? 1000 : 500}
              step={isActiveCustomBrush ? 5 : 1}
              onChange={(value) => {
                if (isActiveCustomBrush) {
                  setCustomBrushSizePercent(value);
                  if (currentTool === 'eraser' && eraserSettings.linkSizeToBrush === false) {
                    const updatedSize =
                      useAppStore.getState().tools.brushSettings.size ?? globalBrushSize;
                    setEraserSettings({ size: updatedSize });
                  }
                  return;
                }
                const min = 1;
                const max = 500;
                const next = Math.min(max, Math.max(min, Math.round(value)));
                setGlobalBrushSize(next);
                if (currentTool === 'eraser') {
                  setEraserSettings({ size: next });
                }
              }}
              aria-label={`Brush Size (${sizeUnit})`}
              className="flex-1"
            />
          </div>
        </div>

        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
              Spacing
            </label>
            <NonCcSlider
              value={activeSettings.spacing ?? 1}
              min={1}
              max={64}
              step={1}
              onChange={(value) =>
                setActiveSettings({ spacing: Math.max(1, Math.round(value)) })
              }
              aria-label="Mosaic Spacing"
              className="flex-1"
            />
            <VelocityLinkToggle
              id="velocity-spacing-mosaic"
              checked={Boolean(activeSettings.velocitySpacingEnabled)}
              onChange={(checked) => setActiveSettings({ velocitySpacingEnabled: checked })}
              title="Link spacing to cursor speed"
            />
          </div>
        </div>

        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
              Opacity
            </label>
            <NonCcSlider
              value={activeSettings.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setActiveSettings({ opacity: value })}
              aria-label="Opacity"
              className="flex-1"
            />
          </div>
        </div>

        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="mosaic-pixel-perfect"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: '14px' }}
            >
              Pixel
            </label>
            <CustomSwitch
              id="mosaic-pixel-perfect"
              checked={!activeSettings.antialiasing}
              onChange={(checked) =>
                setActiveSettings({ antialiasing: !checked })
              }
            />
          </div>
        </div>

        <div className="mb-3">
          <GradientEditor
            sampleTarget="brush"
            stops={activeSettings.colorCycleGradient || DEFAULT_GRADIENT_STOPS}
            onChange={(stops) => {
              scheduleGradientFlush(stops);
            }}
            onEditStart={() => {
              gradientForkRef.current = true;
            }}
          />
        </div>

        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
              Tile
            </label>
            <NonCcSlider
              value={activeSettings.mosaicTilePx ?? 8}
              min={1}
              max={64}
              step={1}
              onChange={(value) =>
                setActiveSettings({ mosaicTilePx: Math.max(1, Math.round(value)) })
              }
              aria-label="Mosaic Tile Size"
              className="flex-1"
            />
          </div>
        </div>

        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
              Blocks
            </label>
            <NonCcSlider
              value={activeSettings.mosaicBlocksCount ?? 6}
              min={1}
              max={32}
              step={1}
              onChange={(value) =>
                setActiveSettings({ mosaicBlocksCount: Math.max(1, Math.round(value)) })
              }
              aria-label="Mosaic Blocks Count"
              className="flex-1"
            />
          </div>
        </div>

        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
              Palette
            </label>
            <NonCcSlider
              value={activeSettings.mosaicPaletteCount ?? 8}
              min={2}
              max={32}
              step={1}
              onChange={(value) =>
                setActiveSettings({ mosaicPaletteCount: Math.max(2, Math.round(value)) })
              }
              aria-label="Mosaic Palette Count"
              className="flex-1"
            />
          </div>
        </div>

        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
              Segment
            </label>
            <NonCcSlider
              value={activeSettings.mosaicSegmentPx ?? 160}
              min={1}
              max={1000}
              step={1}
              onChange={(value) =>
                setActiveSettings({ mosaicSegmentPx: Math.max(1, Math.round(value)) })
              }
              aria-label="Mosaic Segment Length"
              className="flex-1"
            />
          </div>
        </div>

        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
              Seg Jit
            </label>
            <NonCcSlider
              value={activeSettings.mosaicSegmentJitter ?? 0}
              min={0}
              max={100}
              step={1}
              onChange={(value) =>
                setActiveSettings({ mosaicSegmentJitter: Math.max(0, Math.min(100, Math.round(value))) })
              }
              aria-label="Mosaic Segment Jitter"
              className="flex-1"
            />
          </div>
        </div>

        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="mosaic-dither-enabled"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: '14px' }}
            >
              Dither
            </label>
            <CustomSwitch
              id="mosaic-dither-enabled"
              checked={activeSettings.mosaicDitherEnabled || false}
              onChange={(checked) =>
                setActiveSettings({ mosaicDitherEnabled: checked })
              }
            />
          </div>
        </div>

        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
              Seed
            </label>
            <Input
              type="number"
              variant="compact"
              value={activeSettings.mosaicSeed ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw.trim() === '') {
                  setActiveSettings({ mosaicSeed: undefined });
                  return;
                }
                const next = Number(raw);
                if (!Number.isNaN(next)) {
                  setActiveSettings({ mosaicSeed: Math.floor(next) });
                }
              }}
              placeholder="auto"
              className="w-20 bg-transparent text-right"
            />
            <button
              type="button"
              className="rounded border border-white/10 px-2 py-0.5 text-xs text-[#D9D9D9] hover:border-white/30"
              onClick={() => {
                const next = Math.floor(Math.random() * 1_000_000_000);
                setActiveSettings({ mosaicSeed: next });
              }}
            >
              Rand
            </button>
          </div>
        </div>

        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="pressure-enabled-mosaic"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: '14px' }}
            >
              Pressure
            </label>
            <CustomSwitch
              id="pressure-enabled-mosaic"
              checked={activeSettings.pressureEnabled || false}
              onChange={(checked) => {
                setActiveSettings({ pressureEnabled: checked });
              }}
            />
            {(activeSettings.pressureEnabled || false) && (
              <>
                <Input
                  type="number"
                  variant="compact"
                  value={pressureDraft.min}
                  onChange={(e) => handleMinChange(e.target.value)}
                  onFocus={handleMinFocus}
                  onBlur={handleMinBlur}
                  min="1"
                  max="1000"
                  className="w-12 bg-transparent text-right"
                />
                <Input
                  type="number"
                  variant="compact"
                  value={pressureDraft.max}
                  onChange={(e) => handleMaxChange(e.target.value)}
                  onFocus={handleMaxFocus}
                  onBlur={handleMaxBlur}
                  min="1"
                  max="1000"
                  className="w-12 bg-transparent text-right"
                />
              </>
            )}
          </div>
        </div>

        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="rotation-enabled-mosaic"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: '14px' }}
            >
              Rotation
            </label>
            <CustomSwitch
              id="rotation-enabled-mosaic"
              checked={activeSettings.rotationEnabled || false}
              onChange={(checked) =>
                setActiveSettings({ rotationEnabled: checked })
              }
            />
          </div>
        </div>
      </div>
    );
  }

  // Show special controls for Resampler brush
  if (activeSettings.brushShape === BrushShape.RESAMPLER) {
    if (typeof window !== 'undefined') {
      console.log('[BrushControls] Resampler branch');
    }
    return (
      <div className="p-4">
        {/* Continuous Sampling Toggle */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label 
              htmlFor="continuous-sampling"
              className="text-[#D9D9D9] w-16" 
              style={{ fontSize: "14px" }}
            >
              Continuous
            </label>
            <CustomSwitch
              id="continuous-sampling"
              checked={activeSettings.continuousSampling || false}
              onChange={(checked) =>
                setActiveSettings({ continuousSampling: checked })
              }
            />
          </div>
        </div>
        
        {/* Resample Interval Slider - always shown for resampler brush */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Interval
            </label>
            <NonCcSlider
              value={activeSettings.resampleInterval || 5}
              min={1}
              max={10}
              step={1}
              onChange={(value) =>
                setActiveSettings({ resampleInterval: Math.round(value) })
              }
              aria-label="Resample Interval"
              className="flex-1"
            />
          </div>
        </div>

        {/* Size */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Size {sizeUnit}
            </label>
            <NonCcSlider
              value={isActiveCustomBrush ? customBrushPercent : effectiveGlobalBrushSize}
              min={isActiveCustomBrush ? 5 : 1}
              max={isActiveCustomBrush ? 1000 : 500}
              step={isActiveCustomBrush ? 5 : 1}
              onChange={(value) => {
                if (isActiveCustomBrush) {
                  setCustomBrushSizePercent(value);
                  if (currentTool === 'eraser' && eraserSettings.linkSizeToBrush === false) {
                    const updatedSize =
                      useAppStore.getState().tools.brushSettings.size ?? globalBrushSize;
                    setEraserSettings({ size: updatedSize });
                  }
                  return;
                }
                const min = 1;
                const max = 500;
                const next = Math.min(max, Math.max(min, Math.round(value)));
                setGlobalBrushSize(next);
                if (currentTool === 'eraser') {
                  setEraserSettings({ size: next });
                }
              }}
              aria-label={`Brush Size (${sizeUnit})`}
              className="flex-1"
            />
          </div>
        </div>

        {/* Opacity */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Opacity
            </label>
            <NonCcSlider
              value={activeSettings.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setActiveSettings({ opacity: value })}
              aria-label="Opacity"
              className="flex-1"
            />
          </div>
        </div>

        {/* Spacing */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Spacing
            </label>
            <NonCcSlider
              value={activeSettings.spacing}
              min={1}
              max={40}
              step={1}
              onChange={(value) =>
                setActiveSettings({ spacing: Math.max(1, Math.round(value)) })
              }
              aria-label="Spacing"
              className="flex-1"
            />
            <VelocityLinkToggle
              id="velocity-spacing-resampler"
              checked={Boolean(activeSettings.velocitySpacingEnabled)}
              onChange={(checked) => setActiveSettings({ velocitySpacingEnabled: checked })}
              title="Link spacing to cursor speed"
            />
          </div>
        </div>

        {canDitherForShape(activeSettings.brushShape) && (
          <DitherControls
            settings={activeSettings}
            onChange={setActiveSettings}
            canToggle
            forceOn={Boolean(capability.forceDither)}
            isDitherPreset={isDitherPreset}
            afterPresRes={
              <PigmentLiftControls
                settings={activeSettings}
                onChange={setActiveSettings}
                idSuffix="resampler"
                Slider={NonCcSlider}
              />
            }
          />
        )}
        <RisoControls
          settings={activeSettings}
          onChange={setActiveSettings}
          idSuffix="resampler"
          Slider={NonCcSlider}
        />

        {/* Shape Mode - Draw closed polygon shapes */}
        {!hideShapeToggle && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="shape-mode-resampler"
                className="text-[#D9D9D9] w-16"
                style={{ fontSize: "14px" }}
              >
                Shape
              </label>
              <CustomSwitch
                id="shape-mode-resampler"
                checked={shapeMode || false}
                onChange={(checked) => {
                  try { console.log('[SHAPE/UI] toggle (resampler)', { checked }); } catch {}
                  setShapeMode(checked);
                }}
              />
            </div>
          </div>
        )}

        {/* Pressure */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="pressure-enabled-resampler"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              Pressure
            </label>
            <CustomSwitch
              id="pressure-enabled-resampler"
              checked={activeSettings.pressureEnabled || false}
              onChange={(checked) => {
                setActiveSettings({ pressureEnabled: checked });
              }}
            />
            {(activeSettings.pressureEnabled || false) && (
              <>
                <Input
                  type="number"
                  variant="compact"
                  value={pressureDraft.min}
                  onChange={(e) => handleMinChange(e.target.value)}
                  onFocus={handleMinFocus}
                  onBlur={handleMinBlur}
                  min="1"
                  max="1000"
                  className="w-16 bg-transparent text-right"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: "14px" }}>
                  -
                </span>
                <Input
                  type="number"
                  variant="compact"
                  value={pressureDraft.max}
                  onChange={(e) => handleMaxChange(e.target.value)}
                  onFocus={handleMaxFocus}
                  onBlur={handleMaxBlur}
                  min="1"
                  max="1000"
                  className="w-16 bg-transparent text-right"
                />
              </>
            )}
          </div>
        </div>

        {/* Rotation - only for stroke brushes */}
        {isStrokeBrush(activeSettings.brushShape || BrushShape.RESAMPLER) && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="rotation-enabled-resampler"
                className="text-[#D9D9D9] w-16"
                style={{ fontSize: "14px" }}
              >
                Rotation
              </label>
              <CustomSwitch
                id="rotation-enabled-resampler"
                checked={activeSettings.rotationEnabled || false}
                onChange={(checked) =>
                  setActiveSettings({ rotationEnabled: checked })
                }
              />
            </div>
          </div>
        )}

        {/* Dashed (hidden for Dither Shape) */}
        {(!isDitherShapePreset || isActiveCustomBrush) && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="dashed-enabled-resampler"
                className="text-[#D9D9D9] w-16"
                style={{ fontSize: "14px" }}
              >
                Dashed
              </label>
              <CustomSwitch
                id="dashed-enabled-resampler"
                checked={activeSettings.dashedEnabled || false}
                onChange={(checked) =>
                  setActiveSettings({ dashedEnabled: checked })
                }
              />
              {(activeSettings.dashedEnabled || false) && (
                <>
                  <span className="text-[#D9D9D9]" style={{ fontSize: "12px" }}>
                    L
                  </span>
                  <CommittedNumberInput
                    value={activeSettings.dashLength || 3}
                    onCommit={(next) => setActiveSettings({ dashLength: next })}
                    min={1}
                    max={20}
                    step={0.25}
                    className="w-8 bg-transparent text-right"
                    title="Length units (×brush size)"
                  />
                  <span className="text-[#D9D9D9]" style={{ fontSize: "12px" }}>
                    G
                  </span>
                  <CommittedNumberInput
                    value={activeSettings.dashGap || 2}
                    onCommit={(next) => setActiveSettings({ dashGap: next })}
                    min={1}
                    max={20}
                    step={0.25}
                    className="w-8 bg-transparent text-right"
                    title="Gap units (×brush size)"
                  />
                  <span className="text-[#D9D9D9]" style={{ fontSize: '12px' }}>
                    V
                  </span>
                  <CommittedNumberInput
                    value={activeSettings.velocityDashGapStrength ?? 1}
                    onCommit={(next) => setActiveSettings({ velocityDashGapStrength: next })}
                    min={0}
                    max={10}
                    step={0.25}
                    className="w-8 bg-transparent text-right"
                    title="Speed gap boost strength (0 disables velocity effect)"
                  />
                </>
              )}
            </div>
          </div>
        )}

        {/* Grid Snap */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="grid-snap-enabled-resampler"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              Grid Snap
            </label>
            <CustomSwitch
              id="grid-snap-enabled-resampler"
              checked={activeSettings.gridSnapEnabled || false}
              onChange={(checked) =>
                setActiveSettings({ gridSnapEnabled: checked })
              }
            />
            <Input
              type="number"
              variant="compact"
              value={Math.max(1, Math.round(activeSettings.gridSnapSize ?? 16))}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (!Number.isFinite(next)) return;
                setActiveSettings({ gridSnapSize: Math.max(1, Math.min(256, Math.round(next))) });
              }}
              min="1"
              max="256"
              className="w-14 bg-transparent text-right"
              title="Grid size in pixels"
            />
            <span className="text-[#D9D9D9]" style={{ fontSize: '12px' }}>
              px
            </span>
          </div>
        </div>
      </div>
    );
  }



  // Show special controls for Polygon brush
  if (activeSettings.brushShape === BrushShape.POLYGON) {
    if (typeof window !== 'undefined') {
      console.log('[BrushControls] Polygon branch');
    }
    return (
      <div className="p-4">
        {/* Polygon Sides */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Sides
            </label>
            <NonCcSlider
              value={activeSettings.polygonSides || 6}
              min={3}
              max={12}
              step={1}
              onChange={(value) =>
                setActiveSettings({ polygonSides: Math.round(value) })
              }
              aria-label="Polygon Sides"
              className="flex-1"
            />
          </div>
        </div>

        {/* Dither Resolution */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Dither
            </label>
            <NonCcSlider
              value={activeSettings.polygonDitherResolution || 3}
              min={1}
              max={32}
              step={1}
              onChange={(value) =>
                setActiveSettings({ polygonDitherResolution: Math.round(value) })
              }
              aria-label="Dither Resolution"
              className="flex-1"
            />
          </div>
        </div>

        {/* Dither Enabled */}
        {canDitherForShape(activeSettings.brushShape) && (
          <DitherControls
            settings={activeSettings}
            onChange={setActiveSettings}
            canToggle
            forceOn={Boolean(capability.forceDither)}
            isDitherPreset={isDitherPreset}
            afterPresRes={
              <PigmentLiftControls
                settings={activeSettings}
                onChange={setActiveSettings}
                idSuffix="polygon"
                Slider={NonCcSlider}
              />
            }
            hideLostEdge
          />
        )}

        {/* Standard brush controls */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Size px
            </label>
            <NonCcSlider
              value={effectiveGlobalBrushSize}
              min={1}
              max={500}
              step={1}
              onChange={(value) => {
                const next = Math.max(1, value);
                setGlobalBrushSize(next);
                if (currentTool === 'eraser') {
                  setEraserSettings({ size: next });
                }
              }}
              aria-label="Brush Size"
              className="flex-1"
            />
          </div>
        </div>

        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Opacity
            </label>
            <NonCcSlider
              value={activeSettings.opacity}
              min={1}
              max={100}
              onChange={(value) => setActiveSettings({ opacity: value })}
              aria-label="Brush Opacity"
              className="flex-1"
            />
          </div>
        </div>

        {/* Lost Edge (edge fade) */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Lostedge
            </label>
            <NonCcSlider
              value={activeSettings.lostEdge ?? 0}
              min={0}
              max={100}
              step={1}
              onChange={(value) =>
                setActiveSettings({
                  lostEdge: Math.max(0, Math.min(100, Math.round(value)))
                })
              }
              aria-label="Lost Edge"
              className="flex-1"
            />
          </div>
        </div>
      </div>
    );
  }

  // Show Colors and Film Grain sliders for gradient brushes
  if (
    activeSettings.brushShape === BrushShape.RECTANGLE_GRADIENT ||
    activeSettings.brushShape === BrushShape.POLYGON_GRADIENT
  ) {
    return (
      <div className="p-4">
        {/* Gradient Source (Rectangle only): None = sample canvas, Presets = fixed list */}
        {activeSettings.brushShape === BrushShape.RECTANGLE_GRADIENT && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
                Gradient
              </label>
              <Dropdown
                value={activeSettings.rectGradientPresetId || 'none'}
                options={[{ value: 'none', label: 'None' }, ...getRectGradientPresetOptions()]}
                onChange={(value) => setActiveSettings({ rectGradientPresetId: value })}
                renderOption={(option) => {
                  if (option.value === 'none') {
                    return (
                      <div className="flex items-center gap-2 w-full">
                        <span className="text-[#D9D9D9] text-xs">None</span>
                      </div>
                    );
                  }
                  const stops = getPresetStops(option.value) || [];
                  const gradientCss = stops
                    .map(s => `${s.color} ${Math.round(s.position * 100)}%`)
                    .join(', ');
                  return (
                    <div className="flex items-center gap-2 w-full">
                      <div
                        className="flex-1 h-5 border border-[#666]"
                        style={{ background: `linear-gradient(90deg, ${gradientCss})` }}
                      />
                    </div>
                  );
                }}
                renderValue={(selected) => {
                  if (!selected || selected.value === 'none') {
                    return <span className="truncate">None</span>;
                  }
                  const stops = getPresetStops(selected.value) || [];
                  const gradientCss = stops
                    .map(s => `${s.color} ${Math.round(s.position * 100)}%`)
                    .join(', ');
                  return (
                    <div
                      className="h-5 w-full border border-[#666]"
                      style={{ background: `linear-gradient(90deg, ${gradientCss})` }}
                    />
                  );
                }}
                className="flex-1"
              />
            </div>
          </div>
        )}

        {/* Colors (final bands). Rectangle: 2-64; Polygon: 1-10 (unchanged) */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Colors
            </label>
            <NonCcSlider
              value={activeSettings.colors || 2}
              min={activeSettings.brushShape === BrushShape.RECTANGLE_GRADIENT ? 2 : 1}
              max={activeSettings.brushShape === BrushShape.RECTANGLE_GRADIENT ? 64 : 10}
              step={1}
              onChange={(value) =>
                setActiveSettings({ colors: Math.round(value) })
              }
              aria-label="Gradient Colors"
              className="flex-1"
            />
          </div>
        </div>

        {activeSettings.brushShape === BrushShape.POLYGON_GRADIENT && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="polygon-sample-colors"
                className="text-[#D9D9D9] w-16"
                style={{ fontSize: "14px" }}
              >
                Sample
              </label>
              <CustomSwitch
                id="polygon-sample-colors"
                checked={activeSettings.polygonSampleColors !== false}
                onChange={(checked) =>
                  setActiveSettings({ polygonSampleColors: checked })
                }
              />
            </div>
          </div>
        )}

        {/* Lost Edge (edge fade) */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Lostedge
            </label>
            <NonCcSlider
              value={activeSettings.lostEdge ?? 0}
              min={0}
              max={100}
              step={1}
              onChange={(value) =>
                setActiveSettings({
                  lostEdge: Math.max(0, Math.min(100, Math.round(value)))
                })
              }
              aria-label="Lost Edge"
              className="flex-1"
            />
          </div>
        </div>

        {canDitherForShape(activeSettings.brushShape) && (
          <DitherControls
            settings={activeSettings}
            onChange={setActiveSettings}
            canToggle
            forceOn={Boolean(capability.forceDither)}
            isDitherPreset={isDitherPreset}
            afterPresRes={
              <PigmentLiftControls
                settings={activeSettings}
                onChange={setActiveSettings}
                idSuffix="gradient"
                Slider={NonCcSlider}
              />
            }
            hideLostEdge
          />
        )}

        <RisoControls
          settings={activeSettings}
          onChange={setActiveSettings}
          idSuffix="gradient"
          Slider={NonCcSlider}
        />

        {/* Test Swatches Button */}
        <div className="mb-2">
          <button
            onClick={drawTestSwatches}
            className="w-full px-3 py-1 text-sm bg-[#4a4a4a] text-[#D9D9D9] rounded hover:bg-[#5a5a5a] transition-colors"
            style={{ fontSize: "12px" }}
          >
            Draw Test Swatches
          </button>
        </div>
      </div>
    );
  }

  if (isDitherGradient) {
    const maxTransparent = Math.max(0, Math.min(6, currentStops.length - 1));
    const transValue = Math.min(activeSettings.trans ?? 0, maxTransparent);
    return (
      <div className="p-4">
        {/* Dither settings (toggle kept to allow background transparency control) */}
        {canDitherForShape(activeSettings.brushShape) && (
          <DitherControls
            settings={activeSettings}
            onChange={setActiveSettings}
            canToggle={false}
            forceOn
            hideToggle
            afterResolution={
              <>
                <div className="flex items-center gap-2 mt-2">
                  <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                    Length
                  </label>
                  <NonCcSlider
                    value={activeSettings.gradientLength ?? 100}
                    min={20}
                    max={200}
                    step={1}
                    onChange={(value) =>
                      setActiveSettings({
                        gradientLength: Math.max(20, Math.min(200, Math.round(value))),
                      })
                    }
                    aria-label="Gradient Length (%)"
                    className="flex-1"
                  />
                </div>

                <div className="flex items-center gap-2 mt-2">
                  <label
                    htmlFor="dither-grad-sample"
                    className="text-[#D9D9D9] w-16"
                    style={{ fontSize: '14px' }}
                  >
                    Sample
                  </label>
                  <CustomSwitch
                    id="dither-grad-sample"
                    checked={isDitherGradSampling}
                    onChange={(checked) => {
                      if (checked) {
                        ditherGradAutoRef.current = false;
                        ditherGradAutoStopsRef.current = null;
                        setActiveSettings({ ditherGradSampleEnabled: true });
                        return;
                      }

                      const autoStops = buildAutoStops(currentStops.length);
                      const nextMaxTransparent = Math.max(0, Math.min(6, autoStops.length - 1));
                      const currentTrans = activeSettings.trans;
                      ditherGradAutoRef.current = true;
                      ditherGradAutoStopsRef.current = autoStops;

                      if (typeof currentTrans === 'number' && currentTrans > nextMaxTransparent) {
                        setActiveSettings({
                          ditherGradSampleEnabled: false,
                          ditherGradStops: autoStops,
                          trans: nextMaxTransparent,
                        });
                        return;
                      }

                      setActiveSettings({
                        ditherGradSampleEnabled: false,
                        ditherGradStops: autoStops,
                      });
                    }}
                  />
                </div>

                <div className="flex items-center gap-2 mt-2">
                  <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                    Colors
                  </label>
                  <NonCcSlider
                    value={currentStops.length}
                    min={2}
                    max={6}
                    step={1}
                    onChange={handleStopCountChange}
                    aria-label="Dither Gradient Colors"
                    className="flex-1"
                  />
                </div>

                <div className="flex items-start gap-2 mt-2">
                  <div className="w-16" />
                  <div className="flex flex-wrap gap-3 flex-1">
                    {currentStops.map((stop, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-xs text-[#D9D9D9] w-4 text-right">{idx + 1}</span>
                        <Input
                          type="color"
                          value={stop}
                          aria-label={`Dither gradient color ${idx + 1}`}
                          onChange={(e) => handleStopColorChange(idx, e.target.value)}
                          className="w-10 h-10 p-0 border border-[#4a4a4a] rounded"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-2">
                  <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                    Trans
                  </label>
                  <NonCcSlider
                    value={transValue}
                    min={0}
                    max={6}
                    step={1}
                    onChange={(value) =>
                      setActiveSettings({
                        trans: Math.max(0, Math.min(maxTransparent, Math.round(value))),
                      })
                    }
                    aria-label="Transparent Colors"
                    className="flex-1"
                  />
                </div>
              </>
            }
          />
        )}

        {/* Opacity */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
              Opacity
            </label>
            <NonCcSlider
              value={activeSettings.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setActiveSettings({ opacity: value })}
              aria-label="Opacity"
              className="flex-1"
            />
          </div>
        </div>
      </div>
    );
  }

  if (isShapeFillBrush) {
    return (
      <div className="flex flex-col gap-4">
        <div className="px-4">
          {canDitherForShape(activeSettings.brushShape) && (
            <DitherControls
              settings={activeSettings}
              onChange={setActiveSettings}
              canToggle
              forceOn={false}
              hideToggle={false}
              compact
            />
          )}
        </div>
        <ShapeFillControls />
      </div>
    );
  }

  return (
    <div className="p-4">
      {isActiveCustomBrush && (
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              CC
            </label>
            <CustomSwitch
              checked={isCustomColorCycleEnabled}
              onChange={handleToggleCustomColorCycle}
            />
          </div>

          <div className="mt-2">
            <div className="flex items-center gap-2">
              <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                Scale %
              </label>
              <NonCcSlider
                value={customBrushPercent}
                min={5}
                max={1000}
                step={5}
                onChange={(value) => {
                  setCustomBrushSizePercent(value);
                  if (currentTool === 'eraser' && eraserSettings.linkSizeToBrush === false) {
                    const updatedSize =
                      useAppStore.getState().tools.brushSettings.size ?? globalBrushSize;
                    setEraserSettings({ size: updatedSize });
                  }
                }}
                aria-label="Custom Brush Tip Scale (%)"
                className="flex-1"
              />
            </div>
          </div>

          {!isDitherGradient && (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                  Spacing
                </label>
                <NonCcSlider
                  value={activeSettings.spacing}
                  min={1}
                  max={40}
                  step={1}
                  onChange={(value) =>
                    setActiveSettings({ spacing: Math.max(1, Math.round(value)) })
                  }
                  aria-label="Spacing"
                  className="flex-1"
                />
                <VelocityLinkToggle
                  id="velocity-spacing-custom"
                  checked={Boolean(activeSettings.velocitySpacingEnabled)}
                  onChange={(checked) => setActiveSettings({ velocitySpacingEnabled: checked })}
                  title="Link spacing to cursor speed"
                />
              </div>
            </div>
          )}

          {isCustomColorCycleEnabled && (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                  Speed
                </label>
                <NonCcSlider
                  value={activeSettings.colorCycleSpeed ?? MIN_BRUSH_COLOR_CYCLE_SPEED}
                  min={MIN_BRUSH_COLOR_CYCLE_SPEED}
                  max={MAX_BRUSH_COLOR_CYCLE_SPEED}
                  step={COLOR_CYCLE_SPEED_STEP}
                  onChange={(value) =>
                    setActiveSettings({
                      colorCycleSpeed: Math.max(
                        MIN_BRUSH_COLOR_CYCLE_SPEED,
                        Math.min(MAX_BRUSH_COLOR_CYCLE_SPEED, Number(value))
                      ),
                    })
                  }
                  aria-label="Custom Brush Color Cycle Speed"
                  className="flex-1"
                />
                <VelocityLinkToggle
                  id="velocity-animation-speed-custom"
                  checked={Boolean(activeSettings.velocityAnimationSpeedEnabled)}
                  onChange={(checked) =>
                    setActiveSettings({ velocityAnimationSpeedEnabled: checked })
                  }
                  title="Link animation speed to cursor speed"
                />
              </div>
            </div>
          )}

          {isCustomColorCycleEnabled && (
            <div className="mt-2">
              <ButtonGroup
                options={[
                  { label: 'Tip Mode', value: 'tip' },
                  { label: 'Color Cycle Data', value: 'captured-data' },
                ]}
                value={customColorCycleMode}
                onChange={(value) => {
                  const nextMode = value as NonNullable<BrushSettings['customBrushColorCycleMode']>;
                  if (nextMode === 'captured-data' && !hasCapturedColorCyclePayload) {
                    return;
                  }
                  setActiveSettings({
                    customBrushColorCycleMode: nextMode,
                  });
                }}
                size="sm"
                className="w-full"
              />

              {isCapturedDataMode && (
                <div className="mt-2 rounded border border-[#3a3a3a] bg-[#1f1f1f] p-2">
                  <p className="text-xs text-gray-300">
                    {hasCapturedColorCyclePayload ? 'Captured' : 'Not captured'}
                  </p>
                  <p className="text-xs text-gray-500">
                    Map {activeCustomBrushColorCycle?.schemaVersion === 2 ? `${activeCustomBrushColorCycle.mapWidth}x${activeCustomBrushColorCycle.mapHeight}` : 'n/a'}
                  </p>
                  <p className="text-xs text-gray-500">
                    Cycle Length {activeCustomBrushColorCycle?.schemaVersion === 2 ? activeCustomBrushColorCycle.sourceCycleLength : 'n/a'}
                  </p>
                  <p className="text-xs text-gray-500">Alpha Mask captured</p>
                  {!hasCapturedColorCyclePayload && (
                    <p className="mt-2 text-xs text-amber-400">
                      Capture from an active color-cycle layer to use this mode.
                    </p>
                  )}
                </div>
              )}

              {!isCapturedDataMode && (
                <>
                  <GradientEditor
                    sampleTarget="brush"
                    stops={activeSettings.colorCycleGradient || DEFAULT_GRADIENT_STOPS}
                    onChange={(stops) => {
                      scheduleGradientFlush(stops);
                    }}
                    onEditStart={() => {
                      gradientForkRef.current = true;
                    }}
                  />
                  <div className="mt-2">
                    <div className="flex items-center gap-2">
                      <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                        Bands
                      </label>
                      <NonCcSlider
                        value={bandsSlider.value}
                        min={2}
                        max={64}
                        step={1}
                        onChange={(value) => bandsSlider.onChange(Math.round(value))}
                        onCommit={bandsSlider.onCommit}
                        aria-label="Gradient Bands"
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <div className="mt-2">
                    <div className="flex items-center gap-2">
                      <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                        Phase
                      </label>
                      <Dropdown
                        value={activeSettings.customBrushCcPhaseMode ?? 'global'}
                        options={[
                          { value: 'global', label: 'Global' },
                          { value: 'per-stroke-seeded', label: 'Per Stroke' },
                          { value: 'jittered', label: 'Jittered' },
                        ]}
                        onChange={(value) =>
                          setActiveSettings({
                            customBrushCcPhaseMode: value as NonNullable<BrushSettings['customBrushCcPhaseMode']>,
                          })
                        }
                        className="flex-1"
                      />
                    </div>
                  </div>
                  {(activeSettings.customBrushCcPhaseMode ?? 'global') === 'jittered' && (
                    <div className="mt-2">
                      <div className="flex items-center gap-2">
                        <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                          Jitter
                        </label>
                        <NonCcSlider
                          value={activeSettings.customBrushCcPhaseJitter ?? 0}
                          min={0}
                          max={1}
                          step={0.01}
                          onChange={(value) =>
                            setActiveSettings({
                              customBrushCcPhaseJitter: Math.max(0, Math.min(1, Number(value))),
                            })
                          }
                          aria-label="Custom Brush Color Cycle Phase Jitter"
                          className="flex-1"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {isDitherStrokePreset && (
        <div className="mb-2">
          <ButtonGroup
            options={[
              { label: 'Square', value: 'square' },
              { label: 'Round', value: 'round' },
              { label: 'Diamond', value: 'diamond' },
              { label: 'Diamond5', value: 'diamond5' },
              { label: 'Diamond7', value: 'diamond7' },
              { label: 'Diamond9', value: 'diamond9' },
              { label: 'Triangle', value: 'triangle' },
            ]}
            value={activeSettings.ditherStrokeTipShape ?? 'round'}
            onChange={(value) =>
              setActiveSettings({
                ditherStrokeTipShape: value as NonNullable<BrushSettings['ditherStrokeTipShape']>,
              })
            }
            size="sm"
            className="w-full"
          />
        </div>
      )}

      {/* Size */}
      {!isDitherGradient && !isActiveCustomBrush && (
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Size {sizeUnit}
            </label>
            <NonCcSlider
              value={effectiveGlobalBrushSize}
              min={1}
              max={500}
              step={1}
              onChange={(value) => {
                const min = 1;
                const max = 500;
                const next = Math.min(max, Math.max(min, Math.round(value)));
                setGlobalBrushSize(next);
                if (currentTool === 'eraser') {
                  setEraserSettings({ size: next });
                }
              }}
              aria-label={`Brush Size (${sizeUnit})`}
              className="flex-1"
            />
          </div>
        </div>
      )}

      {/* Opacity */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
            Opacity
          </label>
          <NonCcSlider
            value={activeSettings.opacity}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => setActiveSettings({ opacity: value })}
            aria-label="Opacity"
            className="flex-1"
          />
        </div>
      </div>

      {/* Spacing */}
      {!isDitherGradient && !isActiveCustomBrush && (
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Spacing
            </label>
            <NonCcSlider
              value={activeSettings.spacing}
              min={1}
              max={40}
              step={1}
              onChange={(value) =>
                setActiveSettings({ spacing: Math.max(1, Math.round(value)) })
              }
              aria-label="Spacing"
              className="flex-1"
            />
            <VelocityLinkToggle
              id="velocity-spacing-general"
              checked={Boolean(activeSettings.velocitySpacingEnabled)}
              onChange={(checked) => setActiveSettings({ velocitySpacingEnabled: checked })}
              title="Link spacing to cursor speed"
            />
          </div>
        </div>
      )}

      {/* Lost Edge (edge fade) — keep here for non-dither brushes; dither presets show it in Dither controls */}
      {!isDitherPreset && (
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Lostedge
            </label>
            <NonCcSlider
              value={activeSettings.lostEdge ?? 0}
              min={0}
              max={100}
              step={1}
              onChange={(value) =>
                setActiveSettings({
                  lostEdge: Math.max(0, Math.min(100, Math.round(value)))
                })
              }
              aria-label="Lost Edge"
              className="flex-1"
            />
          </div>
        </div>
      )}

      {canDitherForShape(activeSettings.brushShape) && (
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              className={CONTROL_LABEL_CLASS}
              style={CONTROL_LABEL_STYLE}
            >
              Sprd
            </label>
            <NonCcSlider
              value={activeSettings.ditherPaletteSpread ?? 0}
              min={0}
              max={100}
              step={1}
              onChange={(value) =>
                setActiveSettings({
                  ditherPaletteSpread: Math.max(0, Math.min(100, Math.round(value)))
                })
              }
              aria-label="Dither Palette Spread"
              className="flex-1"
            />
          </div>
        </div>
      )}

      {isRegularBrush && (
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="auto-sample-color"
              className={CONTROL_LABEL_CLASS}
              style={CONTROL_LABEL_STYLE}
              title="Pick brush color from the pixel under the cursor (prefers reference layer)"
            >
              Sample
            </label>
            <CustomSwitch
              id="auto-sample-color"
              checked={Boolean(activeSettings.autoSampleColor)}
              onChange={(checked) => setActiveSettings({ autoSampleColor: checked })}
            />
          </div>
        </div>
      )}

      {canDitherForShape(activeSettings.brushShape) && (
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              className={CONTROL_LABEL_CLASS}
              style={CONTROL_LABEL_STYLE}
              title="Keep a solid fill behind dither dots/lines"
            >
              BG Fill
            </label>
            <CustomSwitch
              checked={activeSettings.ditherBackgroundFill !== false}
              onChange={(checked) => setActiveSettings({ ditherBackgroundFill: checked })}
              aria-label="Dither Background Fill"
            />
          </div>
        </div>
      )}

      {canDitherForShape(activeSettings.brushShape) && (
        <DitherControls
          settings={activeSettings}
          onChange={setActiveSettings}
          canToggle
          forceOn={Boolean(capability.forceDither)}
          hideToggle={Boolean(capability.forceDither)}
          isDitherPreset={isDitherPreset}
          hideLostEdge={!isDitherPreset}
          afterPresRes={
            <PigmentLiftControls
              settings={activeSettings}
              onChange={setActiveSettings}
              idSuffix="default"
              Slider={NonCcSlider}
            />
          }
        />
      )}

      <RisoControls
        settings={activeSettings}
        onChange={setActiveSettings}
        idSuffix="default"
        Slider={NonCcSlider}
      />

      {/* Shape Mode - Draw closed polygon shapes */}
      {!hideShapeToggle && (
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="shape-mode"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              {isMosaicPreset ? 'Mode' : 'Shape'}
            </label>
            {isMosaicPreset ? (
              <ButtonGroup
                options={[
                  { label: 'Stroke', value: 'stroke' },
                  { label: 'Shape', value: 'shape' },
                ]}
                value={shapeMode ? 'shape' : 'stroke'}
                onChange={(value) => {
                  setShapeMode(value === 'shape');
                }}
                size="sm"
                className="flex-1"
              />
            ) : (
              <CustomSwitch
                id="shape-mode"
                checked={shapeMode || false}
                onChange={(checked) => {
                  try { console.log('[SHAPE/UI] toggle (default)', { checked }); } catch {}
                  setShapeMode(checked);
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Pressure */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label
            htmlFor="pressure-enabled"
            className="text-[#D9D9D9] w-16"
            style={{ fontSize: "14px" }}
          >
            Pressure
          </label>
          <CustomSwitch
            id="pressure-enabled"
            checked={activeSettings.pressureEnabled || false}
            onChange={(checked) => {
              setActiveSettings({ pressureEnabled: checked });
            }}
          />
            {(activeSettings.pressureEnabled || false) && (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  variant="compact"
                  value={pressureDraft.min}
                  onChange={(e) => handleMinChange(e.target.value)}
                  onFocus={handleMinFocus}
                  onBlur={handleMinBlur}
                  min="1"
                  max="1000"
                  className="w-12 bg-transparent text-right"
                />
                <Input
                  type="number"
                  variant="compact"
                  value={pressureDraft.max}
                  onChange={(e) => handleMaxChange(e.target.value)}
                  onFocus={handleMaxFocus}
                  onBlur={handleMaxBlur}
                  min="1"
                  max="1000"
                  className="w-12 bg-transparent text-right"
                />
              </div>
            )}
        </div>
      </div>

      {/* Rotation - only for stroke brushes */}
      {isStrokeBrush(activeSettings.brushShape || BrushShape.ROUND) && (
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="rotation-enabled"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              Rotation
            </label>
            <CustomSwitch
              id="rotation-enabled"
              checked={activeSettings.rotationEnabled || false}
              onChange={(checked) =>
                setActiveSettings({ rotationEnabled: checked })
              }
            />
          </div>
        </div>
      )}

      {/* Dashed (hidden for Dither Shape) */}
      {(!isDitherShapePreset || isActiveCustomBrush) && (
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="dashed-enabled"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              Dashed
            </label>
            <CustomSwitch
              id="dashed-enabled"
              checked={activeSettings.dashedEnabled || false}
              onChange={(checked) =>
                setActiveSettings({ dashedEnabled: checked })
              }
            />
            {(activeSettings.dashedEnabled || false) && (
              <>
                <span className="text-[#D9D9D9]" style={{ fontSize: "12px" }}>
                  L
                </span>
                  <CommittedNumberInput
                    value={activeSettings.dashLength || 3}
                    onCommit={(next) => setActiveSettings({ dashLength: next })}
                    min={1}
                    max={20}
                    step={0.25}
                    className="w-8 bg-transparent text-right"
                    title="Length units (×brush size)"
                  />
                  <span className="text-[#D9D9D9]" style={{ fontSize: "12px" }}>
                    G
                  </span>
                  <CommittedNumberInput
                    value={activeSettings.dashGap || 2}
                    onCommit={(next) => setActiveSettings({ dashGap: next })}
                    min={1}
                    max={20}
                    step={0.25}
                    className="w-8 bg-transparent text-right"
                    title="Gap units (×brush size)"
                  />
                  <span className="text-[#D9D9D9]" style={{ fontSize: '12px' }}>
                    V
                  </span>
                  <CommittedNumberInput
                    value={activeSettings.velocityDashGapStrength ?? 1}
                    onCommit={(next) => setActiveSettings({ velocityDashGapStrength: next })}
                    min={0}
                    max={10}
                    step={0.25}
                    className="w-8 bg-transparent text-right"
                    title="Speed gap boost strength (0 disables velocity effect)"
                  />
              </>
            )}
          </div>
        </div>
      )}

      {/* Grid Snap */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label
            htmlFor="grid-snap-enabled"
            className="text-[#D9D9D9] w-16"
            style={{ fontSize: "14px" }}
          >
            Grid Snap
          </label>
          <CustomSwitch
            id="grid-snap-enabled"
            checked={activeSettings.gridSnapEnabled || false}
            onChange={(checked) =>
              setActiveSettings({ gridSnapEnabled: checked })
            }
          />
          <Input
            type="number"
            variant="compact"
            value={Math.max(1, Math.round(activeSettings.gridSnapSize ?? 16))}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next)) return;
              setActiveSettings({ gridSnapSize: Math.max(1, Math.min(256, Math.round(next))) });
            }}
            min="1"
            max="256"
            className="w-14 bg-transparent text-right"
            title="Grid size in pixels"
          />
          <span className="text-[#D9D9D9]" style={{ fontSize: '12px' }}>
            px
          </span>
        </div>
      </div>
    </div>
  );
};

export default React.memo(BrushControls);
