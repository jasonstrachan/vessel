import React, { useCallback, useRef } from 'react';
import { useAppStore } from '../../stores/useAppStore';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface BrushEditorUIProps {}

const BrushEditorUI: React.FC<BrushEditorUIProps> = () => {
  const brushEditor = useAppStore((state) => state.brushEditor);
  const canvas = useAppStore((state) => state.canvas);
  const canvasViewport = useAppStore((state) => state.canvasViewport);
  const setBrushEditorHue = useAppStore((state) => state.setBrushEditorHue);
  const setBrushEditorLightness = useAppStore((state) => state.setBrushEditorLightness);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleHueChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setBrushEditorHue(Number(e.target.value));
  }, [setBrushEditorHue]);

  const handleLightnessChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setBrushEditorLightness(Number(e.target.value));
  }, [setBrushEditorLightness]);

  if (brushEditor.status !== 'EDITING' || !brushEditor.editingBounds) {
    return null;
  }

  const bounds = brushEditor.editingBounds;
  
  // Calculate the transformed position using the same logic as canvas drawing
  const zoom = canvas.zoom;
  const offsetX = canvas.offsetX ?? 0;
  const offsetY = canvas.offsetY ?? 0;
  const viewportLeft = canvasViewport.left ?? 0;
  const viewportTop = canvasViewport.top ?? 0;
  const viewportWidth = canvasViewport.width ?? 0;
  const viewportHeight = canvasViewport.height ?? 0;

  if (!viewportWidth || !viewportHeight) {
    return null;
  }

  const calculateScreenPosition = () => {
    const screenLeft = viewportLeft + offsetX + bounds.x * zoom;
    const screenTop = viewportTop + offsetY + bounds.y * zoom;
    return { screenLeft, screenTop };
  };

  const { screenLeft, screenTop } = calculateScreenPosition();
  const screenWidth = bounds.width * zoom;
  const screenHeight = bounds.height * zoom;

  // Container div that wraps the editing area and sliders
  // This moves and scales with the canvas transformations
  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    left: screenLeft,
    top: screenTop,
    width: screenWidth,
    height: screenHeight + 48, // Extra height for sliders (2 sliders + spacing)
    pointerEvents: 'none',
    userSelect: 'none',
    touchAction: 'none',
    zIndex: 12, // Match your original z-index
  };

  // Visual indicator div that matches the green editing box
  // (Optional: if you want a DOM element to match the canvas-drawn green box)
  const visualBorderStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: screenWidth,
    height: screenHeight,
    border: '2px solid #00ff00',
    borderRadius: '4px',
    boxSizing: 'border-box',
    pointerEvents: 'none',
    // Optional: Add marching ants animation to match canvas drawing
    animation: 'marchingAnts 1s linear infinite',
    backgroundImage: 'linear-gradient(45deg, transparent 25%, rgba(0,255,0,0.05) 25%, rgba(0,255,0,0.05) 50%, transparent 50%, transparent 75%, rgba(0,255,0,0.05) 75%)',
    backgroundSize: '8px 8px',
  };

  // Container for the sliders, positioned below the editing bounds
  const sliderContainerStyle: React.CSSProperties = {
    position: 'absolute',
    top: screenHeight + 4, // Position below the green box with 4px gap
    left: 0,
    width: '100%',
    pointerEvents: 'auto', // Enable interaction for sliders
    isolation: 'isolate',
  };

  const buildSliderStyle = (gradient: string): React.CSSProperties => ({
    width: '100%',
    height: '16px',
    borderRadius: '0',
    outline: 'none',
    appearance: 'none' as React.CSSProperties['appearance'],
    WebkitAppearance: 'none' as React.CSSProperties['WebkitAppearance'],
    cursor: 'pointer',
    marginBottom: '4px',
    display: 'block',
    background: 'transparent',
    '--slider-track-gradient': gradient,
    '--ascii-thumb-size': '14px',
    '--ascii-thumb-hitbox': '18px'
  }) as React.CSSProperties;

  // Create hue gradient background
  const hueGradient = 'linear-gradient(to right, ' +
    'hsl(0, 100%, 50%), ' +
    'hsl(60, 100%, 50%), ' +
    'hsl(120, 100%, 50%), ' +
    'hsl(180, 100%, 50%), ' +
    'hsl(240, 100%, 50%), ' +
    'hsl(300, 100%, 50%), ' +
    'hsl(360, 100%, 50%))';

  // Create lightness gradient background
  const lightnessGradient = 'linear-gradient(to right, ' +
    'hsl(0, 0%, 0%), ' +
    'hsl(0, 0%, 50%), ' +
    'hsl(0, 0%, 100%))';

  return (
    <>
      <style>{`
        @keyframes marchingAnts {
          0% {
            background-position: 0 0;
            border-dash-offset: 0;
          }
          100% {
            background-position: 8px 8px;
            border-dash-offset: 8px;
          }
        }
      `}</style>
      
      {/* Container div that holds everything and moves with canvas transformations */}
      <div
        ref={containerRef}
        style={containerStyle}
      >
        {/* Optional: Visual border to match the canvas-drawn green box */}
        {/* Remove this if you're already drawing the green box on canvas */}
        <div style={visualBorderStyle} />
        
        {/* Sliders container */}
        <div
          style={sliderContainerStyle}
          onPointerDown={(event) => event.stopPropagation()}
        >

          <input
            className="hue-slider slider"
            type="range"
            min="-180"
            max="180"
            value={brushEditor.hueShift}
            onChange={handleHueChange}
            style={buildSliderStyle(hueGradient)}
          />
          
          <input
            className="lightness-slider slider"
            type="range"
            min="-100"
            max="100"
            value={brushEditor.lightness}
            onChange={handleLightnessChange}
            style={buildSliderStyle(lightnessGradient)}
          />
        </div>
      </div>
    </>
  );
};

export default BrushEditorUI;
