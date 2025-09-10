import React, { useState, useCallback, useEffect, useRef } from 'react';
import Dropdown from './Dropdown';
import { useAppStore } from '../../stores/useAppStore';
import { RecolorManager } from '../../lib/colorCycle/RecolorManager';

interface GradientStop {
  position: number;
  color: string;
  opacity?: number;
}

interface SavedGradient {
  id: string;
  name: string;
  stops: GradientStop[];
  isDefault?: boolean;
}

interface GradientEditorProps {
  stops: GradientStop[];
  onChange: (stops: GradientStop[]) => void;
  className?: string;
  // When user chooses "+ Sample" in the dropdown, where should the sampled gradient apply?
  // 'recolor' updates the active recolor layer; 'brush' updates the brush gradient.
  sampleTarget?: 'recolor' | 'brush';
}

const defaultGradients: SavedGradient[] = [
  {
    id: 'rainbow',
    name: 'Rainbow',
    stops: [
      { position: 0.0, color: '#ff0000', opacity: 1 },
      { position: 0.17, color: '#ff7f00', opacity: 1 },
      { position: 0.33, color: '#ffff00', opacity: 1 },
      { position: 0.5, color: '#00ff00', opacity: 1 },
      { position: 0.67, color: '#0000ff', opacity: 1 },
      { position: 0.83, color: '#4b0082', opacity: 1 },
      { position: 1.0, color: '#9400d3', opacity: 1 }
    ]
  },
  {
    id: 'fire',
    name: 'Fire',
    stops: [
      { position: 0.0, color: '#ff0000', opacity: 1 },
      { position: 0.33, color: '#ff7f00', opacity: 1 },
      { position: 0.67, color: '#ffff00', opacity: 1 },
      { position: 1.0, color: '#ff0000', opacity: 1 }
    ]
  },
  {
    id: 'ocean',
    name: 'Ocean',
    stops: [
      { position: 0.0, color: '#001f3f', opacity: 1 },
      { position: 0.5, color: '#0074d9', opacity: 1 },
      { position: 1.0, color: '#001f3f', opacity: 1 }
    ]
  },
  {
    id: 'sunset',
    name: 'Sunset',
    stops: [
      { position: 0.0, color: '#ff6b6b', opacity: 1 },
      { position: 0.33, color: '#ffa500', opacity: 1 },
      { position: 0.67, color: '#ffd700', opacity: 1 },
      { position: 1.0, color: '#4b0082', opacity: 1 }
    ]
  },
  {
    id: 'mint',
    name: 'Mint',
    stops: [
      { position: 0.0, color: '#00ff88', opacity: 1 },
      { position: 0.5, color: '#00ffff', opacity: 1 },
      { position: 1.0, color: '#0088ff', opacity: 1 }
    ]
  }
];


// Load custom gradients from localStorage and merge with defaults
const loadGradients = (): SavedGradient[] => {
  const defaults = defaultGradients.map(g => ({ ...g, isDefault: true }));
  try {
    const stored = localStorage.getItem('tinybrush_custom_gradients');
    if (stored) {
      const customGradients = JSON.parse(stored);
      return [...defaults, ...customGradients];
    }
  } catch (e) {
    console.error('Failed to load gradients:', e);
  }
  return defaults;
};

// Save only custom gradients to localStorage
const saveCustomGradients = (allGradients: SavedGradient[]) => {
  try {
    const customGradients = allGradients.filter(g => !g.isDefault);
    localStorage.setItem('tinybrush_custom_gradients', JSON.stringify(customGradients));
  } catch (e) {
    console.error('Failed to save gradients:', e);
  }
};

export const GradientEditor: React.FC<GradientEditorProps> = ({ 
  stops: initialStops, 
  onChange,
  className = '',
  sampleTarget = 'recolor'
}) => {
  const { startRecolorSampling, addNotification } = useAppStore();
  // Ensure all stops have opacity
  const normalizeStops = (stops: GradientStop[]) => 
    stops.map(s => ({ ...s, opacity: s.opacity ?? 1 }));
  
  const [stops, setStops] = useState<GradientStop[]>(normalizeStops(initialStops));
  const [selectedStop, setSelectedStop] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [savedGradients, setSavedGradients] = useState<SavedGradient[]>(loadGradients());
  const [selectedGradientId, setSelectedGradientId] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Update internal state when props change
  useEffect(() => {
    setStops(normalizeStops(initialStops));
  }, [initialStops]);
  
  // Update saved gradient when stops change
  useEffect(() => {
    if (selectedGradientId && stops.length > 0) {
      setSavedGradients(prev => {
        const updated = prev.map(g => 
          g.id === selectedGradientId ? { ...g, stops } : g
        );
        saveCustomGradients(updated);
        return updated;
      });
    }
  }, [stops, selectedGradientId]);

  // Generate CSS gradient string with opacity
  const gradientString = stops
    .map(s => {
      const opacity = s.opacity ?? 1;
      const hex = s.color;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${opacity}) ${s.position * 100}%`;
    })
    .join(', ');

  const handleStopClick = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedStop(index);
    
    // Directly trigger the native color picker
    if (colorInputRef.current) {
      colorInputRef.current.value = stops[index].color;
      colorInputRef.current.click();
    }
  }, [stops]);

  const handleColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (selectedStop === null) return;
    
    const newStops = [...stops];
    newStops[selectedStop].color = e.target.value;
    setStops(newStops);
    onChange(newStops);
  }, [selectedStop, stops, onChange]);

  const handleStopMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    setSelectedStop(index);
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || selectedStop === null || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const position = Math.max(0, Math.min(1, x / rect.width));

    const newStops = [...stops];
    newStops[selectedStop].position = position;
    
    // Keep stops sorted by position
    newStops.sort((a, b) => a.position - b.position);
    const newIndex = newStops.findIndex((s, i) => 
      s.position === stops[selectedStop].position && 
      s.color === stops[selectedStop].color
    );
    
    setSelectedStop(newIndex);
    setStops(newStops);
    onChange(newStops);
  }, [isDragging, selectedStop, stops, onChange]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add global mouse event listeners for dragging
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleAddStop = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const position = Math.max(0, Math.min(1, x / rect.width));
    
    // Interpolate color at this position
    const color = interpolateColor(position, stops);
    
    const newStops = [...stops, { position, color, opacity: 1 }];
    newStops.sort((a, b) => a.position - b.position);
    setStops(newStops);
    onChange(newStops);
  }, [stops, onChange]);

  // Deleting stops via UI removed; keep logic minimal in component

  const handleGradientSelect = useCallback((gradientId: string) => {
    // Special case: restore "Original" palette-derived gradient for the active recolor layer
    if (gradientId === 'original') {
      try {
        const store = useAppStore.getState();
        const activeLayer = store.layers.find(l => l.id === store.activeLayerId);
        const palette = activeLayer?.colorCycleData?.recolorSettings?.palette;
        if (palette && palette.length >= 2) {
          // Build a reasonable number of stops from the palette (sample 16 evenly from indices 1..255)
          const sampleCount = 16;
          const newStops: GradientStop[] = [];
          for (let i = 0; i < sampleCount; i++) {
            const idx = 1 + Math.floor((i * (255 - 1)) / (sampleCount - 1));
            const v = palette[idx] >>> 0; // ensure unsigned
            const r = v & 0xff;
            const g = (v >>> 8) & 0xff;
            const b = (v >>> 16) & 0xff;
            const hex = `#${r.toString(16).padStart(2, '0')}${g
              .toString(16)
              .padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
            newStops.push({ position: i / (sampleCount - 1), color: hex, opacity: 1 });
          }
          setStops(newStops);
          onChange(newStops);
          setSelectedGradientId('original');
        } else {
          // No palette available (e.g., not in recolor mode)
          addNotification?.({
            type: 'warning',
            title: 'Original unavailable',
            message: 'Select a recolor layer first to use its original colors.',
            timestamp: new Date()
          });
        }
      } catch {}
      return;
    }

    const gradient = savedGradients.find(g => g.id === gradientId);
    if (gradient) {
      const newStops = [...gradient.stops];
      setStops(newStops);
      onChange(newStops);
      setSelectedGradientId(gradientId);
    }
  }, [savedGradients, onChange, addNotification]);

  const handleAddGradient = useCallback(() => {
    const existingCustom = savedGradients.filter(g => g.name.startsWith('Custom '));
    const customNumber = existingCustom.length + 1;
    const newId = `custom_${Date.now()}`;
    const newGradient: SavedGradient = {
      id: newId,
      name: `Custom ${customNumber}`,
      stops: [
        { position: 0.0, color: '#000000', opacity: 1 },
        { position: 0.5, color: '#ffffff', opacity: 1 },
        { position: 1.0, color: '#000000', opacity: 1 }
      ],
      isDefault: false
    };
    
    const updated = [...savedGradients, newGradient];
    setSavedGradients(updated);
    saveCustomGradients(updated);
    
    // Select and apply the new gradient
    setStops(newGradient.stops);
    onChange(newGradient.stops);
    setSelectedGradientId(newId);
  }, [savedGradients, onChange]);

  const handleRemoveGradient = useCallback((gradientId: string) => {
    const gradient = savedGradients.find(g => g.id === gradientId);
    
    // Don't permanently delete default gradients, just hide them for this session
    if (gradient?.isDefault) {
      const updated = savedGradients.filter(g => g.id !== gradientId);
      setSavedGradients(updated);
      // Don't save to localStorage - this is just a session hide
    } else {
      // Permanently delete custom gradients
      const updated = savedGradients.filter(g => g.id !== gradientId);
      setSavedGradients(updated);
      saveCustomGradients(updated);
    }
    
    // If removing the selected gradient, clear selection
    if (selectedGradientId === gradientId) {
      setSelectedGradientId('');
    }
  }, [savedGradients, selectedGradientId]);


  // Render gradient preview for dropdown option
  const renderGradientOption = useCallback((option: { value: string; label: string; isAction?: boolean }) => {
    // Handle action items: render label as-is (+ Add, + Sample)
    if (option.isAction) {
      return (
        <div className="flex items-center gap-2">
          <span className="text-[#D9D9D9]">{option.label}</span>
        </div>
      );
    }

    const gradient = savedGradients.find(g => g.id === option.value);
    if (!gradient) return option.label;

    const gradientCss = gradient.stops
      .map(s => {
        const opacity = s.opacity ?? 1;
        const hex = s.color;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${opacity}) ${s.position * 100}%`;
      })
      .join(', ');

    return (
      <div className="flex items-center gap-2 w-full relative">
        <div 
          className="flex-1 h-5 border border-[#666]"
          style={{ 
            background: `linear-gradient(90deg, ${gradientCss})` 
          }}
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleRemoveGradient(option.value);
          }}
          className="absolute right-0 text-[#888] hover:text-[#ff6b6b] transition-colors px-1"
          title="Remove gradient"
        >
          ×
        </button>
      </div>
    );
  }, [savedGradients, handleRemoveGradient]);

  return (
    <div className={`gradient-editor relative ${className}`} ref={containerRef}>
      {/* Preset selector */}
      <div className="mb-2">
        <Dropdown
          value={selectedGradientId}
          options={[
            { value: 'original', label: 'Original' },
            ...savedGradients.map(g => ({ value: g.id, label: g.name })),
            { value: 'add', label: '+ Add', isAction: true },
            { value: 'sample', label: '+ Sample', isAction: true }
          ]}
          onChange={handleGradientSelect}
          onAction={(action) => {
            if (action === 'add') {
              handleAddGradient();
            } else if (action === 'sample') {
              // Kick off recolor sampling mode; DrawingCanvas will capture a line
              try {
                startRecolorSampling(12, sampleTarget);
                addNotification?.({ type: 'info', title: 'Sampling', message: 'Click and drag on the canvas to sample a gradient and flow direction.', timestamp: new Date() });
              } catch {}
            }
          }}
          placeholder="Select gradient..."
          renderOption={(option) => {
            // Live preview for "Original" using active layer palette
            if (option.value === 'original') {
              try {
                const store = useAppStore.getState();
                const activeLayer = store.layers.find(l => l.id === store.activeLayerId);
                const palette = activeLayer?.colorCycleData?.recolorSettings?.palette;
                if (palette && palette.length >= 2) {
                  // Build preview CSS by sampling more densely for a smooth bar
                  const previewSamples = 24;
                  const parts: string[] = [];
                  for (let i = 0; i < previewSamples; i++) {
                    const idx = 1 + Math.floor((i * (255 - 1)) / (previewSamples - 1));
                    const v = palette[idx] >>> 0;
                    const r = v & 0xff;
                    const g = (v >>> 8) & 0xff;
                    const b = (v >>> 16) & 0xff;
                    const pos = (i / (previewSamples - 1)) * 100;
                    parts.push(`rgba(${r}, ${g}, ${b}, 1) ${pos}%`);
                  }
                  return (
                    <div className="flex items-center gap-2 w-full relative">
                      <div
                        className="flex-1 h-5 border border-[#666]"
                        style={{ background: `linear-gradient(90deg, ${parts.join(', ')})` }}
                      />
                    </div>
                  );
                }
              } catch {}
              return option.label;
            }
            return renderGradientOption(option);
          }}
        />
      </div>

      {/* Gradient preview bar with checkerboard background for transparency */}
      <div className="relative mb-2">
        {/* Checkerboard background */}
        <div 
          className="absolute inset-0 border border-[#5a5a5a]"
          style={{
            backgroundImage: `repeating-conic-gradient(#606060 0% 25%, #404040 0% 50%)`,
            backgroundSize: '16px 16px',
          }}
        />
        {/* Gradient overlay */}
        <div 
          className="relative h-8 border border-[#5a5a5a] cursor-pointer"
          style={{ 
            background: `linear-gradient(90deg, ${gradientString})` 
          }}
          onClick={handleAddStop}
        >
          {/* Gradient stops */}
          {stops.map((stop, index) => (
            <div
              key={index}
              className={`absolute top-0 w-4 h-full transform -translate-x-1/2 cursor-move ${
                selectedStop === index ? 'z-20' : 'z-10'
              }`}
              style={{ left: `${stop.position * 100}%` }}
              onMouseDown={(e) => handleStopMouseDown(index, e)}
              onClick={(e) => handleStopClick(index, e)}
            >
              {/* Stop handle - square shape */}
              <div 
                className={`w-4 h-4 border-2 ${
                  selectedStop === index ? 'border-white' : 'border-[#888]'
                } shadow-lg`}
                style={{ 
                  backgroundColor: stop.color,
                  opacity: stop.opacity ?? 1
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Color input positioned well above the gradient */}
      <input
        ref={colorInputRef}
        type="color"
        onChange={handleColorChange}
        className="absolute"
        style={{
          left: '0',
          top: '-230px', // Moved down 20px, aligned with gradient
          transform: 'none',
          opacity: 0,
          pointerEvents: 'none',
          zIndex: 200, // Higher z-index to appear above BrushEditorUI modal (z-index: 100)
          width: '1px',
          height: '1px'
        }}
      />

      {/* Controls removed per request */}
    </div>
  );
};

// Helper function to interpolate color at a position
function interpolateColor(position: number, stops: GradientStop[]): string {
  // Find surrounding stops
  let before = stops[0];
  let after = stops[stops.length - 1];
  
  for (let i = 0; i < stops.length - 1; i++) {
    if (position >= stops[i].position && position <= stops[i + 1].position) {
      before = stops[i];
      after = stops[i + 1];
      break;
    }
  }
  
  // Calculate interpolation factor
  const range = after.position - before.position;
  const t = range > 0 ? (position - before.position) / range : 0;
  
  // Parse colors
  const beforeRGB = hexToRgb(before.color);
  const afterRGB = hexToRgb(after.color);
  
  // Interpolate
  const r = Math.round(beforeRGB.r + (afterRGB.r - beforeRGB.r) * t);
  const g = Math.round(beforeRGB.g + (afterRGB.g - beforeRGB.g) * t);
  const b = Math.round(beforeRGB.b + (afterRGB.b - beforeRGB.b) * t);
  
  return rgbToHex(r, g, b);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

export default GradientEditor;
