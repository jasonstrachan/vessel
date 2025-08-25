import { useEffect, useCallback } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushShape } from '../types';

interface UseKeyboardShortcutsProps {
  onSpacePressed: () => void;
  onSpaceReleased: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCompletePolygon?: () => void;
  onCancelPolygon?: () => void;
}

export function useKeyboardShortcuts({
  onSpacePressed,
  onSpaceReleased,
  onUndo,
  onRedo,
  onCompletePolygon,
  onCancelPolygon,
}: UseKeyboardShortcutsProps) {
  const { setCurrentTool, tools, polygonGradientState, deleteSelectedPixels, selectionStart, selectionEnd } = useAppStore();
  
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Handle Undo (Ctrl+Z / Cmd+Z)
    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
      event.preventDefault();
      onUndo();
    }
    // Handle Redo (Ctrl+Shift+Z / Cmd+Shift+Z)
    else if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z') && event.shiftKey) {
      event.preventDefault();
      onRedo();
    }
    // Space for pan
    else if (event.code === 'Space' && !event.repeat) {
      event.preventDefault();
      onSpacePressed();
    }
    // C for custom brush tool
    else if (event.key === 'c' || event.key === 'C') {
      event.preventDefault();
      setCurrentTool('custom');
    }
    // [ to decrease brush size
    else if (event.key === '[') {
      event.preventDefault();
      const store = useAppStore.getState();
      const { brushSettings } = store.tools;
      const currentSize = brushSettings.size;
      
      // Use 1px increment for all brushes
      const adjustment = 1;
      const minSize = 1;
      const newSize = Math.max(minSize, currentSize - adjustment);
      
      store.setGlobalBrushSize(newSize);
    }
    // ] to increase brush size
    else if (event.key === ']') {
      event.preventDefault();
      const store = useAppStore.getState();
      const { brushSettings } = store.tools;
      const currentSize = brushSettings.size;
      
      // Use 1px increment for all brushes
      const adjustment = 1;
      const maxSize = 500;
      const newSize = Math.min(maxSize, currentSize + adjustment);
      
      store.setGlobalBrushSize(newSize);
    }
    // Enter/Escape for polygon gradient or contour polygon
    else if ((event.key === 'Enter' || event.key === 'Escape') && 
             (tools.brushSettings.brushShape === BrushShape.POLYGON_GRADIENT || 
              tools.brushSettings.brushShape === BrushShape.CONTOUR_POLYGON) && 
             polygonGradientState.points.length >= 3) {
      event.preventDefault();
      
      if (event.key === 'Enter' && onCompletePolygon) {
        onCompletePolygon();
      } else if (event.key === 'Escape' && onCancelPolygon) {
        onCancelPolygon();
      }
    }
    // Delete key for deleting selected pixels
    else if (event.key === 'Delete' && selectionStart && selectionEnd) {
      event.preventDefault();
      deleteSelectedPixels();
    }
  }, [setCurrentTool, tools.brushSettings.brushShape, polygonGradientState.points.length, 
      onSpacePressed, onUndo, onRedo, onCompletePolygon, onCancelPolygon, 
      deleteSelectedPixels, selectionStart, selectionEnd]);
  
  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    if (event.code === 'Space') {
      event.preventDefault();
      onSpaceReleased();
    }
  }, [onSpaceReleased]);
  
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);
}