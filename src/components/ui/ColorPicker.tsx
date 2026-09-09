import React, { useRef, useEffect, useCallback, useState, useMemo } from "react";

import Input from "./Input";

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  onCommit?: () => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  className?: string;
  showHexInput?: boolean;
  allowTransparent?: boolean;
}

interface HSV {
  h: number;
  s: number;
  v: number;
}

const GRID_COLS = 14;
const GRID_ROWS = 14;
const HUE_WIDTH = 28;
const GRID_INDEX_EPSILON = 1e-9;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const getGridIndex = (percentage: number, cellCount: number): number => clamp(
  // Cell-derived percentages can land just below their integer index.
  Math.floor((percentage / 100) * cellCount + GRID_INDEX_EPSILON),
  0,
  cellCount - 1,
);

const getPickerPoint = (
  surface: HTMLDivElement,
  clientX: number,
  clientY: number,
  width: number,
  height: number,
): { x: number; y: number } => {
  const rect = surface.getBoundingClientRect();
  const left = Number.isFinite(rect.left) ? rect.left : 0;
  const top = Number.isFinite(rect.top) ? rect.top : 0;
  const safeClientX = Number.isFinite(clientX) ? clientX : left;
  const safeClientY = Number.isFinite(clientY) ? clientY : top;
  const scaleX = rect.width > 0 ? width / rect.width : 1;
  const scaleY = rect.height > 0 ? height / rect.height : 1;

  return {
    x: clamp((safeClientX - left) * scaleX, 0, width - 1),
    y: clamp((safeClientY - top) * scaleY, 0, height - 1),
  };
};

function hexToHsv(hex: string): HSV {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  return { h, s: s * 100, v: v * 100 };
}

function hsvToHex(h: number, s: number, v: number): string {
  s /= 100;
  v /= 100;

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0,
    g = 0,
    b = 0;

  if (h >= 0 && h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h >= 60 && h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h >= 180 && h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h >= 240 && h < 300) {
    r = x;
    g = 0;
    b = c;
  } else if (h >= 300 && h < 360) {
    r = c;
    g = 0;
    b = x;
  }

  const red = Math.round((r + m) * 255);
  const green = Math.round((g + m) * 255);
  const blue = Math.round((b + m) * 255);

  return `#${red.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}${blue.toString(16).padStart(2, "0")}`;
}

export default function ColorPicker({
  color,
  onChange,
  onCommit,
  onInteractionStart,
  onInteractionEnd,
  className = "",
  showHexInput = false,
  allowTransparent = false,
}: ColorPickerProps) {
  const svSurfaceRef = useRef<HTMLDivElement>(null);
  const hueSurfaceRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [isDraggingHue, setIsDraggingHue] = useState(false);
  const [svSize, setSvSize] = useState(212);

  const normalizedColor = typeof color === "string" ? color.trim() : "";
  const fallbackHex = "#FFFFFF";
  const isColorTransparent = allowTransparent && normalizedColor.toLowerCase() === "transparent";
  const safeHex = /^#[0-9A-F]{6}$/i.test(normalizedColor) ? normalizedColor.toUpperCase() : fallbackHex;

  const [isTransparent, setIsTransparent] = useState(isColorTransparent);
  const [currentHsv, setCurrentHsv] = useState<HSV>(() => hexToHsv(safeHex));
  const [hexValue, setHexValue] = useState(isColorTransparent ? "TRANSPARENT" : safeHex);
  const lastOpaqueHexRef = useRef<string>(isColorTransparent ? safeHex : safeHex);
  const pendingHsvRef = useRef<HSV | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastAppliedHsvRef = useRef<HSV>(hexToHsv(safeHex));

  // Page elements keep the picker visible even when drawing contexts are unavailable.
  const cells = useMemo(() => Array.from({ length: GRID_COLS * GRID_ROWS }, (_, index) => {
    const row = Math.floor(index / GRID_COLS);
    const col = index % GRID_COLS;
    const color = index === 0
      ? '#ffffff'
      : index === GRID_COLS * GRID_ROWS - 1
        ? '#000000'
        : hsvToHex(currentHsv.h, (col / GRID_COLS) * 100, ((GRID_ROWS - row) / GRID_ROWS) * 100);
    return <span key={index} style={{ backgroundColor: color }} />;
  }), [currentHsv.h]);

  useEffect(() => {
    const raw = typeof color === "string" ? color.trim() : "";
    const lower = raw.toLowerCase();

    if (allowTransparent && lower === "transparent") {
      setIsTransparent(true);
      setHexValue("TRANSPARENT");
      return;
    }

    if (/^#[0-9A-F]{6}$/i.test(raw)) {
      const upper = raw.toUpperCase();
      setIsTransparent(false);
      setHexValue(upper);

      // Preserve local grid-cell precision when the parent echoes back
      // the same hex value this picker already emitted.
      if (upper === lastOpaqueHexRef.current) {
        return;
      }

      const nextHsv = hexToHsv(upper);
      setCurrentHsv(nextHsv);
      lastOpaqueHexRef.current = upper;
      lastAppliedHsvRef.current = nextHsv;
    }
  }, [color, allowTransparent]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const MIN_SV_SIZE = 120;

    const updateSize = () => {
      const availableWidth = container.clientWidth;
      if (!availableWidth) return;
      const nextSize = Math.max(MIN_SV_SIZE, Math.floor(availableWidth - HUE_WIDTH));
      setSvSize(nextSize);
    };

    updateSize();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        updateSize();
      });
      observer.observe(container);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const applyHsvUpdate = useCallback(
    (newHsv: HSV) => {
      const last = lastAppliedHsvRef.current;
      if (last.h === newHsv.h && last.s === newHsv.s && last.v === newHsv.v) {
        return;
      }
      const hex = hsvToHex(newHsv.h, newHsv.s, newHsv.v).toUpperCase();
      setIsTransparent(false);
      setCurrentHsv(newHsv);
      setHexValue(hex);
      lastOpaqueHexRef.current = hex;
      lastAppliedHsvRef.current = newHsv;
      onChange(hex);
    },
    [onChange],
  );

  const scheduleHsvUpdate = useCallback(
    (newHsv: HSV) => {
      pendingHsvRef.current = newHsv;
      if (rafRef.current === null && typeof window !== "undefined") {
        rafRef.current = window.requestAnimationFrame(() => {
          rafRef.current = null;
          const pending = pendingHsvRef.current;
          if (pending) {
            pendingHsvRef.current = null;
            applyHsvUpdate(pending);
          }
        });
      }
    },
    [applyHsvUpdate],
  );

  const flushPendingHsv = useCallback(() => {
    if (rafRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const pending = pendingHsvRef.current;
    if (pending) {
      pendingHsvRef.current = null;
      applyHsvUpdate(pending);
    }
  }, [applyHsvUpdate]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const applyHex = useCallback(
    (hex: string) => {
      const normalized = hex.trim().toUpperCase();
      if (!/^#[0-9A-F]{6}$/.test(normalized)) {
        return;
      }
      const nextHsv = hexToHsv(normalized);
      setIsTransparent(false);
      setCurrentHsv(nextHsv);
      setHexValue(normalized);
      lastOpaqueHexRef.current = normalized;
      lastAppliedHsvRef.current = nextHsv;
      onChange(normalized);
      onCommit?.();
    },
    [onChange, onCommit],
  );

  const handleTransparentToggle = useCallback(
    (checked: boolean) => {
      if (!allowTransparent) {
        return;
      }
      if (checked) {
        setIsTransparent(true);
        setHexValue("TRANSPARENT");
        onChange("transparent");
        onCommit?.();
        return;
      }

      const fallback = lastOpaqueHexRef.current || fallbackHex;
      const nextHsv = hexToHsv(fallback);
      setIsTransparent(false);
      setCurrentHsv(nextHsv);
      setHexValue(fallback);
      lastOpaqueHexRef.current = fallback;
      lastAppliedHsvRef.current = nextHsv;
      onChange(fallback);
      onCommit?.();
    },
    [allowTransparent, onChange, onCommit],
  );

  const sanitizeHexInput = (value: string) => {
    const trimmed = value.trim().replace(/^#+/, '');
    const filtered = trimmed.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    return `#${filtered}`.toUpperCase();
  };

  const handleHexInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const rawValue = event.target.value;
      if (allowTransparent && rawValue.trim().toLowerCase() === "transparent") {
        if (!isTransparent) {
          handleTransparentToggle(true);
        }
        setHexValue("TRANSPARENT");
        return;
      }

      const next = sanitizeHexInput(rawValue);
      if (isTransparent) {
        setIsTransparent(false);
      }
      setHexValue(next);
      if (next.length === 7) {
        applyHex(next);
      }
    },
    [allowTransparent, applyHex, handleTransparentToggle, isTransparent],
  );

  const handleHexInputBlur = useCallback(() => {
    if (isTransparent) {
      setHexValue("TRANSPARENT");
      return;
    }

    if (!/^#[0-9A-F]{6}$/.test(hexValue)) {
      const fallback = lastOpaqueHexRef.current || fallbackHex;
      setHexValue(fallback);
      onCommit?.();
    }
  }, [hexValue, isTransparent, onCommit]);

  const handleHexInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (isTransparent) {
          onChange("transparent");
        } else {
          applyHex(hexValue);
        }
        onCommit?.();
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (isTransparent) {
          setHexValue("TRANSPARENT");
        } else {
          const fallback = lastOpaqueHexRef.current || fallbackHex;
          setHexValue(fallback);
        }
        (event.currentTarget as HTMLInputElement).blur();
      }
    },
    [applyHex, hexValue, isTransparent, onChange, onCommit],
  );

  const handleSVPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const surface = svSurfaceRef.current;
      if (!surface) return;

      surface.setPointerCapture(e.pointerId);
      setIsPointerDown(true);
      onInteractionStart?.();

      const { x, y } = getPickerPoint(surface, e.clientX, e.clientY, svSize, svSize);

      const cellWidth = svSize / GRID_COLS;
      const cellHeight = svSize / GRID_ROWS;
      const gridCol = Math.floor(x / cellWidth);
      const gridRow = Math.floor(y / cellHeight);
      const clampedCol = clamp(gridCol, 0, GRID_COLS - 1);
      const clampedRow = clamp(gridRow, 0, GRID_ROWS - 1);

      // Check for special cells
      if (clampedCol === 0 && clampedRow === 0) {
        // Top-left: pure white
        applyHsvUpdate({ ...currentHsv, s: 0, v: 100 });
      } else if (clampedCol === GRID_COLS - 1 && clampedRow === GRID_ROWS - 1) {
        // Bottom-right: pure black
        applyHsvUpdate({ ...currentHsv, s: 0, v: 0 });
      } else {
        // Normal color selection
        const s = (clampedCol / GRID_COLS) * 100;
        const v = ((GRID_ROWS - clampedRow) / GRID_ROWS) * 100;
        applyHsvUpdate({ ...currentHsv, s, v });
      }
    },
    [currentHsv, applyHsvUpdate, onInteractionStart, svSize],
  );

  const handleSVPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPointerDown) return;

      const surface = svSurfaceRef.current;
      if (!surface) return;

      const { x, y } = getPickerPoint(surface, e.clientX, e.clientY, svSize, svSize);

      const cellWidth = svSize / GRID_COLS;
      const cellHeight = svSize / GRID_ROWS;
      const gridCol = Math.floor(x / cellWidth);
      const gridRow = Math.floor(y / cellHeight);
      const clampedCol = clamp(gridCol, 0, GRID_COLS - 1);
      const clampedRow = clamp(gridRow, 0, GRID_ROWS - 1);

      // Check for special cells
      if (clampedCol === 0 && clampedRow === 0) {
        // Top-left: pure white
        scheduleHsvUpdate({ ...currentHsv, s: 0, v: 100 });
      } else if (clampedCol === GRID_COLS - 1 && clampedRow === GRID_ROWS - 1) {
        // Bottom-right: pure black
        scheduleHsvUpdate({ ...currentHsv, s: 0, v: 0 });
      } else {
        // Normal color selection
        const s = (clampedCol / GRID_COLS) * 100;
        const v = ((GRID_ROWS - clampedRow) / GRID_ROWS) * 100;
        scheduleHsvUpdate({ ...currentHsv, s, v });
      }
    },
    [isPointerDown, currentHsv, scheduleHsvUpdate, svSize],
  );

  const handleSVPointerUp = useCallback((e: React.PointerEvent) => {
    const surface = svSurfaceRef.current;
    if (!surface) return;

    surface.releasePointerCapture(e.pointerId);
    setIsPointerDown(false);
    flushPendingHsv();
    onInteractionEnd?.();
    onCommit?.();
  }, [flushPendingHsv, onCommit, onInteractionEnd]);

  const handleHuePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const surface = hueSurfaceRef.current;
      if (!surface) return;

      surface.setPointerCapture(e.pointerId);
      setIsDraggingHue(true);
      onInteractionStart?.();

      const { y } = getPickerPoint(surface, e.clientX, e.clientY, HUE_WIDTH, svSize);
      const h = (y / svSize) * 360;

      applyHsvUpdate({ ...currentHsv, h });
    },
    [currentHsv, applyHsvUpdate, onInteractionStart, svSize],
  );

  const handleHuePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingHue) return;

      const surface = hueSurfaceRef.current;
      if (!surface) return;

      const { y } = getPickerPoint(surface, e.clientX, e.clientY, HUE_WIDTH, svSize);
      const h = (y / svSize) * 360;

      scheduleHsvUpdate({ ...currentHsv, h });
    },
    [isDraggingHue, currentHsv, scheduleHsvUpdate, svSize],
  );

  const handleHuePointerUp = useCallback((e: React.PointerEvent) => {
    const surface = hueSurfaceRef.current;
    if (!surface) return;

    surface.releasePointerCapture(e.pointerId);
    setIsDraggingHue(false);
    flushPendingHsv();
    onInteractionEnd?.();
    onCommit?.();
  }, [flushPendingHsv, onCommit, onInteractionEnd]);

  // Geometry for selection overlay
  const cellWidth = svSize / GRID_COLS;
  const cellHeight = svSize / GRID_ROWS;
  const normalizedHexValue = hexValue.trim().toUpperCase();
  const isPureBlackCell = normalizedHexValue === '#000000';
  const isPureWhiteCell = normalizedHexValue === '#FFFFFF';
  const indicatorCol = isPureBlackCell
    ? GRID_COLS - 1
    : isPureWhiteCell
      ? 0
      : getGridIndex(currentHsv.s, GRID_COLS);
  const indicatorRow = isPureBlackCell
    ? GRID_ROWS - 1
    : isPureWhiteCell
      ? 0
      : getGridIndex(100 - currentHsv.v, GRID_ROWS);
  const indicatorX = indicatorCol * cellWidth;
  const indicatorY = indicatorRow * cellHeight;
  const indicatorStroke = currentHsv.v > 50 ? "#000" : "#fff";

  return (
    <div
      ref={containerRef}
      className={`flex w-full flex-col gap-2 ${className}`}
    >
      <div className="flex w-full items-start justify-start gap-0">
        <div className="relative" style={{ width: svSize, height: svSize }}>
          <div
            ref={svSurfaceRef}
            data-color-picker="sv"
            className="cursor-crosshair"
            onPointerDown={handleSVPointerDown}
            onPointerMove={handleSVPointerMove}
            onPointerUp={handleSVPointerUp}
            style={{
              touchAction: 'none',
              display: 'grid',
              gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
              gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)`,
              width: svSize,
              height: svSize,
            }}
          >
            {cells}
          </div>
          <div
            className="pointer-events-none absolute left-0 top-0"
            style={{
              transform: `translate(${indicatorX}px, ${indicatorY}px)`,
              width: `${cellWidth}px`,
              height: `${cellHeight}px`,
              border: `1px solid ${indicatorStroke}`,
              boxSizing: "border-box",
            }}
          />
        </div>
        <div
          ref={hueSurfaceRef}
          data-color-picker="hue"
          className="relative cursor-pointer overflow-hidden shrink-0"
          onPointerDown={handleHuePointerDown}
          onPointerMove={handleHuePointerMove}
          onPointerUp={handleHuePointerUp}
          style={{
            touchAction: 'none',
            width: HUE_WIDTH,
            height: svSize,
            background: 'linear-gradient(to bottom, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
          }}
        >
          <div
            className="pointer-events-none absolute left-0 w-full"
            style={{ top: (currentHsv.h / 360) * svSize - 2, height: 4, backgroundColor: '#fff' }}
          >
            <div style={{ margin: '1px 2px', height: 2, backgroundColor: '#000' }} />
          </div>
        </div>
      </div>
      {showHexInput ? (
        <div className="flex items-center gap-2 text-xs text-[#CCCCCC]">
          <span className="uppercase tracking-wide">Hex</span>
          <Input
            value={hexValue}
            onChange={handleHexInputChange}
            onBlur={handleHexInputBlur}
            onKeyDown={handleHexInputKeyDown}
            placeholder={allowTransparent ? '#RRGGBB or transparent' : '#RRGGBB'}
            maxLength={allowTransparent ? 11 : 7}
            variant="hex"
            spellCheck={false}
            className="bg-[#1F1F1F] border-[#444] text-[#F0F0F0] focus:border-[#888]"
          />
        </div>
      ) : null}
      {allowTransparent ? (
        <label className="flex items-center gap-2 text-xs text-[#CCCCCC]">
          <input
            type="checkbox"
            className="h-3 w-3 accent-[#888]"
            checked={isTransparent}
            onChange={(event) => handleTransparentToggle(event.target.checked)}
          />
          Transparent
        </label>
      ) : null}
    </div>
  );
}
