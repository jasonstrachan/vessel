import React, { useState, useCallback, useEffect, useRef } from 'react';
import Dropdown from './Dropdown';
import { useAppStore } from '../../stores/useAppStore';
import { useKeyboardScope } from '../../hooks/useKeyboardScope';

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

const normalizeStops = (stops: GradientStop[]): GradientStop[] =>
  stops.map((s) => ({ ...s, opacity: s.opacity ?? 1 }));

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
    const stored = localStorage.getItem('vessel_custom_gradients');
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
    localStorage.setItem('vessel_custom_gradients', JSON.stringify(customGradients));
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
  const startRecolorSampling = useAppStore((state) => state.startRecolorSampling);
  const addNotification = useAppStore((state) => state.addNotification);
  // Brush auto-sample state (used when sampleTarget === 'brush')
  const autoSampleEnabled = useAppStore(state => !!state.tools.brushSettings.autoSampleGradient);
  const setBrushSettings = useAppStore(state => state.setBrushSettings);
  // Track pending creation of a saved gradient from live sampling
  const pendingSampleAddRef = useRef<boolean>(false);
  const sampleStartSigRef = useRef<string>('');
  const prevAutoSampleRef = useRef<boolean>(autoSampleEnabled);
  const [stops, setStops] = useState<GradientStop[]>(normalizeStops(initialStops));
  const [selectedStop, setSelectedStop] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [savedGradients, setSavedGradients] = useState<SavedGradient[]>(loadGradients());
  const [selectedGradientId, setSelectedGradientId] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasFocus, setHasFocus] = useState(false);
  // Suspend global/canvas shortcuts while gradient editor is focused
  useKeyboardScope('gradient', hasFocus);
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Local undo/redo stacks (editor-scoped)
  const undoStackRef = useRef<GradientStop[][]>([]);
  const redoStackRef = useRef<GradientStop[][]>([]);
  const pushUndo = useCallback((snapshot: GradientStop[]) => {
    const snap = snapshot.map(s => ({ ...s }));
    undoStackRef.current.push(snap);
    // Clear redo on new edit
    redoStackRef.current = [];
    
  }, []);
  const doUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current.pop()!;
    const current = stops.map(s => ({ ...s }));
    redoStackRef.current.push(current);
    
    setStops(prev);
    setSelectedStop(null);
    onChange(prev);
  }, [stops, onChange]);
  const doRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop()!;
    const current = stops.map(s => ({ ...s }));
    undoStackRef.current.push(current);
    
    setStops(next);
    setSelectedStop(null);
    onChange(next);
  }, [stops, onChange]);

  const openColorPicker = useCallback((index: number) => {
    if (colorInputRef.current) {
      try {
        colorInputRef.current.value = stops[index]?.color || '#ffffff';
        // Focus container first so selection state is clear, then open picker
        containerRef.current?.focus();
        colorInputRef.current.click();
      } catch {}
    }
  }, [stops]);

  // Track last seen stops signature to avoid resetting selection on identical props
  const lastPropSigRef = useRef<string>('');

  const stopsSignature = useCallback((arr: GradientStop[]) =>
    arr
      .map(s => `${s.position.toFixed(4)}|${(s.opacity ?? 1).toFixed(3)}|${s.color.toLowerCase()}`)
      .join(','),
  []);

  // If auto-sample toggles ON for brush, arm a one-shot capture to add the next
  // sampled gradient to the saved list once stops meaningfully change.
  useEffect(() => {
    if (sampleTarget !== 'brush') return;
    if (autoSampleEnabled && !prevAutoSampleRef.current) {
      pendingSampleAddRef.current = true;
      // Record the signature at the moment sampling starts, so we can detect the first change
      sampleStartSigRef.current = stopsSignature(normalizeStops(initialStops));
    }
    prevAutoSampleRef.current = autoSampleEnabled;
  }, [autoSampleEnabled, initialStops, sampleTarget, stopsSignature]);

  // Update internal state when props meaningfully change (content-based),
  // preserving selection whenever possible.
  useEffect(() => {
    const normalized = normalizeStops(initialStops);
    const nextSig = stopsSignature(normalized);
    if (nextSig !== lastPropSigRef.current) {
      lastPropSigRef.current = nextSig;
      // props changed: update internal stops and try to preserve selection
      setStops(normalized);
      // Try to preserve selected stop by matching on position+color or nearest position
      setSelectedStop(prev => {
        if (prev === null || prev < 0) return prev;
        const prevStop = stops[prev];
        if (!prevStop) return null;
        const exactIdx = normalized.findIndex(s => s.position === prevStop.position && s.color.toLowerCase() === prevStop.color.toLowerCase());
        if (exactIdx !== -1) return exactIdx;
        if (normalized.length === 0) return null;
        let nearestIdx = 0;
        let minDiff = Math.abs(normalized[0].position - prevStop.position);
        for (let i = 1; i < normalized.length; i++) {
          const d = Math.abs(normalized[i].position - prevStop.position);
          if (d < minDiff) { minDiff = d; nearestIdx = i; }
        }
        return nearestIdx;
      });

      // If we're armed to capture the first sampled gradient after enabling
      // auto-sampling for brush, and the new props reflect a different gradient,
      // add it into the saved list exactly once.
      if (sampleTarget === 'brush' && pendingSampleAddRef.current) {
        const changedFromStart = nextSig && nextSig !== sampleStartSigRef.current;
        if (changedFromStart) {
          const newId = `sampled-${Date.now()}`;
          const newEntry: SavedGradient = { id: newId, name: 'Sampled', stops: normalized.map(s => ({ ...s })) };
          setSavedGradients(prev => {
            // Avoid duplicates if an identical gradient already exists
            const exists = prev.some(g => stopsSignature(normalizeStops(g.stops)) === nextSig);
            const updated = exists ? prev : [...prev, newEntry];
            saveCustomGradients(updated);
            return updated;
          });
          setSelectedGradientId(newId);
          pendingSampleAddRef.current = false;
        }
      }
    }
  }, [initialStops, sampleTarget, stops, stopsSignature]);
  
  // Update saved gradient when stops change without triggering recursive renders
  useEffect(() => {
    if (!selectedGradientId || stops.length === 0) return;

    const normalizedStops = stops.map(stop => ({
      ...stop,
      opacity: stop.opacity ?? 1
    }));
    const incomingSignature = stopsSignature(normalizedStops);

    setSavedGradients(prev => {
      const index = prev.findIndex(g => g.id === selectedGradientId);
      if (index === -1) return prev;

      const target = prev[index];
      const existingSignature = stopsSignature(
        (target.stops ?? []).map(stop => ({
          ...stop,
          opacity: stop.opacity ?? 1
        }))
      );

      if (existingSignature === incomingSignature) {
        return prev;
      }

      const updated = [...prev];
      updated[index] = { ...target, stops: normalizedStops };
      saveCustomGradients(updated);
      return updated;
    });
  }, [stops, selectedGradientId, stopsSignature]);

  // Generate CSS gradient string with opacity (fallback transparent when no stops)
  const gradientString = (stops.length > 0
    ? stops
        .map(s => {
          const opacity = s.opacity ?? 1;
          const hex = s.color;
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          return `rgba(${r}, ${g}, ${b}, ${opacity}) ${s.position * 100}%`;
        })
        .join(', ')
    : 'rgba(0,0,0,0) 0%, rgba(0,0,0,0) 100%');

  const handleStopClick = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedStop(index);
    // Keep focus on container so Delete works immediately
    containerRef.current?.focus();
  }, []);

  const handleStopDoubleClick = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedStop(index);
    openColorPicker(index);
  }, [openColorPicker]);

  const handleColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (selectedStop === null) return;

    pushUndo(stops);
    
    const newStops = [...stops];
    newStops[selectedStop].color = e.target.value;
    setStops(newStops);
    onChange(newStops);
  }, [selectedStop, stops, onChange, pushUndo]);

  const handleStopMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    setSelectedStop(index);
    setIsDragging(true);
    // Ensure container receives keyboard events while dragging
    containerRef.current?.focus();
    // Capture snapshot for undo at drag start
    pushUndo(stops);
  }, [stops, pushUndo]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || selectedStop === null || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const position = Math.max(0, Math.min(1, x / rect.width));

    const newStops = [...stops];
    // Track the actual object being moved so selection stays with it
    const movedStop = newStops[selectedStop];
    movedStop.position = position;
    // Keep stops sorted by position
    newStops.sort((a, b) => a.position - b.position);
    const newIndex = newStops.indexOf(movedStop);
    
    // Selection follows the moved stop's new index
    setSelectedStop(newIndex);
    setStops(newStops);
    onChange(newStops);
  }, [isDragging, selectedStop, stops, onChange]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    // Drag finished
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
    // Ensure editor has focus so subsequent Delete/Backspace works
    containerRef.current.focus();
    pushUndo(stops);

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const position = Math.max(0, Math.min(1, x / rect.width));

    // Interpolate color at this position (or use default when no stops yet)
    const color = stops.length > 0 ? interpolateColor(position, stops) : '#ffffff';
    const newStop = { position, color, opacity: 1 } as GradientStop;
    const newStops = [...stops, newStop];
    newStops.sort((a, b) => a.position - b.position);
    setStops(newStops);
    // Select the newly added stop
    const sel = newStops.indexOf(newStop);
    setSelectedStop(sel);
    onChange(newStops);
  }, [stops, onChange, pushUndo]);

  // Keyboard: Delete/Backspace removes selected stop (keep at least 2)
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Always stop propagation so global shortcuts (e.g., canvas Delete) don't interfere
    // when the gradient editor is active.
    const key = e.key;
    const lower = key.toLowerCase();
    if (key === 'Enter' || lower === 'e' || key === 'Delete' || key === 'Backspace' || ((e.metaKey || e.ctrlKey) && (lower === 'z' || lower === 'y'))) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Local undo/redo when editor is focused
    if ((e.metaKey || e.ctrlKey) && lower === 'z') {
      if (e.shiftKey) {
        doRedo();
      } else {
        doUndo();
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && lower === 'y') {
      doRedo();
      return;
    }

    if (selectedStop === null) return;
    // Open color picker
    if (key === 'Enter' || lower === 'e') {
      openColorPicker(selectedStop);
      return;
    }
    // Delete stop
    if (key === 'Delete' || key === 'Backspace') {
      pushUndo(stops);
      const index = selectedStop;
      if (index < 0 || index >= stops.length) return;
      const newStops = stops.filter((_, i) => i !== index);
      const newSelected = newStops.length === 0 ? null : Math.min(index, newStops.length - 1);
      setStops(newStops);
      setSelectedStop(newSelected);
      onChange(newStops);
    }
  }, [selectedStop, stops, onChange, openColorPicker, pushUndo, doUndo, doRedo]);


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
          setSelectedStop(null);
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
      setSelectedStop(null);
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
    setSelectedStop(null);
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
          className="flex-1 h-5"
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
    <div className={`gradient-editor relative ${className}`}>
      {/* Preset selector */}
      <div className="mb-2">
        <Dropdown
          value={selectedGradientId}
          options={[
            { value: 'original', label: 'Original' },
            ...savedGradients.map(g => ({ value: g.id, label: g.name })),
            { value: 'add', label: '+ Add', isAction: true },
            // Replace "+ Sample" with a Sampling toggle when editing brush gradients
            ...(sampleTarget === 'brush'
              ? [{ value: 'toggle-sampled', label: 'Sample', isAction: true }]
              : [{ value: 'sample', label: '+ Sample', isAction: true }]
            )
          ]}
          onChange={handleGradientSelect}
          onAction={(action) => {
            if (action === 'add') {
              handleAddGradient();
            } else if (action === 'sample') {
              // Kick off recolor or brush sampling mode via line-drag
              try {
                startRecolorSampling(12, sampleTarget);
                addNotification?.({ type: 'info', title: 'Sampling', message: 'Click and drag on the canvas to sample a gradient and flow direction.', timestamp: new Date() });
              } catch {}
            } else if (action === 'toggle-sampled') {
              // One-shot sampling for brush mode: always enable sampling and arm capture
              try {
                setBrushSettings({ autoSampleGradient: true });
                pendingSampleAddRef.current = true;
                sampleStartSigRef.current = stopsSignature(stops);
                addNotification?.({ type: 'info', title: 'Sampling', message: 'Sampling enabled for one use. Draw to sample; it will auto-disable after applying.', timestamp: new Date() });
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
                        className="flex-1 h-5"
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
          className="absolute inset-0"
          style={{
            backgroundImage: `repeating-conic-gradient(#e9e9ec 0% 25%, #f6f6f8 0% 50%)`,
            backgroundSize: '16px 16px',
          }}
        />
        {/* Gradient overlay */}
        <div 
          ref={containerRef}
          tabIndex={0}
          className="relative h-8 cursor-pointer focus:outline-none"
          style={{ 
            background: `linear-gradient(90deg, ${gradientString})` 
          }}
          onFocus={() => setHasFocus(true)}
          onBlur={() => setHasFocus(false)}
          onMouseDownCapture={(e) => {
            // Ensure container retains focus before any click/drag handlers run
            try { (e.currentTarget as HTMLDivElement).focus(); } catch {}
          }}
          onClick={handleAddStop}
          onKeyDown={handleKeyDown}
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
              onDoubleClick={(e) => handleStopDoubleClick(index, e)}
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
