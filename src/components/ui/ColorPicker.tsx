import React, { useRef, useEffect, useCallback, useState } from "react";
import Input from "./Input";

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
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

  // Cache for SV gradient
  const svImageDataCache = useRef<Map<number, ImageData>>(new Map());

  const drawSVCanvas = useCallback(
    (hue: number) => {
      const canvas = svCanvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;

      // Check cache first
      const cacheKey = Math.round(hue);
      let imageData = svImageDataCache.current.get(cacheKey);

      if (!imageData) {
        imageData = ctx.createImageData(width, height);
        const data = imageData.data;

        const cellWidth = width / GRID_COLS;
        const cellHeight = height / GRID_ROWS;

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            // Calculate grid position - snap to grid cells
            const gridCol = Math.floor(x / cellWidth);
            const gridRow = Math.floor(y / cellHeight);
            const gridX = gridCol * cellWidth;
            const gridY = gridRow * cellHeight;

            let hex;

            // Special cases for specific grid cells
            if (gridCol === 0 && gridRow === 0) {
              // Top-left cell: pure white
              hex = "#ffffff";
            } else if (gridCol === GRID_COLS - 1 && gridRow === GRID_ROWS - 1) {
              // Bottom-right cell: pure black
              hex = "#000000";
            } else {
              // All other cells: normal color picker behavior
              const s = (gridX / width) * 100;
              const v = ((height - gridY) / height) * 100;
              hex = hsvToHex(hue, s, v);
            }

            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);

            const index = (y * width + x) * 4;
            data[index] = r;
            data[index + 1] = g;
            data[index + 2] = b;
            data[index + 3] = 255;
          }
        }

        // Limit cache size
        if (svImageDataCache.current.size > 20) {
          const firstKey = svImageDataCache.current.keys().next().value;
          if (firstKey !== undefined) {
            svImageDataCache.current.delete(firstKey);
          }
        }
        svImageDataCache.current.set(cacheKey, imageData);
      }

      ctx.putImageData(imageData, 0, 0);
    },
    [svSize],
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
      lastOpaqueHexRef.current = upper;
      setIsTransparent(false);
      setCurrentHsv(hexToHsv(upper));
      setHexValue(upper);
    }
  }, [color, allowTransparent]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const HUE_WIDTH = 28;
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
    svImageDataCache.current.clear();
  }, [svSize]);

  useEffect(() => {
    drawSVCanvas(currentHsv.h);
    drawHueCanvas();
  }, [drawSVCanvas, drawHueCanvas, currentHsv.h, svSize]);

  const updateColor = useCallback(
    (newHsv: HSV) => {
      const hex = hsvToHex(newHsv.h, newHsv.s, newHsv.v).toUpperCase();
      setIsTransparent(false);
      setCurrentHsv(newHsv);
      setHexValue(hex);
      lastOpaqueHexRef.current = hex;
      onChange(hex);
    },
    [onChange],
  );

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
      onChange(normalized);
    },
    [onChange],
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
        return;
      }

      const fallback = lastOpaqueHexRef.current || fallbackHex;
      setIsTransparent(false);
      setCurrentHsv(hexToHsv(fallback));
      setHexValue(fallback);
      lastOpaqueHexRef.current = fallback;
      onChange(fallback);
    },
    [allowTransparent, onChange],
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
    }
  }, [hexValue, isTransparent]);

  const handleHexInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (isTransparent) {
          onChange("transparent");
        } else {
          applyHex(hexValue);
        }
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
    [applyHex, hexValue, isTransparent, onChange],
  );

  const handleSVPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const canvas = svCanvasRef.current;
      if (!canvas) return;

      canvas.setPointerCapture(e.pointerId);
      setIsPointerDown(true);

      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(canvas.width, e.clientX - rect.left));
      const y = Math.max(0, Math.min(canvas.height, e.clientY - rect.top));

      const cellWidth = canvas.width / GRID_COLS;
      const cellHeight = canvas.height / GRID_ROWS;
      const gridCol = Math.floor(x / cellWidth);
      const gridRow = Math.floor(y / cellHeight);

      // Check for special cells
      if (gridCol === 0 && gridRow === 0) {
        // Top-left: pure white
        updateColor({ h: 0, s: 0, v: 100 });
      } else if (gridCol === GRID_COLS - 1 && gridRow === GRID_ROWS - 1) {
        // Bottom-right: pure black
        updateColor({ h: 0, s: 0, v: 0 });
      } else {
        // Normal color selection
        const s = (x / canvas.width) * 100;
        const v = ((canvas.height - y) / canvas.height) * 100;
        updateColor({ ...currentHsv, s, v });
      }
    },
    [currentHsv, updateColor],
  );

  const handleSVPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPointerDown) return;

      const canvas = svCanvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(canvas.width, e.clientX - rect.left));
      const y = Math.max(0, Math.min(canvas.height, e.clientY - rect.top));

      const cellWidth = canvas.width / GRID_COLS;
      const cellHeight = canvas.height / GRID_ROWS;
      const gridCol = Math.floor(x / cellWidth);
      const gridRow = Math.floor(y / cellHeight);

      // Check for special cells
      if (gridCol === 0 && gridRow === 0) {
        // Top-left: pure white
        updateColor({ h: 0, s: 0, v: 100 });
      } else if (gridCol === GRID_COLS - 1 && gridRow === GRID_ROWS - 1) {
        // Bottom-right: pure black
        updateColor({ h: 0, s: 0, v: 0 });
      } else {
        // Normal color selection
        const s = (x / canvas.width) * 100;
        const v = ((canvas.height - y) / canvas.height) * 100;
        updateColor({ ...currentHsv, s, v });
      }
    },
    [isPointerDown, currentHsv, updateColor],
  );

  const handleSVPointerUp = useCallback((e: React.PointerEvent) => {
    const canvas = svCanvasRef.current;
    if (!canvas) return;

    canvas.releasePointerCapture(e.pointerId);
    setIsPointerDown(false);
  }, []);

  const handleHuePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const canvas = hueCanvasRef.current;
      if (!canvas) return;

      canvas.setPointerCapture(e.pointerId);
      setIsDraggingHue(true);

      const rect = canvas.getBoundingClientRect();
      const y = Math.max(0, Math.min(canvas.height, e.clientY - rect.top));
      const h = (y / canvas.height) * 360;

      updateColor({ ...currentHsv, h });
    },
    [currentHsv, updateColor],
  );

  const handleHuePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingHue) return;

      const canvas = hueCanvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const y = Math.max(0, Math.min(canvas.height, e.clientY - rect.top));
      const h = (y / canvas.height) * 360;

      updateColor({ ...currentHsv, h });
    },
    [isDraggingHue, currentHsv, updateColor],
  );

  const handleHuePointerUp = useCallback((e: React.PointerEvent) => {
    const canvas = hueCanvasRef.current;
    if (!canvas) return;

    canvas.releasePointerCapture(e.pointerId);
    setIsDraggingHue(false);
  }, []);

  // Geometry for selection overlay (avoid per-move canvas redraws)
  const cellWidth = svSize / GRID_COLS;
  const cellHeight = svSize / GRID_ROWS;
  const indicatorX = Math.floor(((currentHsv.s / 100) * svSize) / cellWidth) * cellWidth;
  const indicatorY = Math.floor((((100 - currentHsv.v) / 100) * svSize) / cellHeight) * cellHeight;
  const indicatorStroke = currentHsv.v > 50 ? "#000" : "#fff";

  const hueWidth = 28;

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
          width={hueWidth}
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
