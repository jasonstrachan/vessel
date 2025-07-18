import React from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushShape, BrushPreset } from '../types';

const BrushLibrary = () => {
  const brushPresets = useAppStore((state) => state.brushPresets);
  const currentBrushPreset = useAppStore((state) => state.currentBrushPreset);
  const setBrushPreset = useAppStore((state) => state.setBrushPreset);
  const setBrushSettings = useAppStore((state) => state.setBrushSettings);
  const saveCustomBrushAsPreset = useAppStore((state) => state.saveCustomBrushAsPreset);
  const removeBrushPreset = useAppStore((state) => state.removeBrushPreset);
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

  const handleDeletePreset = (presetId: string, presetName: string) => {
    if (confirm(`Delete brush preset "${presetName}"?`)) {
      removeBrushPreset(presetId);
    }
  };
  
  const handlePresetClick = (preset: BrushPreset) => {
    if (preset.isCustomBrush && preset.customBrushData) {
      // For custom brush presets, set the brush settings to use custom brush
      // Set size to 100% (original size) when switching to custom brush
      setBrushSettings({
        brushShape: BrushShape.CUSTOM,
        selectedCustomBrush: preset.id, // Use the preset ID as the custom brush ID
        size: 100 // Default to 100% (original size) for custom brushes
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
      <div className="flex items-center justify-between px-3 py-2 bg-[#31313A] border-b border-[#4a4a4a]">
        <span className="text-base font-medium text-[#D9D9D9]">Brush Library</span>
        <div className="flex items-center space-x-2">
          {canSaveCustomBrush && (
            <button
              onClick={handleSaveCustomBrushAsPreset}
              className="w-5 h-5 border border-white text-[#D9D9D9] text-base flex items-center justify-center hover:bg-white hover:text-[#31313A] transition-colors"
              title="Save current custom brush to library"
            >
              +
            </button>
          )}
        </div>
      </div>
      
      <div className="flex-1 px-3 py-2 space-y-0 overflow-y-auto">
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
              <div className="w-4 h-4 bg-[#606060] rounded-sm flex items-center justify-center text-base">
                {preset.isCustomBrush ? '▣' : preset.category === 'Pixel Art' ? '▪' : '●'}
              </div>
              <span className="text-base">{preset.name}</span>
            </div>
            <div className="flex items-center space-x-1">
              <span className="text-base text-[#D9D9D9]">
                {preset.isCustomBrush ? '◆' : preset.isDefault ? '★' : '☆'}
              </span>
              {!preset.isDefault && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeletePreset(preset.id, preset.name);
                  }}
                  className="w-4 h-4 text-[#D9D9D9] hover:text-red-400 transition-colors opacity-60 hover:opacity-100"
                  title={`Delete ${preset.name}`}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
        
      </div>
    </div>
  );
};

export default BrushLibrary;