'use client';

import { useAppStore } from '@/stores/useAppStore';
import { selectCustomBrushes } from '@/stores/selectors/projectSelectors';
import { selectTemporaryCustomBrush } from '@/stores/selectors/toolsSelectors';
import { selectSelectionRects } from '@/stores/selectors/pasteSelectors';
import { CustomBrush, BrushShape } from '@/types';
import { useEffect, useCallback } from 'react';
import { brushCache } from '@/utils/brushCache';
import { scaledBrushCache } from '@/utils/scaledBrushCache';
import { captureBrushFromCanvas, selectionToCaptureBounds } from '@/utils/customBrushCapture';

export const CustomBrushPanel = () => {
  const addCustomBrush = useAppStore((state) => state.addCustomBrush);
  const customBrushes = useAppStore(selectCustomBrushes);
  const temporaryCustomBrush = useAppStore(selectTemporaryCustomBrush);
  const { selectionStart, selectionEnd } = useAppStore(selectSelectionRects);
  const clearSelection = useAppStore((state) => state.clearSelection);
  const currentOffscreenCanvas = useAppStore((state) => state.currentOffscreenCanvas);
  const setTemporaryCustomBrush = useAppStore((state) => state.setTemporaryCustomBrush);
  const setBrushSettings = useAppStore((state) => state.setBrushSettings);
  const setGlobalBrushSize = useAppStore((state) => state.setGlobalBrushSize);
  const setCustomBrushSizePercent = useAppStore((state) => state.setCustomBrushSizePercent);

  // Clear temporary brush when there's no selection (i.e., when custom tool is deactivated)
  useEffect(() => {
    if (!selectionStart && !selectionEnd) {
      setTemporaryCustomBrush(null);
    }
  }, [selectionStart, selectionEnd, setTemporaryCustomBrush]);

  // Debounced function to create the brush
  const createBrushFromSelection = useCallback(() => {
    if (!selectionStart || !selectionEnd || !currentOffscreenCanvas) return;

    const bounds = selectionToCaptureBounds(selectionStart, selectionEnd);
    if (!bounds) {
      return;
    }

    const captureResult = captureBrushFromCanvas(currentOffscreenCanvas, bounds);
    if (!captureResult) {
      return;
    }

    const {
      imageData,
      width,
      height,
      naturalWidth,
      naturalHeight,
      maxDimension,
      thumbnail,
    } = captureResult;

    const tempBrush: CustomBrush = {
      id: `temp_brush_${Date.now()}`,
      name: `Temp Brush`,
      imageData,
      thumbnail: thumbnail ?? '',
      width,
      height,
      createdAt: Date.now(),
      naturalWidth,
      naturalHeight,
      maxDimension,
    };

    // Set as temporary brush and switch to it
    setTemporaryCustomBrush(tempBrush);

    // Clear brush caches to ensure the new brush is used immediately
    brushCache.clear();
    scaledBrushCache.clear();

    const normalizedSize = Math.max(1, Math.round(maxDimension));
    setGlobalBrushSize(normalizedSize);
    // Switch to using this temporary brush with the current global size
    const brushSettings = {
      brushShape: BrushShape.CUSTOM,
      selectedCustomBrush: tempBrush.id,
      size: normalizedSize,
      customBrushSizePercent: 100,
      currentBrushTip: {
        imageData: tempBrush.imageData,
        brushId: tempBrush.id,
        width: tempBrush.width,
        height: tempBrush.height,
        naturalWidth: tempBrush.naturalWidth ?? tempBrush.width,
        naturalHeight: tempBrush.naturalHeight ?? tempBrush.height,
        maxDimension: tempBrush.maxDimension ?? Math.max(tempBrush.width, tempBrush.height),
        isColorizable: false
      }
    };
    setBrushSettings(brushSettings);
    setCustomBrushSizePercent(100);
  }, [
    selectionStart,
    selectionEnd,
    currentOffscreenCanvas,
    setTemporaryCustomBrush,
    setBrushSettings,
    setGlobalBrushSize,
    setCustomBrushSizePercent
  ]);

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
    const baseNaturalWidth = temporaryCustomBrush.naturalWidth ?? temporaryCustomBrush.width;
    const baseNaturalHeight = temporaryCustomBrush.naturalHeight ?? temporaryCustomBrush.height;
    const baseMaxDimension = temporaryCustomBrush.maxDimension ?? Math.max(baseNaturalWidth, baseNaturalHeight);

    const permanentBrush: CustomBrush = {
      ...temporaryCustomBrush,
      id: `brush_${Date.now()}`,
      name: `Custom ${customBrushes.length + 1}`,
      imageData: clonedImageData,
      naturalWidth: baseNaturalWidth,
      naturalHeight: baseNaturalHeight,
      maxDimension: baseMaxDimension,
    };
    
    
    // Add the brush to the project
    addCustomBrush(permanentBrush);
    
    
    // Update brush settings to use the new permanent brush at 100% size
    try { console.log('[CUSTOM/BRUSH] saving brush', { id: permanentBrush.id, w: permanentBrush.width, h: permanentBrush.height }); } catch {}
    const normalizedSize = Math.max(1, Math.round(permanentBrush.maxDimension ?? Math.max(permanentBrush.width, permanentBrush.height)));
    setGlobalBrushSize(normalizedSize);
    setBrushSettings({
      brushShape: BrushShape.CUSTOM,
      selectedCustomBrush: permanentBrush.id,
      size: normalizedSize,
      customBrushSizePercent: 100,
      currentBrushTip: {
        imageData: permanentBrush.imageData,
        brushId: permanentBrush.id,
        width: permanentBrush.width,
        height: permanentBrush.height,
        naturalWidth: permanentBrush.naturalWidth ?? permanentBrush.width,
        naturalHeight: permanentBrush.naturalHeight ?? permanentBrush.height,
        maxDimension: permanentBrush.maxDimension ?? Math.max(permanentBrush.width, permanentBrush.height),
        isColorizable: false
      }
    });
    setCustomBrushSizePercent(100);
    
    
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
