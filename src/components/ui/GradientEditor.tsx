import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import ColorPicker from './ColorPicker';
import { useKeyboardScope } from '../../hooks/useKeyboardScope';

interface GradientStop {
  position: number;
  color: string;
  opacity?: number;
}

interface GradientEditorProps {
  stops: GradientStop[];
  onChange: (stops: GradientStop[]) => void;
  className?: string;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  // When user chooses "+ Sample" in the dropdown, where should the sampled gradient apply?
  // 'recolor' updates the active recolor layer; 'brush' updates the brush gradient.
  sampleTarget?: 'recolor' | 'brush';
}

export type GradientEditorHandle = {
  flushDraft: () => void;
  endEditSession: () => void;
};

const toGradientStop = (stop: GradientStop): GradientStop => ({
  position: stop.position,
  color: stop.color,
  opacity: stop.opacity ?? 1,
});

const normalizeStops = (stops: GradientStop[]): GradientStop[] =>
  stops.map(toGradientStop);

const clampAlpha = (value: number): number => Math.max(0, Math.min(1, value));

type ParsedColor = { r: number; g: number; b: number; a: number };

const parseHexColor = (value: string): ParsedColor | null => {
  const normalized = value.trim();
  if (/^#[0-9A-F]{3}$/i.test(normalized)) {
    const r = parseInt(normalized[1] + normalized[1], 16);
    const g = parseInt(normalized[2] + normalized[2], 16);
    const b = parseInt(normalized[3] + normalized[3], 16);
    return { r, g, b, a: 1 };
  }

  if (/^#[0-9A-F]{6}$/i.test(normalized)) {
    return {
      r: parseInt(normalized.slice(1, 3), 16),
      g: parseInt(normalized.slice(3, 5), 16),
      b: parseInt(normalized.slice(5, 7), 16),
      a: 1,
    };
  }

  if (!/^#[0-9A-F]{8}$/i.test(normalized)) {
    return null;
  }

  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
    a: parseInt(normalized.slice(7, 9), 16) / 255,
  };
};

const parseRgbColor = (value: string): ParsedColor | null => {
  const normalized = value.trim();
  const match = normalized.match(/^rgba?\(([^)]+)\)$/i);
  if (!match) {
    return null;
  }

  const parts = match[1].split(',').map((part) => part.trim());
  if (parts.length < 3) {
    return null;
  }

  const parseChannel = (raw: string): number => {
    if (raw.endsWith('%')) {
      const pct = Number.parseFloat(raw.slice(0, -1));
      return Number.isFinite(pct) ? Math.max(0, Math.min(255, (pct / 100) * 255)) : 0;
    }
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? Math.max(0, Math.min(255, value)) : 0;
  };

  const r = parseChannel(parts[0]);
  const g = parseChannel(parts[1]);
  const b = parseChannel(parts[2]);
  const a = parts[3] !== undefined ? clampAlpha(Number.parseFloat(parts[3])) : 1;
  return { r, g, b, a };
};

const parseColor = (value: string): ParsedColor | null => {
  const normalized = value.trim();
  if (normalized.toLowerCase() === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  return parseHexColor(normalized) ?? parseRgbColor(normalized);
};

const CHECKERBOARD_AVG = { r: 239, g: 239, b: 242 };

const toLinear = (channel: number): number => {
  const srgb = channel / 255;
  if (srgb <= 0.04045) {
    return srgb / 12.92;
  }
  return ((srgb + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = (r: number, g: number, b: number): number =>
  (0.2126 * toLinear(r)) + (0.7152 * toLinear(g)) + (0.0722 * toLinear(b));

const contrastRatio = (l1: number, l2: number): number => {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
};

const getStopFillColor = (stop: GradientStop): string => {
  const colorValue = stop.color ?? '#000000';
  const normalizedColor = colorValue.trim();
  const alpha = clampAlpha(stop.opacity ?? 1);

  if (normalizedColor.toLowerCase() === 'transparent') {
    return 'transparent';
  }

  const parsedHex = parseHexColor(normalizedColor);
  if (parsedHex) {
    const { r, g, b } = parsedHex;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return normalizedColor;
};

const getStopBorderColor = (stop: GradientStop, isSelected: boolean): string => {
  const parsed = parseColor(stop.color ?? '#000000');
  if (!parsed) {
    return isSelected ? 'rgba(0, 0, 0, 1)' : 'rgba(0, 0, 0, 0.82)';
  }

  const explicitOpacity = clampAlpha(stop.opacity ?? 1);
  const effectiveAlpha = clampAlpha(parsed.a * explicitOpacity);
  const bg = CHECKERBOARD_AVG;
  const blendedR = Math.round((parsed.r * effectiveAlpha) + (bg.r * (1 - effectiveAlpha)));
  const blendedG = Math.round((parsed.g * effectiveAlpha) + (bg.g * (1 - effectiveAlpha)));
  const blendedB = Math.round((parsed.b * effectiveAlpha) + (bg.b * (1 - effectiveAlpha)));
  const swatchL = relativeLuminance(blendedR, blendedG, blendedB);
  const whiteContrast = contrastRatio(swatchL, 1);
  const blackContrast = contrastRatio(swatchL, 0);
  const useWhiteBorder = whiteContrast > blackContrast;

  if (useWhiteBorder) {
    return isSelected ? 'rgba(255, 255, 255, 1)' : 'rgba(255, 255, 255, 0.86)';
  }
  return isSelected ? 'rgba(0, 0, 0, 1)' : 'rgba(0, 0, 0, 0.82)';
};

const stopToCssGradientPart = (stop: GradientStop): string => {
  const colorValue = (stop.color ?? '#000000').trim();
  const parsed = parseColor(colorValue);
  if (!parsed) {
    const alpha = clampAlpha(typeof stop.opacity === 'number' ? stop.opacity : 0);
    return `rgba(0, 0, 0, ${alpha}) ${stop.position * 100}%`;
  }

  const stopOpacity = clampAlpha(typeof stop.opacity === 'number' ? stop.opacity : 1);
  const alpha = clampAlpha(parsed.a * stopOpacity);
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha}) ${stop.position * 100}%`;
};

export const GradientEditor = forwardRef<GradientEditorHandle, GradientEditorProps>(({
  stops: initialStops, 
  onChange,
  className = '',
  onEditStart,
  onEditEnd,
  sampleTarget = 'recolor'
}, ref) => {
  const [stops, setStops] = useState<GradientStop[]>(normalizeStops(initialStops));
  const [selectedStop, setSelectedStop] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const prevStopsRef = useRef<GradientStop[]>(stops);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasFocus, setHasFocus] = useState(false);
  // Suspend global/canvas shortcuts while gradient editor is focused
  useKeyboardScope('gradient', hasFocus);
  const [activeColorPickerIndex, setActiveColorPickerIndex] = useState<number | null>(null);
  const colorPickerOverlayRef = useRef<HTMLDivElement>(null);
  const colorPickerUndoRef = useRef(false);
  const pendingGradientUpdateRef = useRef<number | null>(null);
  const pendingGradientStopsRef = useRef<GradientStop[] | null>(null);
  const editSessionActiveRef = useRef(false);
  const editSessionTimeoutRef = useRef<number | null>(null);
  const gradientHeightClass = sampleTarget === 'brush' ? 'h-4' : 'h-8';

  const beginEditSession = useCallback(() => {
    if (!editSessionActiveRef.current) {
      editSessionActiveRef.current = true;
      onEditStart?.();
    }
    if (editSessionTimeoutRef.current !== null) {
      window.clearTimeout(editSessionTimeoutRef.current);
    }
    editSessionTimeoutRef.current = window.setTimeout(() => {
      editSessionTimeoutRef.current = null;
      if (editSessionActiveRef.current) {
        editSessionActiveRef.current = false;
        onEditEnd?.();
      }
    }, 320);
  }, [onEditStart, onEditEnd]);

  const endEditSession = useCallback(() => {
    if (editSessionTimeoutRef.current !== null) {
      window.clearTimeout(editSessionTimeoutRef.current);
      editSessionTimeoutRef.current = null;
    }
    if (editSessionActiveRef.current) {
      editSessionActiveRef.current = false;
      onEditEnd?.();
    }
  }, [onEditEnd]);

  const flushPendingGradientUpdate = useCallback(() => {
    if (pendingGradientUpdateRef.current !== null) {
      cancelAnimationFrame(pendingGradientUpdateRef.current);
      pendingGradientUpdateRef.current = null;
    }
    if (pendingGradientStopsRef.current) {
      onChange(pendingGradientStopsRef.current);
      pendingGradientStopsRef.current = null;
    }
  }, [onChange]);

  const scheduleGradientUpdate = useCallback((nextStops: GradientStop[]) => {
    beginEditSession();
    pendingGradientStopsRef.current = nextStops;
    if (pendingGradientUpdateRef.current !== null) return;
    pendingGradientUpdateRef.current = requestAnimationFrame(() => {
      pendingGradientUpdateRef.current = null;
      if (pendingGradientStopsRef.current) {
        onChange(pendingGradientStopsRef.current);
        pendingGradientStopsRef.current = null;
      }
    });
  }, [beginEditSession, onChange]);

  useImperativeHandle(ref, () => ({
    flushDraft: flushPendingGradientUpdate,
    endEditSession,
  }), [endEditSession, flushPendingGradientUpdate]);

  useEffect(() => {
    return () => {
      flushPendingGradientUpdate();
      endEditSession();
    };
  }, [flushPendingGradientUpdate, endEditSession]);

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
    scheduleGradientUpdate(prev);
  }, [stops, scheduleGradientUpdate]);
  const doRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop()!;
    const current = stops.map(s => ({ ...s }));
    undoStackRef.current.push(current);
    
    setStops(next);
    setSelectedStop(null);
    scheduleGradientUpdate(next);
  }, [stops, scheduleGradientUpdate]);

  const openColorPicker = useCallback((index: number) => {
    setSelectedStop(index);
    setActiveColorPickerIndex(index);
    containerRef.current?.focus();
    colorPickerUndoRef.current = false;
  }, []);

  const closeColorPicker = useCallback(() => {
    setActiveColorPickerIndex(null);
    colorPickerUndoRef.current = false;
    endEditSession();
  }, [endEditSession]);

  useEffect(() => {
    if (activeColorPickerIndex === null) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeColorPicker();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [activeColorPickerIndex, closeColorPicker]);

  useEffect(() => {
    if (activeColorPickerIndex === null) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (colorPickerOverlayRef.current?.contains(target)) {
        return;
      }
      if (containerRef.current?.contains(target)) {
        return;
      }
      closeColorPicker();
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [activeColorPickerIndex, closeColorPicker]);

  useEffect(() => {
    if (activeColorPickerIndex === null) {
      return;
    }
    if (activeColorPickerIndex < 0 || activeColorPickerIndex >= stops.length) {
      closeColorPicker();
    }
  }, [activeColorPickerIndex, closeColorPicker, stops.length]);

  // Track last seen stops signature to avoid resetting selection on identical props
  const lastPropSigRef = useRef<string>('');

  const stopsSignature = useCallback((arr: GradientStop[]) =>
    arr
      .map(s => `${s.position.toFixed(4)}|${(s.opacity ?? 1).toFixed(3)}|${s.color.toLowerCase()}`)
      .join(','),
  []);

  // Update internal state when props meaningfully change (content-based),
  // preserving selection whenever possible.
  useEffect(() => {
    prevStopsRef.current = stops;
  }, [stops]);

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
        const prevStops = prevStopsRef.current;
        const prevStop = prevStops[prev];
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

      setSelectedStop(null);
    }
  }, [initialStops, sampleTarget, stopsSignature]);

  // Generate CSS gradient string with opacity (fallback transparent when no stops)
  const gradientString = (stops.length > 0
    ? stops
      .map(stopToCssGradientPart)
      .join(', ')
    : 'rgba(0,0,0,0) 0%, rgba(0,0,0,0) 100%');

  const handleStopClick = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedStop(index);
    // Keep focus on container so Delete works immediately
    containerRef.current?.focus();
    setActiveColorPickerIndex(prev => {
      if (prev !== null) {
        colorPickerUndoRef.current = false;
        return index;
      }
      return prev;
    });
  }, []);

  const handleStopDoubleClick = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedStop(index);
    openColorPicker(index);
  }, [openColorPicker]);

  const requestDitherWarmup = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('vessel:dither-warmup-request'));
  }, []);

  const handleColorPickerChange = useCallback((nextColor: string) => {
    const raw = nextColor.trim();
    const lower = raw.toLowerCase();
    const isTransparentSelection = lower === 'transparent';

    if (!isTransparentSelection && !/^#[0-9A-F]{6}$/i.test(raw)) {
      return;
    }

    const normalized = isTransparentSelection ? 'transparent' : raw.toUpperCase();

    setStops(prevStops => {
      const index = activeColorPickerIndex;
      if (index === null || index < 0 || index >= prevStops.length) {
        return prevStops;
      }

      const currentColor = prevStops[index].color;
      if (currentColor === normalized) {
        return prevStops;
      }

      if (!colorPickerUndoRef.current) {
        pushUndo(prevStops);
        colorPickerUndoRef.current = true;
      }

      const updatedStops = prevStops.map((stop, stopIdx) => {
        if (stopIdx !== index) {
          return stop;
        }

        if (isTransparentSelection) {
          return { ...stop, color: 'transparent', opacity: 0 };
        }

        const shouldRestoreOpacity =
          typeof stop.opacity === 'number'
            ? stop.opacity === 0 || (typeof stop.color === 'string' && stop.color.toLowerCase() === 'transparent')
            : true;

        return {
          ...stop,
          color: normalized,
          opacity: shouldRestoreOpacity ? 1 : stop.opacity
        };
      });

      scheduleGradientUpdate(updatedStops);
      return updatedStops;
    });
  }, [activeColorPickerIndex, pushUndo, scheduleGradientUpdate]);

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
    scheduleGradientUpdate(newStops);
  }, [isDragging, selectedStop, stops, scheduleGradientUpdate]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    endEditSession();
    // Drag finished
  }, [endEditSession]);

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
    scheduleGradientUpdate(newStops);
  }, [stops, scheduleGradientUpdate, pushUndo]);

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
      scheduleGradientUpdate(newStops);
    }
  }, [selectedStop, stops, openColorPicker, pushUndo, doUndo, doRedo, scheduleGradientUpdate]);


  // Deleting stops via UI removed; keep logic minimal in component

  return (
    <div className={`gradient-editor relative ${className}`}>
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
          className={`relative ${gradientHeightClass} cursor-pointer focus:outline-none`}
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
                className="relative w-4 h-4 shadow-lg"
                style={{
                  backgroundColor: getStopFillColor(stop)
                }}
              >
                <div
                  className="pointer-events-none absolute inset-0"
                  aria-hidden="true"
                  style={{
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    borderColor: getStopBorderColor(stop, selectedStop === index),
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {activeColorPickerIndex !== null && stops[activeColorPickerIndex] ? (
        <div
          ref={colorPickerOverlayRef}
          className="absolute left-1/2 z-40 w-[260px] -translate-x-1/2 rounded-md border border-[#444] bg-[#161616] p-3 shadow-2xl"
          style={{ top: 'calc(100% + 12px)' }}
        >
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-[#BBBBBB]">
            <span>Stop Color</span>
            <button
              type="button"
              onClick={closeColorPicker}
              className="rounded px-1 py-0.5 text-[11px] text-[#888] transition-colors hover:bg-[#2A2A2A] hover:text-[#E0E0E0]"
            >
              Close
            </button>
          </div>
          <ColorPicker
            color={stops[activeColorPickerIndex].color}
            onChange={handleColorPickerChange}
            onCommit={requestDitherWarmup}
            showHexInput
            allowTransparent
            className="w-full"
          />
        </div>
      ) : null}

      {/* Controls removed per request */}
    </div>
  );
});
GradientEditor.displayName = 'GradientEditor';

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
  if (typeof hex === 'string' && hex.toLowerCase() === 'transparent') {
    return { r: 0, g: 0, b: 0 };
  }
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
