import React from 'react';
import { useAppStore } from '../stores/useAppStore';

const BrushLibrary = () => {
  const brushPresets = useAppStore((state) => state.brushPresets);
  const currentBrushPreset = useAppStore((state) => state.currentBrushPreset);
  const setBrushPreset = useAppStore((state) => state.setBrushPreset);

  return (
    <div className="h-full flex flex-col bg-[#31313A]">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-base font-medium">Brush Library</span>
        <span className="text-xs text-[#888]">{brushPresets.length} brushes</span>
      </div>
      
      
      <div className="flex-1 p-4 space-y-1 overflow-y-auto">
        {brushPresets.map((preset) => (
          <div
            key={preset.id}
            onClick={() => setBrushPreset(preset)}
            className={`flex items-center justify-between px-2 py-1 cursor-pointer transition-colors ${
              currentBrushPreset?.id === preset.id 
                ? 'bg-[#505050]' 
                : 'hover:bg-[#404040]'
            }`}
          >
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 bg-[#606060] rounded-sm flex items-center justify-center text-xs">
                {preset.category === 'Pixel Art' ? '▪' : '●'}
              </div>
              <span className="text-sm">{preset.name}</span>
            </div>
            <div className="flex items-center space-x-1">
              <span className="text-sm text-[#888]">
                {preset.isDefault ? '★' : '☆'}
              </span>
            </div>
          </div>
        ))}
        
      </div>
    </div>
  );
};

export default BrushLibrary;