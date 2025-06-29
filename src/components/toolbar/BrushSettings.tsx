'use client';

import { useAppStore } from '@/stores/useAppStore';

export const BrushSettings = () => {
  const { brushSettings, setBrushSettings } = useAppStore();

  return (
    <div className="p-3 space-y-4">
      {/* Brush Size */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-white text-xs font-medium">SIZE</label>
          <span className="text-[#888888] text-xs">
            {brushSettings.size}
          </span>
        </div>
        <input
          type="range"
          min="1"
          max="100"
          value={brushSettings.size}
          onChange={(e) => setBrushSettings({ size: parseInt(e.target.value) })}
          className="w-full h-1 bg-[#404040] rounded appearance-none cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer"
        />
      </div>

      {/* Spacing */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-white text-xs font-medium">SPACING</label>
          <span className="text-[#888888] text-xs">
            {brushSettings.dottedStyle.spacing}
          </span>
        </div>
        <input
          type="range"
          min="1"
          max="50"
          value={brushSettings.dottedStyle.spacing}
          onChange={(e) => setBrushSettings({
            dottedStyle: { 
              ...brushSettings.dottedStyle, 
              spacing: parseInt(e.target.value) 
            }
          })}
          className="w-full h-1 bg-[#404040] rounded appearance-none cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer"
        />
      </div>

      {/* Rotation */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-white text-xs font-medium">ROTATION</label>
          <span className="text-[#888888] text-xs">{brushSettings.rotation}°</span>
        </div>
        <input
          type="range"
          min="0"
          max="360"
          value={brushSettings.rotation}
          onChange={(e) => setBrushSettings({ rotation: parseInt(e.target.value) })}
          className="w-full h-1 bg-[#404040] rounded appearance-none cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer"
        />
      </div>

      {/* Pressure */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-white text-xs font-medium">PRESSURE</label>
          <span className="text-[#888888] text-xs">
            {Math.round(brushSettings.opacity * 100)}%
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={brushSettings.opacity}
          onChange={(e) => setBrushSettings({ opacity: parseFloat(e.target.value) })}
          className="w-full h-1 bg-[#404040] rounded appearance-none cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer"
        />
      </div>

    </div>
  );
};