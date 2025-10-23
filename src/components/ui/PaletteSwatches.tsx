import React from 'react';

interface PaletteSwatchesProps {
  foregroundColor: string;
  backgroundColor: string;
  activeSlot: 'foreground' | 'background';
  onSelect: (slot: 'foreground' | 'background') => void;
}

const PaletteSwatches = function PaletteSwatches({
  foregroundColor,
  backgroundColor,
  activeSlot,
  onSelect
}: PaletteSwatchesProps) {
  return (
    <div className="flex h-full min-h-[60px] w-12 flex-col gap-0">
      <div className="relative flex-1">
        <button
          type="button"
          className="h-full w-full cursor-pointer focus-visible:outline-none"
          style={{ backgroundColor: foregroundColor }}
          onClick={() => onSelect('foreground')}
          aria-label="Select foreground color swatch"
          aria-pressed={activeSlot === 'foreground'}
          title="Foreground color"
        />
        {activeSlot === 'foreground' ? (
          <span className="pointer-events-none absolute -inset-px border border-white" />
        ) : null}
      </div>
      <div className="relative flex-1">
        <button
          type="button"
          className="h-full w-full cursor-pointer focus-visible:outline-none"
          style={{ backgroundColor: backgroundColor }}
          onClick={() => onSelect('background')}
          aria-label="Select background color swatch"
          aria-pressed={activeSlot === 'background'}
          title="Background color"
        />
        {activeSlot === 'background' ? (
          <span className="pointer-events-none absolute -inset-px border border-white" />
        ) : null}
      </div>
    </div>
  );
};

PaletteSwatches.displayName = 'PaletteSwatches';

export default PaletteSwatches;
