import React from 'react';
import { Switch } from '@/components/retroui/Switch';
import ProgressSlider from '@/components/ui/ProgressSlider';
import { useAppStore } from '@/stores/useAppStore';
import type { DisplayFilterConfig, DisplayFilterId } from '@/types';

const FILTER_COPY: Record<
  DisplayFilterId,
  {
    title: string;
    summary: string;
  }
> = {
  pixelate: {
    title: 'Pixelate',
    summary: 'Nearest-neighbor block enlargement.',
  },
  bloom: {
    title: 'Bloom',
    summary: 'Low-intensity softness over the pixel base.',
  },
  'color-grade': {
    title: 'Color Grade',
    summary: 'Brightness, contrast, and saturation shaping.',
  },
  'lcd-mask': {
    title: 'LCD Mask',
    summary: 'RGB stripe texture with optional scanline banding.',
  },
  noise: {
    title: 'Noise',
    summary: 'Cached grain layered over the glass.',
  },
};

interface FilterCardProps {
  filter: DisplayFilterConfig;
}

const FilterCard = ({ filter }: FilterCardProps) => {
  const setDisplayFilterEnabled = useAppStore((state) => state.setDisplayFilterEnabled);
  const updateDisplayFilter = useAppStore((state) => state.updateDisplayFilter);
  const copy = FILTER_COPY[filter.id];
  const bodyClassName = filter.enabled ? 'opacity-100' : 'opacity-45';

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
          <p className="mt-1 text-[11px] leading-4 text-[#8F8F8F]">{copy.summary}</p>
        </div>
        <Switch
          id={`display-filter-toggle-${filter.id}`}
          checked={filter.enabled}
          onChange={(checked) => setDisplayFilterEnabled(filter.id, checked)}
          aria-label={`${copy.title} enabled`}
        />
      </div>

      <div className={`mt-3 space-y-3 ${bodyClassName}`}>
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
                max={1}
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
      </div>
    </section>
  );
};

export const DisplayFiltersSection = () => {
  const displayFilters = useAppStore((state) => state.canvas.displayFilters);

  return (
    <div>
      {displayFilters.map((filter, index) => (
        <React.Fragment key={filter.id}>
          {index > 0 && <div className="border-t border-[#2E2E2E]" aria-hidden="true" />}
          <FilterCard filter={filter} />
        </React.Fragment>
      ))}
    </div>
  );
};
