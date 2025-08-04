import React, { useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushShape, BrushPreset } from '../types';
import PlusButton from './ui/PlusButton';

const BrushLibrary = () => {
  const brushPresets = useAppStore((state) => state.brushPresets);
  const currentBrushPreset = useAppStore((state) => state.currentBrushPreset);
  const setBrushPreset = useAppStore((state) => state.setBrushPreset);
  
  const setBrushSettings = useAppStore((state) => state.setBrushSettings);
  const saveCustomBrushAsPreset = useAppStore((state) => state.saveCustomBrushAsPreset);
  const removeBrushPreset = useAppStore((state) => state.removeBrushPreset);
  const removeCustomBrush = useAppStore((state) => state.removeCustomBrush);
  const tools = useAppStore((state) => state.tools);
  
  const saveBrushSettings = useAppStore((state) => state.saveBrushSettings);
  const loadBrushSettings = useAppStore((state) => state.loadBrushSettings);
  
  const project = useAppStore((state) => state.project);
  const temporaryCustomBrush = useAppStore((state) => state.temporaryCustomBrush);
  
  // Create combined list of brushes: regular presets + custom brushes from project
  const customBrushPresets = React.useMemo(() => {
    if (!project?.customBrushes) return [];
    
    return project.customBrushes.map(customBrush => ({
      id: `custom_${customBrush.id}`,
      name: customBrush.name,
      category: 'Custom',
      components: [],
      thumbnail: customBrush.thumbnail,
      tags: ['custom', 'loaded'],
      isDefault: false,
      createdAt: new Date(customBrush.createdAt),
      modifiedAt: new Date(customBrush.createdAt),
      isCustomBrush: true,
      customBrushData: {
        imageData: customBrush.imageData,
        width: customBrush.width,
        height: customBrush.height
      }
    } as BrushPreset));
  }, [project?.customBrushes]);

  // Combine all brushes: regular presets + custom brushes
  const allBrushes = React.useMemo(() => {
    const combined = [...brushPresets, ...customBrushPresets];
    
    // Sort brushes: Pixel Art first (with square brushes prioritized), then other categories
    return combined.sort((a, b) => {
      // Custom brushes always go last
      if (a.category === 'Custom' && b.category !== 'Custom') return 1;
      if (b.category === 'Custom' && a.category !== 'Custom') return -1;
      
      // Pixel Art brushes go first
      if (a.category === 'Pixel Art' && b.category !== 'Pixel Art') return -1;
      if (b.category === 'Pixel Art' && a.category !== 'Pixel Art') return 1;
      
      // Within Pixel Art, prioritize square brushes
      if (a.category === 'Pixel Art' && b.category === 'Pixel Art') {
        const aIsSquare = a.name.toLowerCase().includes('square') || a.id === 'square-pixel-1';
        const bIsSquare = b.name.toLowerCase().includes('square') || b.id === 'square-pixel-1';
        if (aIsSquare && !bIsSquare) return -1;
        if (bIsSquare && !aIsSquare) return 1;
      }
      
      // Keep original order for other brushes
      return 0;
    });
  }, [brushPresets, customBrushPresets]);
  
  // Check if there's an active custom brush that can be saved
  const activeCustomBrush = React.useMemo(() => {
    if (!tools.brushSettings.selectedCustomBrush) return null;
    
    // Check temporary custom brush first
    if (temporaryCustomBrush && temporaryCustomBrush.id === tools.brushSettings.selectedCustomBrush) {
      return temporaryCustomBrush;
    }
    
    // Then check project custom brushes
    if (project) {
      return project.customBrushes.find(b => b.id === tools.brushSettings.selectedCustomBrush) || null;
    }
    
    return null;
  }, [tools.brushSettings.selectedCustomBrush, temporaryCustomBrush, project]);
  
  // Save brush settings when component unmounts or loses focus
  useEffect(() => {
    return () => {
      if (currentBrushPreset && (tools.currentTool === 'brush' || tools.currentTool === 'custom')) {
        const currentBrushId = currentBrushPreset.id;
        const existingSavedSettings = loadBrushSettings(currentBrushId);
        const settingsToSave = {
          ...existingSavedSettings,
          opacity: tools.brushSettings.opacity,
          spacing: tools.brushSettings.spacing,
          colorJitter: tools.brushSettings.colorJitter,
          risographIntensity: tools.brushSettings.risographIntensity,
          ditherIntensity: tools.brushSettings.ditherIntensity,
          pressureEnabled: tools.brushSettings.pressureEnabled,
          minPressure: tools.brushSettings.minPressure,
          maxPressure: tools.brushSettings.maxPressure,
          rotationEnabled: tools.brushSettings.rotationEnabled,
          dashedEnabled: tools.brushSettings.dashedEnabled,
          dashLength: tools.brushSettings.dashLength,
          dashGap: tools.brushSettings.dashGap,
          gridSnapEnabled: tools.brushSettings.gridSnapEnabled,
          shapeEnabled: tools.brushSettings.shapeEnabled,
          antialiasing: tools.brushSettings.antialiasing,
          colors: tools.brushSettings.colors
        };
        saveBrushSettings(currentBrushId, settingsToSave);
      }
    };
  }, [currentBrushPreset, tools.currentTool, tools.brushSettings, loadBrushSettings, saveBrushSettings]);
  
  const canSaveCustomBrush = true; // Always show the + button
  
  const handleSaveCustomBrushAsPreset = () => {
    if (!activeCustomBrush) return;
    
    saveCustomBrushAsPreset(activeCustomBrush.id);
  };

  const handleDeletePreset = (presetId: string, presetName: string) => {
    // Check if this is a custom brush from save file
    if (presetId.startsWith('custom_')) {
      // Extract the original custom brush ID
      const originalCustomBrushId = presetId.substring(7);
      removeCustomBrush(originalCustomBrushId);
    } else if (presetId.startsWith('preset_')) {
      // This is a custom brush saved as preset - remove the brush preset
      removeBrushPreset(presetId);
    } else {
      // Regular brush preset
      removeBrushPreset(presetId);
    }
  };
  
  const handlePresetClick = (preset: BrushPreset) => {
    if (preset.isCustomBrush && preset.customBrushData) {
      // For custom brush presets, save current settings and load saved settings for the target brush
      // For saved presets (prefix: preset_), use the preset ID directly
      // For project custom brushes (prefix: custom_), extract the original ID
      let customBrushId: string;
      if (preset.id.startsWith('custom_')) {
        customBrushId = preset.id.substring(7);
      } else {
        // For preset_ IDs, use the full preset ID so MiniCanvas can find it
        customBrushId = preset.id;
      }
      
      // Save current brush settings before switching (similar to setBrushPreset logic)
      const currentBrushId = currentBrushPreset 
        ? currentBrushPreset.id 
        : (tools.brushSettings.brushShape === BrushShape.CUSTOM && tools.brushSettings.selectedCustomBrush 
           ? tools.brushSettings.selectedCustomBrush 
           : null);
           
      if (currentBrushId) {
        const existingSavedSettings = loadBrushSettings(currentBrushId);
        const settingsToSave = {
          ...existingSavedSettings,
          opacity: tools.brushSettings.opacity,
          spacing: tools.brushSettings.spacing,
          colorJitter: tools.brushSettings.colorJitter,
          risographIntensity: tools.brushSettings.risographIntensity,
          ditherIntensity: tools.brushSettings.ditherIntensity,
          pressureEnabled: tools.brushSettings.pressureEnabled,
          minPressure: tools.brushSettings.minPressure,
          maxPressure: tools.brushSettings.maxPressure,
          rotationEnabled: tools.brushSettings.rotationEnabled,
          dashedEnabled: tools.brushSettings.dashedEnabled,
          dashLength: tools.brushSettings.dashLength,
          dashGap: tools.brushSettings.dashGap,
          gridSnapEnabled: tools.brushSettings.gridSnapEnabled,
          shapeEnabled: tools.brushSettings.shapeEnabled,
          antialiasing: tools.brushSettings.antialiasing,
          colors: tools.brushSettings.colors
        };
        saveBrushSettings(currentBrushId, settingsToSave);
      }
      
      // Load saved settings for the target custom brush
      const savedSettings = loadBrushSettings(customBrushId);
      
      setBrushSettings({
        brushShape: BrushShape.CUSTOM,
        selectedCustomBrush: customBrushId,
        // Use saved settings or defaults
        size: tools.brushSettings.size, // Keep current global size
        useSwatchColor: false, // Default to false so custom brushes use their tip colors
        hueShift: 0,           // Reset global hueShift when selecting custom brush
        saturationAdjust: 100, // Reset global saturationAdjust when selecting custom brush
        ...savedSettings       // Apply saved settings last to override defaults
      });
    } else {
      // For regular presets, use setBrushPreset directly
      // The state cleanup logic in setBrushPreset will handle clearing custom brush state atomically
      setBrushPreset(preset);
    }
  };
  
  const isPresetActive = (preset: BrushPreset) => {
    if (preset.isCustomBrush) {
      // Custom brush preset is active if brush shape is custom and selected brush matches
      // For saved presets (prefix: preset_), compare with full preset ID
      // For project custom brushes (prefix: custom_), extract the original ID
      let expectedBrushId: string;
      if (preset.id.startsWith('custom_')) {
        expectedBrushId = preset.id.substring(7);
      } else {
        // For preset_ IDs, use the full preset ID
        expectedBrushId = preset.id;
      }
      return tools.brushSettings.brushShape === BrushShape.CUSTOM && 
             tools.brushSettings.selectedCustomBrush === expectedBrushId;
    } else {
      // Regular preset is active ONLY when no custom brush is selected and preset matches
      return tools.brushSettings.brushShape !== BrushShape.CUSTOM && 
             currentBrushPreset?.id === preset.id;
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#2C2C2C]">
      <div className="flex items-center justify-between px-3 py-2 bg-[#2C2C2C] border-b border-[#4a4a4a]">
        <span className="font-medium text-[#D9D9D9]" style={{ fontSize: '14px' }}>Brush Library</span>
        <div className="flex items-center space-x-2">
          {canSaveCustomBrush && (
            <PlusButton
              onClick={handleSaveCustomBrushAsPreset}
              title="Save current custom brush to library"
            />
          )}
        </div>
      </div>
      
      <div className="flex-1 px-3 py-2 space-y-0 overflow-y-auto">
        {allBrushes.map((preset) => (
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
              <div className="w-4 h-4 bg-[#606060] rounded-sm flex items-center justify-center text-[#D9D9D9]" style={{ fontSize: '14px' }}>
                {preset.isCustomBrush ? '▣' : preset.category === 'Pixel Art' ? '▪' : '●'}
              </div>
              <span className="text-[#D9D9D9]" style={{ fontSize: '14px' }}>{preset.name}</span>
            </div>
            <div className="flex items-center space-x-1">
              <span className="text-[#D9D9D9]" style={{ fontSize: '14px' }}>
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