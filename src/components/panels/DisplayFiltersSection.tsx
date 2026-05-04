import React from 'react';
import { Switch } from '@/components/retroui/Switch';
import Dropdown from '@/components/ui/Dropdown';
import ProgressSlider from '@/components/ui/ProgressSlider';
import { useAppStore } from '@/stores/useAppStore';
import type { DisplayFilterConfig, DisplayFilterId } from '@/types';
import type { ColorCycleSoftEdgeDitherAlgorithm } from '@/utils/colorCycleSoftEdgeMask';

const FILTER_COPY: Record<
  DisplayFilterId,
  {
    title: string;
  }
> = {
  pixelate: {
    title: 'Pixelate',
  },
  'round-pixels': {
    title: 'Round Pixels',
  },
  bloom: {
    title: 'Bloom',
  },
  'color-grade': {
    title: 'Color Grade',
  },
  'lcd-mask': {
    title: 'LCD Mask',
  },
  crt: {
    title: 'CRT',
  },
  'crt-grid': {
    title: 'CRT Grid',
  },
  'chromatic-aberration': {
    title: 'Chromatic Aberration',
  },
  noise: {
    title: 'Noise',
  },
  'film-noise': {
    title: 'Film Noise',
  },
};

const CC_SOFT_EDGE_DITHER_OPTIONS: Array<{ value: ColorCycleSoftEdgeDitherAlgorithm; label: string }> = [
  { value: 'sierra-lite', label: 'Sierra Lite' },
  { value: 'ordered', label: 'Ordered' },
];
const DEFAULT_CC_SOFT_EDGE_DITHER_ALGORITHM: ColorCycleSoftEdgeDitherAlgorithm = 'sierra-lite';

interface FilterCardProps {
  filter: DisplayFilterConfig;
}

const FilterCard = ({ filter }: FilterCardProps) => {
  const setDisplayFilterEnabled = useAppStore((state) => state.setDisplayFilterEnabled);
  const updateDisplayFilter = useAppStore((state) => state.updateDisplayFilter);
  const copy = FILTER_COPY[filter.id];

  return (
    <section
      className="py-3"
      aria-labelledby={`display-filter-${filter.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 id={`display-filter-${filter.id}`} className="text-sm font-medium text-[#E5E5E5]">
            {copy.title}
          </h4>
        </div>
        <Switch
          id={`display-filter-toggle-${filter.id}`}
          checked={filter.enabled}
          onChange={(checked) => setDisplayFilterEnabled(filter.id, checked)}
          aria-label={`${copy.title} enabled`}
        />
      </div>

      {filter.enabled && (
        <div className="mt-3 space-y-3">
        {filter.id === 'pixelate' && (
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
              Cell Size
            </label>
            <ProgressSlider
              value={filter.settings.cellSize}
              min={1}
              max={24}
              step={1}
              onChange={(value) => updateDisplayFilter('pixelate', { cellSize: Math.round(value) })}
              aria-label="Pixelate cell size"
            />
          </div>
        )}

        {filter.id === 'round-pixels' && (
          <>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Blur Radius
              </label>
              <ProgressSlider
                value={filter.settings.blurRadius}
                min={0}
                max={12}
                step={0.25}
                onChange={(value) => updateDisplayFilter('round-pixels', { blurRadius: value })}
                aria-label="Round pixels blur radius"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Threshold
              </label>
              <ProgressSlider
                value={filter.settings.threshold}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('round-pixels', { threshold: value })}
                aria-label="Round pixels threshold"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Levels Crush
              </label>
              <ProgressSlider
                value={filter.settings.crush}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('round-pixels', { crush: value })}
                aria-label="Round pixels levels crush"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Preserve Color
              </label>
              <ProgressSlider
                value={filter.settings.preserveColor}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('round-pixels', { preserveColor: value })}
                aria-label="Round pixels preserve color"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
          </>
        )}

        {filter.id === 'bloom' && (
          <>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Blur Radius
              </label>
              <ProgressSlider
                value={filter.settings.blurRadius}
                min={0}
                max={12}
                step={0.5}
                onChange={(value) => updateDisplayFilter('bloom', { blurRadius: value })}
                aria-label="Bloom blur radius"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Intensity
              </label>
              <ProgressSlider
                value={filter.settings.intensity}
                min={0}
                max={2}
                step={0.01}
                onChange={(value) => updateDisplayFilter('bloom', { intensity: value })}
                aria-label="Bloom intensity"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
          </>
        )}

        {filter.id === 'color-grade' && (
          <>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Brightness
              </label>
              <ProgressSlider
                value={filter.settings.brightness}
                min={-1}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('color-grade', { brightness: value })}
                aria-label="Color grade brightness"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Contrast
              </label>
              <ProgressSlider
                value={filter.settings.contrast}
                min={-1}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('color-grade', { contrast: value })}
                aria-label="Color grade contrast"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Saturation
              </label>
              <ProgressSlider
                value={filter.settings.saturation}
                min={0}
                max={2}
                step={0.01}
                onChange={(value) => updateDisplayFilter('color-grade', { saturation: value })}
                aria-label="Color grade saturation"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
          </>
        )}

        {filter.id === 'lcd-mask' && (
          <>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Stripe Opacity
              </label>
              <ProgressSlider
                value={filter.settings.stripeOpacity}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('lcd-mask', { stripeOpacity: value })}
                aria-label="LCD mask stripe opacity"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Scanline Opacity
              </label>
              <ProgressSlider
                value={filter.settings.scanlineOpacity}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('lcd-mask', { scanlineOpacity: value })}
                aria-label="LCD mask scanline opacity"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
          </>
        )}

        {filter.id === 'crt' && (
          <>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Cell Size
              </label>
              <ProgressSlider
                value={filter.settings.cellSize}
                min={1}
                max={32}
                step={1}
                onChange={(value) => updateDisplayFilter('crt', { cellSize: Math.round(value) })}
                aria-label="CRT cell size"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Scanline Depth
              </label>
              <ProgressSlider
                value={filter.settings.scanlineIntensity}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('crt', { scanlineIntensity: value })}
                aria-label="CRT scanline depth"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Mask Strength
              </label>
              <ProgressSlider
                value={filter.settings.maskIntensity}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('crt', { maskIntensity: value })}
                aria-label="CRT mask strength"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Distortion
              </label>
              <ProgressSlider
                value={filter.settings.barrelDistortion}
                min={0}
                max={0.4}
                step={0.01}
                onChange={(value) => updateDisplayFilter('crt', { barrelDistortion: value })}
                aria-label="CRT distortion"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Chromatic Split
              </label>
              <ProgressSlider
                value={filter.settings.chromaticAberration}
                min={0}
                max={8}
                step={0.25}
                onChange={(value) => updateDisplayFilter('crt', { chromaticAberration: value })}
                aria-label="CRT chromatic split"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Beam Focus
              </label>
              <ProgressSlider
                value={filter.settings.beamFocus}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('crt', { beamFocus: value })}
                aria-label="CRT beam focus"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Brightness
              </label>
              <ProgressSlider
                value={filter.settings.brightness}
                min={0}
                max={1.5}
                step={0.01}
                onChange={(value) => updateDisplayFilter('crt', { brightness: value })}
                aria-label="CRT brightness"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Shadow Lift
              </label>
              <ProgressSlider
                value={filter.settings.shadowLift}
                min={0}
                max={0.5}
                step={0.01}
                onChange={(value) => updateDisplayFilter('crt', { shadowLift: value })}
                aria-label="CRT shadow lift"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Vignette
              </label>
              <ProgressSlider
                value={filter.settings.vignetteIntensity}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('crt', { vignetteIntensity: value })}
                aria-label="CRT vignette"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Flicker
              </label>
              <ProgressSlider
                value={filter.settings.flickerIntensity}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('crt', { flickerIntensity: value })}
                aria-label="CRT flicker"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Signal Artifacts
              </label>
              <ProgressSlider
                value={filter.settings.signalArtifacts}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('crt', { signalArtifacts: value })}
                aria-label="CRT signal artifacts"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Bloom Intensity
              </label>
              <ProgressSlider
                value={filter.settings.bloomIntensity}
                min={0}
                max={4}
                step={0.01}
                onChange={(value) => updateDisplayFilter('crt', { bloomIntensity: value })}
                aria-label="CRT bloom intensity"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Bloom Radius
              </label>
              <ProgressSlider
                value={filter.settings.bloomRadius}
                min={0}
                max={32}
                step={0.5}
                onChange={(value) => updateDisplayFilter('crt', { bloomRadius: value })}
                aria-label="CRT bloom radius"
              />
            </div>
          </>
        )}

        {filter.id === 'noise' && (
          <>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Opacity
              </label>
              <ProgressSlider
                value={filter.settings.opacity}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('noise', { opacity: value })}
                aria-label="Noise opacity"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Scale
              </label>
              <ProgressSlider
                value={filter.settings.scale}
                min={1}
                max={8}
                step={0.5}
                onChange={(value) => updateDisplayFilter('noise', { scale: value })}
                aria-label="Noise scale"
              />
            </div>
          </>
        )}

        {filter.id === 'film-noise' && (
          <>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Opacity
              </label>
              <ProgressSlider
                value={filter.settings.opacity}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('film-noise', { opacity: value })}
                aria-label="Film noise opacity"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Grain Size
              </label>
              <ProgressSlider
                value={filter.settings.scale}
                min={1}
                max={8}
                step={0.25}
                onChange={(value) => updateDisplayFilter('film-noise', { scale: value })}
                aria-label="Film noise grain size"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Shadow Bias
              </label>
              <ProgressSlider
                value={filter.settings.shadowBias}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('film-noise', { shadowBias: value })}
                aria-label="Film noise shadow bias"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
          </>
        )}

        {filter.id === 'crt-grid' && (
          <>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Mask Strength
              </label>
              <ProgressSlider
                value={filter.settings.lineOpacity}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('crt-grid', { lineOpacity: value })}
                aria-label="CRT grid line opacity"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Line Spacing
              </label>
              <ProgressSlider
                value={filter.settings.lineSpacing}
                min={1}
                max={16}
                step={1}
                onChange={(value) => updateDisplayFilter('crt-grid', { lineSpacing: Math.round(value) })}
                aria-label="CRT grid line spacing"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Phosphor Glow
              </label>
              <ProgressSlider
                value={filter.settings.phosphorOpacity}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('crt-grid', { phosphorOpacity: value })}
                aria-label="CRT grid phosphor glow"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Scanline Depth
              </label>
              <ProgressSlider
                value={filter.settings.scanlineOpacity}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('crt-grid', { scanlineOpacity: value })}
                aria-label="CRT grid scanline depth"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
          </>
        )}

        {filter.id === 'chromatic-aberration' && (
          <>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Offset
              </label>
              <ProgressSlider
                value={filter.settings.offset}
                min={0}
                max={12}
                step={0.25}
                onChange={(value) => updateDisplayFilter('chromatic-aberration', { offset: value })}
                aria-label="Chromatic aberration offset"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Intensity
              </label>
              <ProgressSlider
                value={filter.settings.intensity}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateDisplayFilter('chromatic-aberration', { intensity: value })}
                aria-label="Chromatic aberration intensity"
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
          </>
        )}
        </div>
      )}
    </section>
  );
};

const ColorCycleSoftEdgeMaskControls = () => {
  const activeLayerId = useAppStore((state) => state.activeLayerId);
  const activeLayer = useAppStore((state) => state.layers?.find((layer) => layer.id === state.activeLayerId));
  const applyColorCycleSoftEdgeMask = useAppStore((state) => state.applyColorCycleSoftEdgeMask ?? (async () => false));
  const setColorCycleSoftEdgeMaskEnabled = useAppStore((state) => state.setColorCycleSoftEdgeMaskEnabled ?? (() => undefined));
  const [radius, setRadius] = React.useState(16);
  const radiusRef = React.useRef(radius);
  const [ditherSize, setDitherSize] = React.useState(1);
  const ditherSizeRef = React.useRef(ditherSize);
  const [ditherAlgorithm, setDitherAlgorithm] = React.useState<ColorCycleSoftEdgeDitherAlgorithm>(
    DEFAULT_CC_SOFT_EDGE_DITHER_ALGORITHM,
  );
  const ditherAlgorithmRef = React.useRef<ColorCycleSoftEdgeDitherAlgorithm>(ditherAlgorithm);
  const [isApplying, setIsApplying] = React.useState(false);
  const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
  const hasMask = Boolean(activeLayer?.colorCycleData?.softEdgeMaskImageData || activeLayer?.colorCycleData?.softEdgeMask);
  const isEnabled = hasMask && activeLayer?.colorCycleData?.softEdgeMaskEnabled !== false;
  const canEdit = Boolean(activeLayerId && isColorCycleLayer && !isApplying);

  if (!isColorCycleLayer && !hasMask) {
    return null;
  }

  const applyCurrentMask = async (
    nextRadius = radiusRef.current,
    nextDitherSize = ditherSizeRef.current,
    nextDitherAlgorithm = ditherAlgorithmRef.current,
  ) => {
    if (!activeLayerId || !canEdit) {
      return;
    }
    setIsApplying(true);
    try {
      await applyColorCycleSoftEdgeMask(
        activeLayerId,
        nextRadius,
        nextDitherSize,
        nextDitherAlgorithm,
      );
    } finally {
      setIsApplying(false);
    }
  };

  const handleRadiusChange = (value: number) => {
    const nextRadius = Math.round(value);
    radiusRef.current = nextRadius;
    setRadius(nextRadius);
  };

  const handleDitherSizeChange = (value: number) => {
    const nextDitherSize = Math.round(value);
    ditherSizeRef.current = nextDitherSize;
    setDitherSize(nextDitherSize);
  };

  const handleDitherAlgorithmChange = (value: string) => {
    const nextAlgorithm = value as ColorCycleSoftEdgeDitherAlgorithm;
    ditherAlgorithmRef.current = nextAlgorithm;
    setDitherAlgorithm(nextAlgorithm);
    if (hasMask || isEnabled) {
      void applyCurrentMask(radiusRef.current, ditherSizeRef.current, nextAlgorithm);
    }
  };

  const handleMaskSliderCommit = () => {
    if (hasMask || isEnabled) {
      void applyCurrentMask();
    }
  };

  const handleToggle = (checked: boolean) => {
    if (!activeLayerId || !isColorCycleLayer || isApplying) {
      return;
    }
    if (checked) {
      if (hasMask) {
        setColorCycleSoftEdgeMaskEnabled(activeLayerId, true);
      } else {
        void applyCurrentMask();
      }
      return;
    }
    setColorCycleSoftEdgeMaskEnabled(activeLayerId, false);
  };

  return (
    <>
      <section className="py-3" aria-labelledby="cc-soft-edge-mask-controls">
        <div className="flex items-start justify-between gap-3">
          <h4 id="cc-soft-edge-mask-controls" className="text-sm font-medium text-[#E5E5E5]">
            CC Edge Mask
          </h4>
          <Switch
            id="cc-soft-edge-mask-toggle"
            checked={isEnabled}
            onChange={handleToggle}
            aria-label="CC soft edge enabled"
          />
        </div>
        {(isColorCycleLayer || hasMask) && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Edge Width
              </label>
              <ProgressSlider
                value={radius}
                min={0}
                max={64}
                step={1}
                onChange={handleRadiusChange}
                onCommit={handleMaskSliderCommit}
                aria-label="Color cycle dither edge mask width"
                disabled={!canEdit}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Edge Dither
              </label>
              <Dropdown
                value={ditherAlgorithm}
                options={CC_SOFT_EDGE_DITHER_OPTIONS}
                onChange={handleDitherAlgorithmChange}
                className="w-full"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8F8F8F]">
                Dither Size
              </label>
              <ProgressSlider
                value={ditherSize}
                min={1}
                max={16}
                step={1}
                onChange={handleDitherSizeChange}
                onCommit={handleMaskSliderCommit}
                aria-label="Color cycle soft edge dither size"
                disabled={!canEdit}
              />
            </div>
            <button
              type="button"
              className="w-full rounded border border-[#3A3A3A] bg-[#242424] px-3 py-1.5 text-xs font-medium text-[#E5E5E5] transition hover:border-[#4A4A4A] hover:bg-[#2A2A2A] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void applyCurrentMask()}
              disabled={!canEdit}
            >
              {isApplying ? 'Saving...' : hasMask ? 'Refresh Mask' : 'Save Mask'}
            </button>
          </div>
        )}
      </section>
      <div className="border-t border-[#2E2E2E]" aria-hidden="true" />
    </>
  );
};

export const DisplayFiltersSection = () => {
  const displayFilters = useAppStore((state) => state.canvas.displayFilters);

  return (
    <div>
      <ColorCycleSoftEdgeMaskControls />
      {displayFilters.map((filter, index) => (
        <React.Fragment key={filter.id}>
          {index > 0 && <div className="border-t border-[#2E2E2E]" aria-hidden="true" />}
          <FilterCard filter={filter} />
        </React.Fragment>
      ))}
    </div>
  );
};
