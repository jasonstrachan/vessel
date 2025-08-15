import React, { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { getMostUsedColors } from '../../utils/colorAnalysis';

interface ColorSwatchesProps {
  onColorSelect: (color: string) => void;
  currentColor: string;
}

const ColorSwatches = React.memo(({ onColorSelect }: ColorSwatchesProps) => {
  // Optimize subscription - only subscribe to project
  const project = useAppStore(state => state.project);
  const [swatchColors, setSwatchColors] = useState<string[]>(() => {
    // Initialize with default colors immediately
    return getMostUsedColors(null, 10);
  });

  useEffect(() => {
    // Update color swatches when project changes
    const colors = getMostUsedColors(project, 10);
    setSwatchColors(colors);
  }, [project]);

  // Memoize color selection handler
  const handleColorSelect = useCallback((color: string) => {
    onColorSelect(color);
  }, [onColorSelect]);

  return (
    <div className="flex w-full">
      {swatchColors.map((color, index) => (
        <button
          key={`${color}-${index}`}
          onClick={() => handleColorSelect(color)}
          className="flex-1 h-6 focus:outline-none"
          style={{ backgroundColor: color }}
          title={`Use color ${color}`}
          aria-label={`Select color ${color}`}
        />
      ))}
    </div>
  );
});

ColorSwatches.displayName = 'ColorSwatches';

export default ColorSwatches;