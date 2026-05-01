import React from 'react';

import ProgressSlider from '@/components/ui/ProgressSlider';
import type { BrushSettings } from '@/types';

type SliderState = {
  value: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
};

type SliderComponent = React.ComponentType<React.ComponentProps<typeof ProgressSlider>>;

type CcForegroundGradientControlsProps = {
  fgColor: string;
  foregroundDerivedCss: string;
  showColorCycleBands: boolean;
  bandsSlider: SliderState;
  fgDerivedLightness: number;
  fgDerivedHueShift: number;
  fgDerivedSaturationShift: number;
  fgOpacitySlider: SliderState;
  fgStopsSlider: SliderState;
  NonCcSlider: SliderComponent;
  labelClassName: string;
  labelStyle: React.CSSProperties;
  setActiveSettings: (settings: Partial<BrushSettings>) => void;
  clampFgLightness: (value: number) => number;
  clampFgHueShift: (value: number) => number;
  clampFgSatShift: (value: number) => number;
};

export const CcForegroundGradientControls = ({
  fgColor,
  foregroundDerivedCss,
  showColorCycleBands,
  bandsSlider,
  fgDerivedLightness,
  fgDerivedHueShift,
  fgDerivedSaturationShift,
  fgOpacitySlider,
  fgStopsSlider,
  NonCcSlider,
  labelClassName,
  labelStyle,
  setActiveSettings,
  clampFgLightness,
  clampFgHueShift,
  clampFgSatShift,
}: CcForegroundGradientControlsProps) => (
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
        <label className={labelClassName} style={labelStyle}>
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
    <div className="mt-3">
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label className={labelClassName} style={labelStyle}>
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
          <label className={labelClassName} style={labelStyle}>
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
          <label className={labelClassName} style={labelStyle}>
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
          <label className={labelClassName} style={labelStyle}>
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
          <label className={labelClassName} style={labelStyle}>
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
  </div>
);
