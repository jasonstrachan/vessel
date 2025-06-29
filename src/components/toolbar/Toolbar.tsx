'use client';

import { useAppStore } from '@/stores/useAppStore';
import { HSVColorPicker } from './HSVColorPicker';
import { BrushSettings } from './BrushSettings';

export const Toolbar = () => {
  const { brushSettings, setBrushSettings } = useAppStore();


  return (
    <div className="w-72 bg-[#2a2a2a] border-r border-[#404040] flex flex-col">
      {/* Color Section */}
      <div className="p-3 border-b border-[#404040]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-white text-xs font-medium">COLOR</span>
        </div>
        <HSVColorPicker
          color={brushSettings.color}
          onChange={(color) => setBrushSettings({ color })}
        />
      </div>


      {/* Brush Settings */}
      <div className="flex-1 overflow-y-auto">
        <BrushSettings />
      </div>
    </div>
  );
};