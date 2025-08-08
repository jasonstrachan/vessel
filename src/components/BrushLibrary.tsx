import React, { useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushShape, BrushPreset } from '../types';
import PlusButton from './ui/PlusButton';
import { generateBrushThumbnail } from '../utils/brushThumbnailGenerator';

const BrushLibrary = () => {
  // FIX: Use individual selectors to avoid creating new objects on every render
  const brushPresets = useAppStore((state) => state.brushPresets);
  const currentBrushPreset = useAppStore((state) => state.currentBrushPreset);
  const project = useAppStore((state) => state.project);
  const tools = useAppStore((state) => state.tools);
  const brushEditor = useAppStore((state) => state.brushEditor);
  const temporaryCustomBrush = useAppStore((state) => state.temporaryCustomBrush);
  const currentOffscreenCanvas = useAppStore((state) => state.currentOffscreenCanvas);
  const setBrushPreset = useAppStore((state) => state.setBrushPreset);
  const startBrushEdit = useAppStore((state) => state.startBrushEdit);
  const saveBrushEdit = useAppStore((state) => state.saveBrushEdit);
  const cancelBrushEdit = useAppStore((state) => state.cancelBrushEdit);
  const setLayersNeedRecomposition = useAppStore((state) => state.setLayersNeedRecomposition);
  const saveCustomBrushAsPreset = useAppStore((state) => state.saveCustomBrushAsPreset);
  const removeCustomBrush = useAppStore((state) => state.removeCustomBrush);
  const removeBrushPreset = useAppStore((state) => state.removeBrushPreset);
  
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

  // Generate thumbnails for regular brush presets (client-side only)
  const [brushThumbnails, setBrushThumbnails] = React.useState<Record<string, string>>({});
  
  React.useEffect(() => {
    const thumbnails: Record<string, string> = {};
    
    brushPresets.forEach(preset => {
      if (!preset.isCustomBrush) {
        thumbnails[preset.id] = generateBrushThumbnail(preset, {
          size: 40,
          brushColor: '#D9D9D9',
          backgroundColor: 'transparent'
        });
      }
    });
    
    setBrushThumbnails(thumbnails);
  }, [brushPresets]);

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
  
  // Handle escape key to cancel editing
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && brushEditor.status === 'EDITING' && currentOffscreenCanvas) {
        cancelBrushEdit(currentOffscreenCanvas);
        setLayersNeedRecomposition(true);
      }
    };

    if (brushEditor.status === 'EDITING') {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [brushEditor.status, cancelBrushEdit, setLayersNeedRecomposition, currentOffscreenCanvas]);

  // REFACTOR: Removed the redundant useEffect for saving settings. 
  // This is now handled reliably by the store before any tool/preset switch.
  
  const canSaveCustomBrush = true; // Always show the + button
  
  const handleSaveCustomBrushAsPreset = () => {
    if (!activeCustomBrush) return;
    
    saveCustomBrushAsPreset(activeCustomBrush.id);
  };

  const handleDeletePreset = (presetId: string) => {
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
    // Special handling when in edit mode
    if (brushEditor.status === 'EDITING' && currentOffscreenCanvas) {
      // If clicking another custom brush while editing, transition to editing that brush
      if (preset.isCustomBrush) {
        const customBrushId = preset.id.startsWith('custom_') ? preset.id.substring(7) : preset.id;
        
        // Save current edits first
        if (brushEditor.editingBrushId !== customBrushId) {
          saveBrushEdit(currentOffscreenCanvas);
          // Start editing the new brush
          startBrushEdit(customBrushId, currentOffscreenCanvas);
          // Note: Don't call setLayersNeedRecomposition here - let the brush drawing useEffect handle redraw
        }
        // If clicking the same brush that's being edited, do nothing
        return;
      }
      // For regular presets while editing, just switch the drawing tool without exiting edit mode
      // The edit session continues, allowing users to draw with different brushes on the custom brush
      setBrushPreset(preset, true); // preserveEditMode = true
      return;
    }
    
    // REFACTOR: Simplified logic. The store's `setBrushPreset` now handles almost everything.
    // We just need to handle the case where a custom brush is selected directly.
    if (preset.isCustomBrush && project) {
      // Find the full custom brush data from the project
      const customBrushId = preset.id.startsWith('custom_') ? preset.id.substring(7) : preset.id;
      const customBrushData = project.customBrushes.find(b => b.id === customBrushId);

      if (customBrushData) {
        // First, save settings for the outgoing brush.
        useAppStore.getState()._saveCurrentBrushSettings();

        // Then, set the new brush.
        useAppStore.getState().setBrushSettings({
          brushShape: BrushShape.CUSTOM,
          selectedCustomBrush: customBrushId,
          useSwatchColor: false,
          hueShift: 0,
          saturationAdjust: 100,
          // Load any saved settings for this specific brush
          ...useAppStore.getState().loadBrushSettings(customBrushId),
        });
      }
    } else {
      // For all regular presets, this is all we need. The store handles the rest.
      setBrushPreset(preset);
    }
  };

  const isPresetActive = (preset: BrushPreset): boolean => {
    // REFACTOR: Robust check for active state
    if (preset.isCustomBrush) {
      const customBrushId = preset.id.startsWith('custom_') ? preset.id.substring(7) : preset.id;
      return tools.brushSettings.brushShape === BrushShape.CUSTOM &&
             tools.brushSettings.selectedCustomBrush === customBrushId;
    }
    // A regular preset is active if the current preset ID matches and we are NOT in custom brush mode.
    return tools.brushSettings.brushShape !== BrushShape.CUSTOM &&
           currentBrushPreset?.id === preset.id;
  };

  const handleEditClick = (e: React.MouseEvent, preset: BrushPreset) => {
    e.stopPropagation();
    if (!currentOffscreenCanvas) return;

    const customBrushId = preset.id.startsWith('custom_') ? preset.id.substring(7) : preset.id;
    const isEditingThisBrush = brushEditor.status === 'EDITING' && brushEditor.editingBrushId === customBrushId;

    if (isEditingThisBrush) {
      saveBrushEdit(currentOffscreenCanvas);
    } else {
      // If editing another brush, cancel first, then start new edit
      if (brushEditor.status === 'EDITING') {
        cancelBrushEdit(currentOffscreenCanvas);
      }
      startBrushEdit(customBrushId, currentOffscreenCanvas);
    }
    // Note: Don't call setLayersNeedRecomposition here - let the brush drawing useEffect handle redraw
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
      
      <div className="flex-1 px-3 py-1 space-y-0 overflow-y-auto">
        {allBrushes.map((preset) => (
          <div
            key={preset.id}
            onClick={() => handlePresetClick(preset)}
            className={`flex items-center justify-between px-0 py-0 cursor-pointer transition-colors ${
              isPresetActive(preset)
                ? 'bg-[#505050]' 
                : 'hover:bg-[#404040]'
            }`}
          >
            <div className="flex items-center space-x-2">
              {preset.isCustomBrush ? (
                preset.thumbnail ? (
                  <img 
                    src={preset.thumbnail} 
                    alt={`${preset.name} thumbnail`}
                    className="w-10 h-10"
                    style={{ imageRendering: 'pixelated' }}
                  />
                ) : (
                  <div className="w-10 h-10 flex items-center justify-center text-[#D9D9D9]" style={{ fontSize: '12px' }}>
                    ▣
                  </div>
                )
              ) : brushThumbnails[preset.id] ? (
                <img 
                  src={brushThumbnails[preset.id]} 
                  alt={`${preset.name} thumbnail`}
                  className="w-10 h-10"
                  style={{ imageRendering: 'auto' }}
                />
              ) : (
                <div className="w-10 h-10 flex items-center justify-center text-[#D9D9D9]" style={{ fontSize: '12px' }}>
                  {preset.category === 'Pixel Art' ? '▪' : '●'}
                </div>
              )}
              <span className="text-[#D9D9D9]" style={{ fontSize: '14px' }}>{preset.name}</span>
            </div>
            <div className="flex items-center space-x-1">
              <span className="text-[#D9D9D9]" style={{ fontSize: '14px' }}>
                {preset.isCustomBrush ? '◆' : preset.isDefault ? '★' : '☆'}
              </span>
              {preset.isCustomBrush && (
                <button
                  onClick={(e) => handleEditClick(e, preset)}
                  className="px-2 py-0.5 text-xs text-[#D9D9D9] hover:text-green-400 transition-colors opacity-60 hover:opacity-100 border border-[#606060] hover:border-green-400 rounded"
                  title={brushEditor.status === 'EDITING' && brushEditor.editingBrushId === (preset.id.startsWith('custom_') ? preset.id.substring(7) : preset.id) ? 'Save changes' : 'Edit brush'}
                >
                  {brushEditor.status === 'EDITING' && brushEditor.editingBrushId === (preset.id.startsWith('custom_') ? preset.id.substring(7) : preset.id) ? 'Save' : 'Edit'}
                </button>
              )}
              {!preset.isDefault && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeletePreset(preset.id);
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