'use client';

import { useAppStore } from '@/stores/useAppStore';
import { CustomBrush, BrushShape } from '@/types';

export const CustomBrushPanel = () => {
  const { 
    project, 
    tools,
    setBrushSettings, 
    addCustomBrush, 
    removeCustomBrush,
    currentLayer,
    selectionStart,
    selectionEnd,
    clearSelection
  } = useAppStore();
  
  const brushSettings = tools.brushSettings;

  const handleAddCustomBrush = () => {
    if (!selectionStart || !selectionEnd || !project) return;
    
    // Get the active layer to capture from
    const activeLayer = project.layers[currentLayer];
    if (!activeLayer) return;
    
    // Calculate selection bounds
    const minX = Math.floor(Math.min(selectionStart.x, selectionEnd.x));
    const minY = Math.floor(Math.min(selectionStart.y, selectionEnd.y));
    const maxX = Math.floor(Math.max(selectionStart.x, selectionEnd.x));
    const maxY = Math.floor(Math.max(selectionStart.y, selectionEnd.y));
    const width = maxX - minX;
    const height = maxY - minY;
    
    if (width <= 0 || height <= 0) {
      console.error('Invalid selection area');
      return;
    }
    
    // Create canvas to capture the selection
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = width;
    captureCanvas.height = height;
    const captureCtx = captureCanvas.getContext('2d');
    
    if (!captureCtx) {
      console.error('Failed to get canvas context');
      return;
    }
    
    // Get the P5 layer canvas
    const layerCanvas = document.querySelector('canvas'); // This gets the main P5 canvas
    if (!layerCanvas) {
      console.error('Canvas not found');
      return;
    }
    
    // The canvas coordinates are already in canvas space (not screen space)
    // since selection coordinates are calculated with zoom/pan adjustments
    console.log(`Capturing custom brush from area: (${minX}, ${minY}) to (${maxX}, ${maxY}), size: ${width}x${height}`);
    
    // Capture the selection area from the main canvas (composite of all layers)
    try {
      captureCtx.drawImage(
        layerCanvas,
        minX, minY, width, height, // Source rectangle
        0, 0, width, height        // Destination rectangle
      );
    } catch (error) {
      console.error('Failed to capture canvas area:', error);
      return;
    }
    
    // Get ImageData for the brush
    const imageData = captureCtx.getImageData(0, 0, width, height);
    
    // Create thumbnail (max 64x64)
    const thumbnailSize = 64;
    const thumbnailCanvas = document.createElement('canvas');
    thumbnailCanvas.width = thumbnailSize;
    thumbnailCanvas.height = thumbnailSize;
    const thumbnailCtx = thumbnailCanvas.getContext('2d');
    
    if (thumbnailCtx) {
      // Scale to fit thumbnail while maintaining aspect ratio
      const scale = Math.min(thumbnailSize / width, thumbnailSize / height);
      const scaledWidth = width * scale;
      const scaledHeight = height * scale;
      const offsetX = (thumbnailSize - scaledWidth) / 2;
      const offsetY = (thumbnailSize - scaledHeight) / 2;
      
      // Set background to transparent
      thumbnailCtx.clearRect(0, 0, thumbnailSize, thumbnailSize);
      
      // Draw scaled capture
      thumbnailCtx.drawImage(
        captureCanvas,
        offsetX, offsetY, scaledWidth, scaledHeight
      );
    }
    
    // Create custom brush object
    const customBrush: CustomBrush = {
      id: `brush_${Date.now()}`,
      name: `Custom ${(project?.customBrushes?.length || 0) + 1}`,
      imageData,
      thumbnail: thumbnailCanvas.toDataURL(),
      width,
      height,
      createdAt: Date.now()
    };
    
    // Add the brush to the project
    addCustomBrush(customBrush);
    
    // Clear the selection using the new clearSelection action
    clearSelection();
  };

  const handleSelectCustomBrush = (brushId: string) => {
    setBrushSettings({ 
      brushShape: BrushShape.CUSTOM,
      selectedCustomBrush: brushId 
    });
  };

  const handleRemoveCustomBrush = (brushId: string) => {
    // If this brush is currently selected, switch back to square
    if (brushSettings.selectedCustomBrush === brushId) {
      setBrushSettings({ 
        brushShape: BrushShape.SQUARE,
        selectedCustomBrush: null 
      });
    }
    removeCustomBrush(brushId);
  };

  const canCreateBrush = selectionStart && selectionEnd;

  return (
    <div className="p-4 bg-[#2a2a2a] border-t border-[#404040]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white text-lg font-light">Custom brush</h3>
        <button
          onClick={handleAddCustomBrush}
          disabled={!canCreateBrush}
          className={`w-8 h-8 border-2 border-white flex items-center justify-center text-white text-lg font-bold transition-colors ${
            canCreateBrush 
              ? 'hover:bg-white hover:text-[#2a2a2a] cursor-pointer bg-green-500' 
              : 'opacity-50 cursor-not-allowed bg-red-500'
          }`}
          title={canCreateBrush ? 'Create brush from selection' : 'Select an area first with Brush Select tool'}
        >
          +
        </button>
      </div>

      {/* Custom brushes grid */}
      <div className="grid grid-cols-3 gap-2">
        {(project?.customBrushes || []).map((brush) => (
          <div key={brush.id} className="relative group">
            <button
              onClick={() => handleSelectCustomBrush(brush.id)}
              className={`w-full aspect-square border-2 transition-colors relative overflow-hidden ${
                brushSettings.selectedCustomBrush === brush.id
                  ? 'border-[#60a5fa] bg-[#60a5fa]/20'
                  : 'border-[#404040] hover:border-white'
              }`}
            >
              <img
                src={brush.thumbnail}
                alt={brush.name}
                className="w-full h-full object-cover"
                style={{ imageRendering: 'pixelated' }}
              />
            </button>
            
            {/* Remove button (appears on hover) */}
            <button
              onClick={() => handleRemoveCustomBrush(brush.id)}
              className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full 
                         opacity-0 group-hover:opacity-100 transition-opacity duration-200
                         flex items-center justify-center hover:bg-red-600"
              title="Remove brush"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {(project?.customBrushes?.length || 0) === 0 && (
        <div className="text-center py-8 text-[#666666]">
          {/* Empty grid space */}
        </div>
      )}
    </div>
  );
};