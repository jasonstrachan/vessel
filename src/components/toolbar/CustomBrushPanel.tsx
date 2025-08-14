'use client';

import { useAppStore } from '@/stores/useAppStore';
import { CustomBrush, BrushShape } from '@/types';
import { useEffect } from 'react';

export const CustomBrushPanel = () => {
  const { 
    project, 
    addCustomBrush, 
    currentLayer,
    selectionStart,
    selectionEnd,
    clearSelection,
    currentOffscreenCanvas,
    temporaryCustomBrush,
    setTemporaryCustomBrush,
    setBrushSettings,
    tools
  } = useAppStore();

  // Create temporary brush whenever selection changes
  useEffect(() => {
    console.log('CustomBrushPanel useEffect:', {
      selectionStart: !!selectionStart,
      selectionEnd: !!selectionEnd,
      project: !!project,
      currentOffscreenCanvas: !!currentOffscreenCanvas
    });
    if (!selectionStart || !selectionEnd || !project || !currentOffscreenCanvas) return;
    console.log('Selection bounds:', selectionStart, 'to', selectionEnd);
    
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
    
    // Capture the selection area from the composite canvas
    try {
      captureCtx.drawImage(
        currentOffscreenCanvas,
        minX, minY, width, height, // Source rectangle
        0, 0, width, height        // Destination rectangle
      );
    } catch (_error) {
      return;
    }
    
    // Get ImageData for the brush
    const imageData = captureCtx.getImageData(0, 0, width, height);
    
    // Create thumbnail
    const thumbnailSize = 64;
    const thumbnailCanvas = document.createElement('canvas');
    thumbnailCanvas.width = thumbnailSize;
    thumbnailCanvas.height = thumbnailSize;
    const thumbnailCtx = thumbnailCanvas.getContext('2d', { willReadFrequently: true });
    
    if (thumbnailCtx) {
      const scale = Math.min(thumbnailSize / width, thumbnailSize / height);
      const scaledWidth = width * scale;
      const scaledHeight = height * scale;
      const offsetX = (thumbnailSize - scaledWidth) / 2;
      const offsetY = (thumbnailSize - scaledHeight) / 2;
      
      thumbnailCtx.clearRect(0, 0, thumbnailSize, thumbnailSize);
      thumbnailCtx.drawImage(
        captureCanvas,
        0, 0, width, height,
        offsetX, offsetY, scaledWidth, scaledHeight
      );
    }
    
    // Create temporary brush
    const tempBrush: CustomBrush = {
      id: `temp_brush_${Date.now()}`,
      name: `Temp Brush`,
      imageData,
      thumbnail: thumbnailCanvas.toDataURL(),
      width,
      height,
      createdAt: Date.now()
    };
    
    // Set as temporary brush and switch to it
    console.log('CustomBrushPanel: Creating temporary brush:', tempBrush.id, tempBrush.width + 'x' + tempBrush.height);
    setTemporaryCustomBrush(tempBrush);
    
    // Switch to using this temporary brush at 100% size
    const brushSettings = {
      brushShape: BrushShape.CUSTOM,
      selectedCustomBrush: tempBrush.id,
      size: 100, // Always set custom brushes to 100% when created
      currentBrushTip: {
        imageData: tempBrush.imageData,
        brushId: tempBrush.id,
        width: tempBrush.width,
        height: tempBrush.height
      }
    };
    console.log('CustomBrushPanel: Calling setBrushSettings with:', brushSettings);
    setBrushSettings(brushSettings);
    
    // Also update the unified custom brush size
    useAppStore.getState().setCustomBrushesSize(100);
  }, [selectionStart, selectionEnd, project, currentOffscreenCanvas, setTemporaryCustomBrush, setBrushSettings]);

  const handleSaveCustomBrush = () => {
    console.log('handleSaveCustomBrush: temporaryCustomBrush:', temporaryCustomBrush);
    if (!temporaryCustomBrush) {
      console.log('No temporary brush to save');
      return;
    }
    
    // Create a permanent brush from the temporary one
    const permanentBrush: CustomBrush = {
      ...temporaryCustomBrush,
      id: `brush_${Date.now()}`,
      name: `Custom ${(project?.customBrushes?.length || 0) + 1}`,
    };
    console.log('Creating permanent brush:', permanentBrush.id, permanentBrush.name);
    
    // Add the brush to the project
    addCustomBrush(permanentBrush);
    
    // Update brush settings to use the new permanent brush
    console.log('Updating brush settings to use permanent brush');
    setBrushSettings({
      selectedCustomBrush: permanentBrush.id,
      currentBrushTip: undefined // Clear currentBrushTip since it's now saved
    });
    
    // Clear temporary brush and selection
    setTemporaryCustomBrush(null);
    clearSelection();
    console.log('Save complete');
  };


  const canCreateBrush = selectionStart && selectionEnd;
  const hasTemporaryBrush = !!temporaryCustomBrush;

  return (
    <div className="p-4 bg-[#2a2a2a] border-t border-[#404040]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[#D9D9D9] text-base font-light">Custom brush</h3>
        {hasTemporaryBrush ? (
          <div className="flex gap-2">
            <button
              onClick={handleSaveCustomBrush}
              className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white text-sm rounded transition-colors"
              title="Save brush to library"
            >
              Save
            </button>
            <button
              onClick={() => {
                setTemporaryCustomBrush(null);
                clearSelection();
                setBrushSettings({
                  brushShape: BrushShape.ROUND, // Reset to round brush
                  selectedCustomBrush: null,
                  currentBrushTip: undefined
                });
              }}
              className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-sm rounded transition-colors"
              title="Cancel"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="text-sm text-gray-400">
            {canCreateBrush ? 'Selection ready' : 'Press C and select an area'}
          </div>
        )}
      </div>
      
      {/* Show temporary brush preview if available */}
      {hasTemporaryBrush && (
        <div className="mt-4 p-3 bg-[#1a1a1a] rounded">
          <div className="flex items-center gap-3">
            <img 
              src={temporaryCustomBrush.thumbnail} 
              alt="Temporary brush"
              className="w-16 h-16 border border-gray-600"
              style={{ imageRendering: 'pixelated' }}
            />
            <div className="flex-1">
              <p className="text-sm text-gray-300">Testing temporary brush</p>
              <p className="text-xs text-gray-500">
                Size: {temporaryCustomBrush.width}×{temporaryCustomBrush.height}
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};