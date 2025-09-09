import React, { useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushShape, BrushPreset, ComponentType } from '../types';
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
  const setCurrentTool = useAppStore((state) => state.setCurrentTool);
  const startBrushEdit = useAppStore((state) => state.startBrushEdit);
  const cancelBrushEdit = useAppStore((state) => state.cancelBrushEdit);
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
      components: [
        {
          id: 'custom-shape-renderer',
          type: ComponentType.SHAPE_RENDERER,
          parameters: {
            shape: BrushShape.CUSTOM
          },
          priority: 40,
          enabled: true
        }
      ],
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
      }
    };

    if (brushEditor.status === 'EDITING') {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [brushEditor.status, cancelBrushEdit, currentOffscreenCanvas]);

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
    
    // Always allow normal brush selection - editing mode doesn't prevent switching brushes
    setBrushPreset(preset, true); // preserveEditMode = true to keep editor open if active
    // Also switch to Brush tool when any brush is selected
    setCurrentTool('brush');
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
    
    if (!currentOffscreenCanvas) {
      console.error('No offscreen canvas reference available in store');
      return;
    }
    
    // For regular brushes, we need to create a temporary custom brush from the current brush state
    if (!preset.isCustomBrush) {
      // First, select the brush preset to use it as the base for editing
      setBrushPreset(preset);
      
      // Draw a sample of the brush to create a custom brush from it
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 64;
      tempCanvas.height = 64;
      const ctx = tempCanvas.getContext('2d');
      
      if (ctx) {
        // Clear with transparency
        ctx.clearRect(0, 0, 64, 64);
        
        // Draw a sample brush stroke in the center
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(32, 32, 20, 0, Math.PI * 2);
        ctx.fill();
        
        // Get the image data to create a temporary custom brush
        ctx.getImageData(0, 0, 64, 64);
        
        // Start editing with this temporary brush data
        // Use the preset ID as the brush ID for editing
        startBrushEdit(preset.id, currentOffscreenCanvas);
      }
    } else {
      // For custom brushes, use the existing logic - DON'T call setBrushPreset
      const customBrushId = preset.id.startsWith('custom_') ? preset.id.substring(7) : preset.id;
      const isEditingThisBrush = brushEditor.status === 'EDITING' && brushEditor.editingBrushId === customBrushId;

      if (isEditingThisBrush) {
        // Do nothing - already editing this brush
        return;
      } else {
        if (brushEditor.status === 'EDITING') {
          cancelBrushEdit(currentOffscreenCanvas);
        }
        startBrushEdit(customBrushId, currentOffscreenCanvas);
      }
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
      
      <div className="flex-1 py-1 space-y-0 overflow-y-auto">
        {/* Special entry: Recolor and animate (opens inline panel in Brush Settings) */}
        <div
          key="recolor-and-animate-entry"
          onClick={() => setCurrentTool('recolor')}
          className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors ${
            tools.currentTool === 'recolor' ? 'bg-[#505050]' : 'hover:bg-[#404040]'
          }`}
          title="Open Recolor and animate panel"
        >
          <div className="flex items-center space-x-2">
            <div className="w-10 h-10 flex items-center justify-center text-[#D9D9D9]" style={{ fontSize: '12px' }}>
              🎨
            </div>
            <span className="text-[#D9D9D9]" style={{ fontSize: '14px' }}>Recolor and animate</span>
          </div>
        </div>

        {allBrushes.map((preset) => (
          <div
            key={preset.id}
            onClick={() => handlePresetClick(preset)}
            className={`flex items-center justify-between px-3 py-0 cursor-pointer transition-colors ${
              isPresetActive(preset)
                ? 'bg-[#505050]' 
                : 'hover:bg-[#404040]'
            }`}
          >
            <div className="flex items-center space-x-2">
              {preset.isCustomBrush ? (
                preset.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
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
                // eslint-disable-next-line @next/next/no-img-element
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
            {preset.isCustomBrush && (
              <div className="flex items-center space-x-0.5">
                <button
                  onClick={(e) => handleEditClick(e, preset)}
                  className="px-1.5 py-0 text-xs text-[#D9D9D9] hover:text-green-400 transition-colors opacity-60 hover:opacity-100 border border-[#606060] hover:border-green-400 rounded"
                  title={brushEditor.status === 'EDITING' && brushEditor.editingBrushId === (preset.id.startsWith('custom_') ? preset.id.substring(7) : preset.id) ? 'Save changes' : 'Edit brush'}
                >
                  {brushEditor.status === 'EDITING' && brushEditor.editingBrushId === (preset.id.startsWith('custom_') ? preset.id.substring(7) : preset.id) ? 'Save' : 'Edit'}
                </button>
                <span className="text-[#D9D9D9] w-3 text-center" style={{ fontSize: '12px' }}>
                  {preset.isDefault ? '★' : '☆'}
                </span>
                {!preset.isDefault && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeletePreset(preset.id);
                    }}
                    className="w-3 h-3 text-[#D9D9D9] hover:text-red-400 transition-colors opacity-60 hover:opacity-100 text-center flex items-center justify-center"
                    title={`Delete ${preset.name}`}
                    style={{ fontSize: '14px' }}
                  >
                    ×
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default BrushLibrary;
