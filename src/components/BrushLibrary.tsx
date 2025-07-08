import React from 'react';
import { useAppStore } from '../stores/useAppStore';

const BrushLibrary = () => {
  const brushPresets = useAppStore((state) => state.brushPresets);
  const currentBrushPreset = useAppStore((state) => state.currentBrushPreset);
  const setBrushPreset = useAppStore((state) => state.setBrushPreset);
  
  console.log('BrushLibrary - brushPresets:', brushPresets);
  console.log('BrushLibrary - currentBrushPreset:', currentBrushPreset);

  return (
    <div className="flex-1 border-b border-[#404040] flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 bg-[#353535] border-b border-[#404040]">
        <span className="text-base font-medium">Brush Library</span>
        <button className="text-sm bg-[#404040] px-2 py-1 rounded">+</button>
      </div>
      
      <div className="flex-1 p-2 space-y-1 overflow-y-auto">
        {brushPresets.map((preset) => (
          <div
            key={preset.id}
            onClick={() => setBrushPreset(preset)}
            className={`flex items-center justify-between px-2 py-1 rounded cursor-pointer transition-colors ${
              currentBrushPreset?.id === preset.id 
                ? 'bg-[#505050] border border-[#606060]' 
                : 'hover:bg-[#404040] border border-transparent'
            }`}
          >
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 bg-[#606060] rounded-sm flex items-center justify-center text-xs">
                {preset.category === 'Pixel Art' ? '▪' : '●'}
              </div>
              <span className="text-sm">{preset.name}</span>
            </div>
            <div className="flex items-center space-x-1">
              <span className="text-sm text-gray-400">
                {preset.isDefault ? '★' : '☆'}
              </span>
              <button className="text-sm text-[#888] hover:text-white" onClick={(e) => e.stopPropagation()}>✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BrushLibrary;