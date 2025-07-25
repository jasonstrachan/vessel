import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { getMostUsedColors } from '../../utils/colorAnalysis';

interface ColorSwatchesProps {
  onColorSelect: (color: string) => void;
  currentColor: string;
}

export default function ColorSwatches({ onColorSelect, currentColor }: ColorSwatchesProps) {
  const { project } = useAppStore();
  const [swatchColors, setSwatchColors] = useState<string[]>(() => {
    // Initialize with default colors immediately
    return getMostUsedColors(null, 10);
  });

  useEffect(() => {
    // Update color swatches when project changes
    const colors = getMostUsedColors(project, 10);
    setSwatchColors(colors);
  }, [project]);

  return (
    <div className="flex w-full">
      {swatchColors.map((color, index) => (
        <button
          key={`${color}-${index}`}
          onClick={() => onColorSelect(color)}
          className={`
            flex-1 h-6 border transition-all duration-150 hover:scale-110 focus:outline-none
            ${currentColor.toLowerCase() === color.toLowerCase() 
              ? 'border-white shadow-lg scale-110 z-10 relative' 
              : 'border-[#65656A] hover:border-[#88888A]'
            }
          `}
          style={{ backgroundColor: color }}
          title={`Use color ${color}`}
          aria-label={`Select color ${color}`}
        />
      ))}
    </div>
  );
}