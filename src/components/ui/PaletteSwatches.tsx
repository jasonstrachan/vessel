import React from 'react';

interface PaletteSwatchesProps {
  foregroundColor: string;
  backgroundColor: string;
  activeSlot: 'foreground' | 'background';
  onSelect: (slot: 'foreground' | 'background') => void;
}

const clampColor = (value: string): string => {
  if (!value) {
    return '#000000';
  }
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === 'transparent') {
    return 'rgba(0,0,0,0)';
  }
  return trimmed;
};

const outlineColorFor = (color: string): string => {
  const normalized = color.trim().toLowerCase();
  const hexMatch = normalized.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const value = hexMatch[1];
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    return brightness > 200 ? '#111111' : '#FFFFFF';
  }

  const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1]
      .split(',')
      .map((part) => Number.parseFloat(part.trim()))
      .filter((component, index) => index < 3 && Number.isFinite(component));
    if (parts.length === 3) {
      const [r, g, b] = parts;
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      return brightness > 200 ? '#111111' : '#FFFFFF';
    }
  }

  return '#FFFFFF';
};

const buttonBase =
  'flex h-8 w-8 items-center justify-center border border-[#2F2F2F] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

const PaletteSwatches = function PaletteSwatches({
  foregroundColor,
  backgroundColor,
  activeSlot,
  onSelect
}: PaletteSwatchesProps) {
  const renderSwatch = (color: string, slot: 'foreground' | 'background', label: string) => {
    const background = clampColor(color);
    const isActive = activeSlot === slot;
    const outlineColor = outlineColorFor(background);
    const activeStyle = isActive
      ? { boxShadow: `0 0 0 2px ${outlineColor}` }
      : undefined;

    return (
      <button
        key={slot}
        type="button"
        className={`${buttonBase}`}
        style={{ backgroundColor: background, ...activeStyle }}
        onClick={() => onSelect(slot)}
        aria-label={`Select ${label} color swatch`}
        aria-pressed={isActive}
        title={`${label} color`}
      />
    );
  };

  return (
    <div className="flex w-8 flex-col items-center gap-0 py-1">
      {renderSwatch(foregroundColor, 'foreground', 'foreground')}
      {renderSwatch(backgroundColor, 'background', 'background')}
    </div>
  );
};

PaletteSwatches.displayName = 'PaletteSwatches';

export default PaletteSwatches;
