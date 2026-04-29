import React from 'react';
import { render, screen } from '@testing-library/react';
import DitherControls, { DITHER_OPTIONS } from '../DitherControls';
import type { BrushSettings } from '@/types';

const baseSettings: BrushSettings = {
  size: 1,
  opacity: 1,
  color: '#000',
  blendMode: 'source-over',
  spacing: 1,
  pressure: 1,
  rotation: 0,
  antialiasing: false,
  dashedEnabled: false,
  dashLength: 3,
  dashGap: 2,
  gridSnapEnabled: false,
  shapeEnabled: false,
  colorJitter: 0,
  risographIntensity: 0,
  risographOutline: false,
  ditherEnabled: true,
  pressureLinkedFillResolution: false,
  pressureEnabled: false,
  minPressure: 1,
  maxPressure: 1000,
  rotationEnabled: false,
  useSwatchColor: false,
  flow: 1,
  lastRegularBrushSize: 1,
  fillResolution: 1,
};

describe('DitherControls', () => {
  it('hides toggle when forceOn + hideToggle', () => {
    render(
      <DitherControls
        settings={baseSettings}
        onChange={() => {}}
        canToggle
        forceOn
        hideToggle
      />
    );
    expect(screen.queryByText(/Always on/i)).toBeNull();
  });

  it('shows dropdown when enabled', () => {
    render(
      <DitherControls
        settings={baseSettings}
        onChange={() => {}}
        canToggle
        forceOn={false}
      />
    );
    expect(screen.getByText(/Sierra Lite/i)).toBeInTheDocument();
  });

  it('orders Bayer and Pattern directly after Sierra 3-row', () => {
    expect(DITHER_OPTIONS.map((option) => option.value).slice(0, 5)).toEqual([
      'sierra-lite',
      'sierra-2',
      'sierra-3',
      'bayer',
      'pattern',
    ]);
  });
});
// @ts-nocheck
