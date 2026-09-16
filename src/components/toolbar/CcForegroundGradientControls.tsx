import React from 'react';

import ProgressSlider from '@/components/ui/ProgressSlider';

type SliderState = {
  value: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
};

type CcForegroundGradientControlsProps = {
  fgColor: string;
  foregroundDerivedCss: string;
  contrastSlider: SliderState;
  colorsSlider: SliderState;
  labelClassName: string;
  labelStyle: React.CSSProperties;
};

export const CcForegroundGradientControls = ({
  fgColor,
  foregroundDerivedCss,
  contrastSlider,
  colorsSlider,
  labelClassName,
  labelStyle,
}: CcForegroundGradientControlsProps) => (
  <div className="mb-3">
    <div className="flex items-center justify-between text-xs text-[#D9D9D9] mb-1">
      <span>Foreground Gradient</span>
      <span className="text-[#A0A0A0]">{fgColor.toUpperCase()}</span>
    </div>
    <div
      aria-label="Foreground gradient preview"
      className="h-6 rounded border border-white/10"
      style={{ background: foregroundDerivedCss }}
    />
    <div className="flex items-center gap-2 mt-2">
      <label className={labelClassName} style={labelStyle}>Contrast</label>
      <ProgressSlider
        {...contrastSlider}
        min={0}
        max={100}
        step={1}
        aria-label="Foreground Gradient Contrast"
        className="flex-1"
      />
    </div>
    <div className="flex items-center gap-2 mt-2">
      <label className={labelClassName} style={labelStyle}>Colours</label>
      <ProgressSlider
        {...colorsSlider}
        min={2}
        max={16}
        step={1}
        aria-label="Foreground Gradient Colours"
        className="flex-1"
      />
    </div>
  </div>
);
