'use client';

import { useAppStore } from '@/stores/useAppStore';
import { CustomBrush } from '@/types';

export const CustomBrushPanel = () => {
  const { 
    project, 
    addCustomBrush, 
    currentLayer,
    selectionStart,
    selectionEnd,
    clearSelection
  } = useAppStore();

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
      return;
    }
    
    // Create canvas to capture the selection
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = width;
    captureCanvas.height = height;
    const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
    
    if (!captureCtx) {
      return;
    }
    
    // Get the P5 layer canvas
    const layerCanvas = document.querySelector('canvas'); // This gets the main P5 canvas
    if (!layerCanvas) {
      return;
    }
    
    // The canvas coordinates are already in canvas space (not screen space)
    // since selection coordinates are calculated with zoom/pan adjustments
    
    // Capture the selection area from the main canvas (composite of all layers)
    try {
      captureCtx.drawImage(
        layerCanvas,
        minX, minY, width, height, // Source rectangle
        0, 0, width, height        // Destination rectangle
      );
    } catch (_error) {
      return;
    }
    
    // Get ImageData for the brush
    const imageData = captureCtx.getImageData(0, 0, width, height);
    
    // Create thumbnail (max 64x64)
    const thumbnailSize = 64;
    const thumbnailCanvas = document.createElement('canvas');
    thumbnailCanvas.width = thumbnailSize;
    thumbnailCanvas.height = thumbnailSize;
    const thumbnailCtx = thumbnailCanvas.getContext('2d', { willReadFrequently: true });
    
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
        0, 0, width, height,                          // Source: full captureCanvas
        offsetX, offsetY, scaledWidth, scaledHeight   // Destination: scaled in thumbnail
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


  const canCreateBrush = selectionStart && selectionEnd;

  return (
    <div className="p-4 bg-[#2a2a2a] border-t border-[#404040]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[#D9D9D9] text-base font-light">Custom brush</h3>
        <button
          onClick={handleAddCustomBrush}
          disabled={!canCreateBrush}
          className={`w-8 h-8 border-2 border-white flex items-center justify-center text-[#D9D9D9] text-base font-bold transition-colors ${
            canCreateBrush 
              ? 'hover:bg-white hover:text-[#2a2a2a] cursor-pointer bg-green-500' 
              : 'opacity-50 cursor-not-allowed bg-red-500'
          }`}
          title={canCreateBrush ? 'Create brush from selection' : 'Select an area first with Brush Select tool'}
        >
          +
        </button>
      </div>

    </div>
  );
};