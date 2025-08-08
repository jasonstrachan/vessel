import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface BrushEditorUIProps {}

const BrushEditorUI: React.FC<BrushEditorUIProps> = () => {
  const brushEditor = useAppStore((state) => state.brushEditor);
  const canvas = useAppStore((state) => state.canvas);
  const [screenBounds, setScreenBounds] = useState<{x: number, y: number, width: number, height: number} | null>(null);

  // Calculate screen coordinates by finding the actual canvas element position
  useEffect(() => {
    if (brushEditor.status !== 'EDITING' || !brushEditor.editingBounds) {
      setScreenBounds(null);
      return;
    }

    const bounds = brushEditor.editingBounds;
    
    // Find the canvas element to get its screen position
    const canvasElement = document.querySelector('canvas') as HTMLCanvasElement;
    if (!canvasElement) {
      setScreenBounds(null);
      return;
    }
    
    const canvasRect = canvasElement.getBoundingClientRect();
    
    // Transform world coordinates to canvas logical coordinates
    const canvasLogicalX = (bounds.x - canvas.panX) * canvas.zoom;
    const canvasLogicalY = (bounds.y - canvas.panY) * canvas.zoom;
    const canvasLogicalWidth = bounds.width * canvas.zoom;
    const canvasLogicalHeight = bounds.height * canvas.zoom;
    
    // Calculate scaling factor from canvas logical size to screen size
    const scaleX = canvasRect.width / canvasElement.width;
    const scaleY = canvasRect.height / canvasElement.height;
    
    // Convert to screen coordinates
    const screenX = canvasRect.left + canvasLogicalX * scaleX;
    const screenY = canvasRect.top + canvasLogicalY * scaleY;
    const screenWidth = canvasLogicalWidth * scaleX;
    const screenHeight = canvasLogicalHeight * scaleY;
    
    setScreenBounds({ x: screenX, y: screenY, width: screenWidth, height: screenHeight });
  }, [brushEditor.status, brushEditor.editingBounds, canvas.zoom, canvas.panX, canvas.panY]);

  if (brushEditor.status !== 'EDITING' || !brushEditor.editingBounds || !screenBounds) {
    return null;
  }

  const { x: screenX, y: screenY, width: screenWidth, height: screenHeight } = screenBounds;

  // Create overlay parts around the editing area using fixed positioning
  const overlayParts = {
    top: {
      position: 'fixed' as const,
      top: 0,
      left: 0,
      right: 0,
      height: Math.max(0, screenY),
      background: 'rgba(0, 0, 0, 0.7)',
      pointerEvents: 'none' as const,
      zIndex: 10,
    },
    bottom: {
      position: 'fixed' as const,
      top: screenY + screenHeight,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.7)',
      pointerEvents: 'none' as const,
      zIndex: 10,
    },
    left: {
      position: 'fixed' as const,
      top: screenY,
      left: 0,
      width: Math.max(0, screenX),
      height: screenHeight,
      background: 'rgba(0, 0, 0, 0.7)',
      pointerEvents: 'none' as const,
      zIndex: 10,
    },
    right: {
      position: 'fixed' as const,
      top: screenY,
      left: screenX + screenWidth,
      right: 0,
      height: screenHeight,
      background: 'rgba(0, 0, 0, 0.7)',
      pointerEvents: 'none' as const,
      zIndex: 10,
    },
  };

  // Animated border around the editing area
  const borderStyle: React.CSSProperties = {
    position: 'fixed',
    // Position the border precisely over the editable area using screen coordinates
    left: screenX - 1,
    top: screenY - 1,
    width: screenWidth,
    height: screenHeight,
    border: '2px dashed #FFF', // White dashed border for visibility
    boxSizing: 'border-box',
    pointerEvents: 'none',
    zIndex: 11,
    // Add marching ants animation
    animation: 'marchingAnts 1s linear infinite',
  };

  return (
    <>
      <style>{`
        @keyframes marchingAnts {
          0% { border-offset: 0; }
          100% { border-offset: 8px; }
        }
      `}</style>
      <div style={overlayParts.top} />
      <div style={overlayParts.bottom} />
      <div style={overlayParts.left} />
      <div style={overlayParts.right} />
      <div style={borderStyle} />
    </>
  );
};

export default BrushEditorUI;