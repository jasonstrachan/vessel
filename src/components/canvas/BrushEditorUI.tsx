import React from 'react';
import { useAppStore } from '../../stores/useAppStore';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface BrushEditorUIProps {}

const BrushEditorUI: React.FC<BrushEditorUIProps> = () => {
  const brushEditor = useAppStore((state) => state.brushEditor);
  const canvas = useAppStore((state) => state.canvas);

  if (brushEditor.status !== 'EDITING' || !brushEditor.editingBounds) {
    return null;
  }

  const bounds = brushEditor.editingBounds;

  // Calculate screen coordinates for the editing area
  const screenX = bounds.x * canvas.zoom + canvas.panX;
  const screenY = bounds.y * canvas.zoom + canvas.panY;
  const screenWidth = bounds.width * canvas.zoom;
  const screenHeight = bounds.height * canvas.zoom;

  // Create overlay parts around the editing area
  const overlayParts = {
    top: {
      position: 'absolute' as const,
      top: 0,
      left: 0,
      right: 0,
      height: Math.max(0, screenY),
      background: 'rgba(0, 0, 0, 0.7)',
      pointerEvents: 'none' as const,
      zIndex: 10,
    },
    bottom: {
      position: 'absolute' as const,
      top: screenY + screenHeight,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.7)',
      pointerEvents: 'none' as const,
      zIndex: 10,
    },
    left: {
      position: 'absolute' as const,
      top: screenY,
      left: 0,
      width: Math.max(0, screenX),
      height: screenHeight,
      background: 'rgba(0, 0, 0, 0.7)',
      pointerEvents: 'none' as const,
      zIndex: 10,
    },
    right: {
      position: 'absolute' as const,
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
    position: 'absolute',
    left: screenX - 2,
    top: screenY - 2,
    width: screenWidth,
    height: screenHeight,
    border: '2px dashed #000000',
    pointerEvents: 'none',
    zIndex: 11,
    boxSizing: 'content-box',
  };

  return (
    <>
      <div style={overlayParts.top} />
      <div style={overlayParts.bottom} />
      <div style={overlayParts.left} />
      <div style={overlayParts.right} />
      <div style={borderStyle} />
    </>
  );
};

export default BrushEditorUI;