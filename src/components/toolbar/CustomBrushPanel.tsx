'use client';

import { useAppStore } from '@/stores/useAppStore';
import { selectCustomBrushes } from '@/stores/selectors/projectSelectors';
import { selectTemporaryCustomBrush } from '@/stores/selectors/toolsSelectors';
import { selectSelectionRects } from '@/stores/selectors/pasteSelectors';
import { CustomBrush, BrushShape } from '@/types';
import { useEffect, useCallback } from 'react';
import { brushCache } from '@/utils/brushCache';
import { scaledBrushCache } from '@/utils/scaledBrushCache';

export const CustomBrushPanel = () => {
  const addCustomBrush = useAppStore((state) => state.addCustomBrush);
  const customBrushes = useAppStore(selectCustomBrushes);
  const temporaryCustomBrush = useAppStore(selectTemporaryCustomBrush);
  const { selectionStart, selectionEnd } = useAppStore(selectSelectionRects);
  const clearSelection = useAppStore((state) => state.clearSelection);
  const currentOffscreenCanvas = useAppStore((state) => state.currentOffscreenCanvas);
  const setTemporaryCustomBrush = useAppStore((state) => state.setTemporaryCustomBrush);
  const setBrushSettings = useAppStore((state) => state.setBrushSettings);

  // Clear temporary brush when there's no selection (i.e., when custom tool is deactivated)
  useEffect(() => {
    if (!selectionStart && !selectionEnd) {
      setTemporaryCustomBrush(null);
    }
  }, [selectionStart, selectionEnd, setTemporaryCustomBrush]);

  // Debounced function to create the brush
  const createBrushFromSelection = useCallback(() => {
    if (!selectionStart || !selectionEnd || !currentOffscreenCanvas) return;
    
    // Remove the isCreatingBrush check - it was causing issues with brush creation
    
    // Calculate selection bounds to determine if this is a meaningful selection
    const minX = Math.floor(Math.min(selectionStart.x, selectionEnd.x));
    const minY = Math.floor(Math.min(selectionStart.y, selectionEnd.y));
    const maxX = Math.floor(Math.max(selectionStart.x, selectionEnd.x));
    const maxY = Math.floor(Math.max(selectionStart.y, selectionEnd.y));
    const width = maxX - minX;
    const height = maxY - minY;
    
    // Skip tiny or invalid selections
    if (width <= 1 || height <= 1) {
      return;
    }
    
    // Always create a new brush for each selection - don't skip
    
    // Always create a new brush when there's a valid selection
    // The previous optimization was preventing new brush creation when
    // switching to custom tool and making the same size selection
    
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
    } catch {
      // Error capturing image data
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
    setTemporaryCustomBrush(tempBrush);
    
    // Clear brush caches to ensure the new brush is used immediately
    brushCache.clear();
    scaledBrushCache.clear();
    
    const targetSize = useAppStore.getState().globalBrushSize ?? 100;
    // Switch to using this temporary brush with the current global size
    const brushSettings = {
      brushShape: BrushShape.CUSTOM,
      selectedCustomBrush: tempBrush.id,
      size: targetSize,
      currentBrushTip: {
        imageData: tempBrush.imageData,
        brushId: tempBrush.id,
        width: tempBrush.width,
        height: tempBrush.height,
        isColorizable: false
      }
    };
    setBrushSettings(brushSettings);
  }, [selectionStart, selectionEnd, currentOffscreenCanvas, setTemporaryCustomBrush, setBrushSettings]);

  // Create brush immediately when selection changes
  useEffect(() => {
    // Create brush immediately if we have a valid selection
    if (selectionStart && selectionEnd && currentOffscreenCanvas) {
      createBrushFromSelection();
    }
  }, [selectionStart, selectionEnd, currentOffscreenCanvas, createBrushFromSelection]);

  const handleSaveCustomBrush = () => {
    if (!temporaryCustomBrush) return;
    
    // Deep clone the ImageData to avoid reference issues
    const clonedImageData = new ImageData(
      new Uint8ClampedArray(temporaryCustomBrush.imageData.data),
      temporaryCustomBrush.imageData.width,
      temporaryCustomBrush.imageData.height
    );
    
    // Create a permanent brush from the temporary one
    const permanentBrush: CustomBrush = {
      ...temporaryCustomBrush,
      id: `brush_${Date.now()}`,
      name: `Custom ${customBrushes.length + 1}`,
      imageData: clonedImageData
    };
    
    
    // Add the brush to the project
    addCustomBrush(permanentBrush);
    
    
    // Update brush settings to use the new permanent brush at 100% size
    try { console.log('[CUSTOM/BRUSH] saving brush', { id: permanentBrush.id, w: permanentBrush.width, h: permanentBrush.height }); } catch {}
    const targetSize = useAppStore.getState().globalBrushSize ?? 100;
    setBrushSettings({
      brushShape: BrushShape.CUSTOM,
      selectedCustomBrush: permanentBrush.id,
      size: targetSize,
      currentBrushTip: {
        imageData: permanentBrush.imageData,
        brushId: permanentBrush.id,
        width: permanentBrush.width,
        height: permanentBrush.height,
        isColorizable: false
      }
    });
    
    
    // Clear temporary brush and selection after a small delay
    setTimeout(() => {
      setTemporaryCustomBrush(null);
      clearSelection();
    }, 50);
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
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
