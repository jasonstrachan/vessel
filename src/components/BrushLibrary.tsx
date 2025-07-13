import React from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushShape, BrushPreset } from '../types';

const BrushLibrary = () => {
  const brushPresets = useAppStore((state) => state.brushPresets);
  const currentBrushPreset = useAppStore((state) => state.currentBrushPreset);
  const setBrushPreset = useAppStore((state) => state.setBrushPreset);
  const setBrushSettings = useAppStore((state) => state.setBrushSettings);
  const saveCustomBrushAsPreset = useAppStore((state) => state.saveCustomBrushAsPreset);
  const tools = useAppStore((state) => state.tools);
  const project = useAppStore((state) => state.project);
  
  // Check if there's an active custom brush that can be saved
  const activeCustomBrush = tools.brushSettings.selectedCustomBrush && project
    ? project.customBrushes.find(b => b.id === tools.brushSettings.selectedCustomBrush)
    : null;
  
  const canSaveCustomBrush = activeCustomBrush && tools.brushSettings.brushShape === BrushShape.CUSTOM;
  
  const handleSaveCustomBrushAsPreset = () => {
    if (!activeCustomBrush) return;
    
    saveCustomBrushAsPreset(activeCustomBrush.id);
  };
  
  const handlePresetClick = (preset: BrushPreset) => {
    if (preset.isCustomBrush && preset.customBrushData) {
      // For custom brush presets, set the brush settings to use custom brush
      setBrushSettings({
        brushShape: BrushShape.CUSTOM,
        selectedCustomBrush: preset.id // Use the preset ID as the custom brush ID
      });
    } else {
      // For regular presets, clear custom brush state first
      setBrushSettings({
        selectedCustomBrush: null
      });
      // Then apply the preset (this will set the correct brush shape from the preset)
      setBrushPreset(preset);
    }
  };
  
  const isPresetActive = (preset: BrushPreset) => {
    if (preset.isCustomBrush) {
      // Custom brush preset is active if brush shape is custom and selected brush matches
      return tools.brushSettings.brushShape === BrushShape.CUSTOM && 
             tools.brushSettings.selectedCustomBrush === preset.id;
    } else {
      // Regular preset is active via normal preset system
      return currentBrushPreset?.id === preset.id;
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#31313A]">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-base font-medium">Brush Library</span>
        <div className="flex items-center space-x-2">
          <span className="text-xs text-[#888]">{brushPresets.length} brushes</span>
          {canSaveCustomBrush && (
            <button
              onClick={handleSaveCustomBrushAsPreset}
              className="w-6 h-6 border border-white text-white text-lg flex items-center justify-center hover:bg-white hover:text-[#31313A] transition-colors"
              title="Save current custom brush to library"
            >
              +
            </button>
          )}
        </div>
      </div>
      
      
      <div className="flex-1 p-4 space-y-1 overflow-y-auto">
        {brushPresets.map((preset) => (
          <div
            key={preset.id}
            onClick={() => handlePresetClick(preset)}
            className={`flex items-center justify-between px-2 py-1 cursor-pointer transition-colors ${
              isPresetActive(preset)
                ? 'bg-[#505050]' 
                : 'hover:bg-[#404040]'
            }`}
          >
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 bg-[#606060] rounded-sm flex items-center justify-center text-xs">
                {preset.isCustomBrush ? '▣' : preset.category === 'Pixel Art' ? '▪' : '●'}
              </div>
              <span className="text-sm">{preset.name}</span>
            </div>
            <div className="flex items-center space-x-1">
              <span className="text-sm text-[#888]">
                {preset.isCustomBrush ? '◆' : preset.isDefault ? '★' : '☆'}
              </span>
            </div>
          </div>
        ))}
        
      </div>
    </div>
  );
};

export default BrushLibrary;