import React, { useRef, useEffect, useCallback, useState } from "react";

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

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

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
  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const hueCanvasRef = useRef<HTMLCanvasElement>(null);
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

  const drawSVCanvas = useCallback(
    (hue: number) => {
      const canvas = svCanvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      const cellWidth = width / GRID_COLS;
      const cellHeight = height / GRID_ROWS;

      for (let row = 0; row < GRID_ROWS; row++) {
        const y0 = Math.round(row * cellHeight);
        const y1 = Math.round((row + 1) * cellHeight);
        const gridY = row * cellHeight;

        for (let col = 0; col < GRID_COLS; col++) {
          const x0 = Math.round(col * cellWidth);
          const x1 = Math.round((col + 1) * cellWidth);
          const gridX = col * cellWidth;

          let hex;
          if (col === 0 && row === 0) {
            hex = "#ffffff";
          } else if (col === GRID_COLS - 1 && row === GRID_ROWS - 1) {
            hex = "#000000";
          } else {
            const s = (gridX / width) * 100;
            const v = ((height - gridY) / height) * 100;
            hex = hsvToHex(hue, s, v);
          }

          ctx.fillStyle = hex;
          ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        }
      }

    },
    [],
  );

  const drawHueCanvas = useCallback(() => {
    const canvas = hueCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#ff0000");
    gradient.addColorStop(1 / 6, "#ffff00");
    gradient.addColorStop(2 / 6, "#00ff00");
    gradient.addColorStop(3 / 6, "#00ffff");
    gradient.addColorStop(4 / 6, "#0000ff");
    gradient.addColorStop(5 / 6, "#ff00ff");
    gradient.addColorStop(1, "#ff0000");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw selection indicator
    const y = (currentHsv.h / 360) * canvas.height;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, y - 2, canvas.width, 4);
    ctx.fillStyle = "#000";
    ctx.fillRect(2, y - 1, canvas.width - 4, 2);

  }, [currentHsv.h]);

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

  useEffect(() => {
    drawSVCanvas(currentHsv.h);
    drawHueCanvas();
  }, [drawSVCanvas, drawHueCanvas, currentHsv.h, svSize]);

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
      const canvas = svCanvasRef.current;
      if (!canvas) return;

      canvas.setPointerCapture(e.pointerId);
      setIsPointerDown(true);
      onInteractionStart?.();

      const rect = canvas.getBoundingClientRect();
      const left = Number.isFinite(rect.left) ? rect.left : 0;
      const top = Number.isFinite(rect.top) ? rect.top : 0;
      const clientX = Number.isFinite(e.clientX) ? e.clientX : left;
      const clientY = Number.isFinite(e.clientY) ? e.clientY : top;
      const x = clamp(clientX - left, 0, canvas.width - 1);
      const y = clamp(clientY - top, 0, canvas.height - 1);

      const cellWidth = canvas.width / GRID_COLS;
      const cellHeight = canvas.height / GRID_ROWS;
      const gridCol = Math.floor(x / cellWidth);
      const gridRow = Math.floor(y / cellHeight);
      const clampedCol = clamp(gridCol, 0, GRID_COLS - 1);
      const clampedRow = clamp(gridRow, 0, GRID_ROWS - 1);

      // Check for special cells
      if (clampedCol === 0 && clampedRow === 0) {
        // Top-left: pure white
        applyHsvUpdate({ h: 0, s: 0, v: 100 });
      } else if (clampedCol === GRID_COLS - 1 && clampedRow === GRID_ROWS - 1) {
        // Bottom-right: pure black
        applyHsvUpdate({ h: 0, s: 0, v: 0 });
      } else {
        // Normal color selection
        const gridX = clampedCol * cellWidth;
        const gridY = clampedRow * cellHeight;
        const s = (gridX / canvas.width) * 100;
        const v = ((canvas.height - gridY) / canvas.height) * 100;
        applyHsvUpdate({ ...currentHsv, s, v });
      }
    },
    [currentHsv, applyHsvUpdate, onInteractionStart],
  );

  const handleSVPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPointerDown) return;

      const canvas = svCanvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const left = Number.isFinite(rect.left) ? rect.left : 0;
      const top = Number.isFinite(rect.top) ? rect.top : 0;
      const clientX = Number.isFinite(e.clientX) ? e.clientX : left;
      const clientY = Number.isFinite(e.clientY) ? e.clientY : top;
      const x = clamp(clientX - left, 0, canvas.width - 1);
      const y = clamp(clientY - top, 0, canvas.height - 1);

      const cellWidth = canvas.width / GRID_COLS;
      const cellHeight = canvas.height / GRID_ROWS;
      const gridCol = Math.floor(x / cellWidth);
      const gridRow = Math.floor(y / cellHeight);
      const clampedCol = clamp(gridCol, 0, GRID_COLS - 1);
      const clampedRow = clamp(gridRow, 0, GRID_ROWS - 1);

      // Check for special cells
      if (clampedCol === 0 && clampedRow === 0) {
        // Top-left: pure white
        scheduleHsvUpdate({ h: 0, s: 0, v: 100 });
      } else if (clampedCol === GRID_COLS - 1 && clampedRow === GRID_ROWS - 1) {
        // Bottom-right: pure black
        scheduleHsvUpdate({ h: 0, s: 0, v: 0 });
      } else {
        // Normal color selection
        const gridX = clampedCol * cellWidth;
        const gridY = clampedRow * cellHeight;
        const s = (gridX / canvas.width) * 100;
        const v = ((canvas.height - gridY) / canvas.height) * 100;
        scheduleHsvUpdate({ ...currentHsv, s, v });
      }
    },
    [isPointerDown, currentHsv, scheduleHsvUpdate],
  );

  const handleSVPointerUp = useCallback((e: React.PointerEvent) => {
    const canvas = svCanvasRef.current;
    if (!canvas) return;

    canvas.releasePointerCapture(e.pointerId);
    setIsPointerDown(false);
    flushPendingHsv();
    onInteractionEnd?.();
    onCommit?.();
  }, [flushPendingHsv, onCommit, onInteractionEnd]);

  const handleHuePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const canvas = hueCanvasRef.current;
      if (!canvas) return;

      canvas.setPointerCapture(e.pointerId);
      setIsDraggingHue(true);
      onInteractionStart?.();

      const rect = canvas.getBoundingClientRect();
      const top = Number.isFinite(rect.top) ? rect.top : 0;
      const clientY = Number.isFinite(e.clientY) ? e.clientY : top;
      const y = clamp(clientY - top, 0, canvas.height - 1);
      const h = (y / canvas.height) * 360;

      applyHsvUpdate({ ...currentHsv, h });
    },
    [currentHsv, applyHsvUpdate, onInteractionStart],
  );

  const handleHuePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingHue) return;

      const canvas = hueCanvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const top = Number.isFinite(rect.top) ? rect.top : 0;
      const clientY = Number.isFinite(e.clientY) ? e.clientY : top;
      const y = clamp(clientY - top, 0, canvas.height - 1);
      const h = (y / canvas.height) * 360;

      scheduleHsvUpdate({ ...currentHsv, h });
    },
    [isDraggingHue, currentHsv, scheduleHsvUpdate],
  );

  const handleHuePointerUp = useCallback((e: React.PointerEvent) => {
    const canvas = hueCanvasRef.current;
    if (!canvas) return;

    canvas.releasePointerCapture(e.pointerId);
    setIsDraggingHue(false);
    flushPendingHsv();
    onInteractionEnd?.();
    onCommit?.();
  }, [flushPendingHsv, onCommit, onInteractionEnd]);

  // Geometry for selection overlay (avoid per-move canvas redraws)
  const cellWidth = svSize / GRID_COLS;
  const cellHeight = svSize / GRID_ROWS;
  const normalizedHexValue = hexValue.trim().toUpperCase();
  const isPureBlackCell = normalizedHexValue === '#000000';
  const isPureWhiteCell = normalizedHexValue === '#FFFFFF';
  const indicatorCol = isPureBlackCell
    ? GRID_COLS - 1
    : isPureWhiteCell
      ? 0
      : clamp(Math.floor((currentHsv.s / 100) * GRID_COLS), 0, GRID_COLS - 1);
  const indicatorRow = isPureBlackCell
    ? GRID_ROWS - 1
    : isPureWhiteCell
      ? 0
      : clamp(Math.floor(((100 - currentHsv.v) / 100) * GRID_ROWS), 0, GRID_ROWS - 1);
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
          <canvas
            ref={svCanvasRef}
            width={svSize}
            height={svSize}
            className="cursor-crosshair"
            onPointerDown={handleSVPointerDown}
            onPointerMove={handleSVPointerMove}
            onPointerUp={handleSVPointerUp}
            style={{ touchAction: "none", display: "block" }}
          />
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
        <canvas
          ref={hueCanvasRef}
          width={HUE_WIDTH}
          height={svSize}
          className="cursor-pointer"
          onPointerDown={handleHuePointerDown}
          onPointerMove={handleHuePointerMove}
          onPointerUp={handleHuePointerUp}
          style={{ touchAction: "none", display: 'block' }}
        />
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
