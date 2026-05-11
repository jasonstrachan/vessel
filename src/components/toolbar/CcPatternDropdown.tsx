'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Dropdown from '@/components/ui/Dropdown';
import { useAppStore } from '@/stores/useAppStore';
import {
  selectCcCustomTilePatterns,
} from '@/stores/selectors/projectSelectors';
import type { BrushSettings } from '@/types';
import {
  makeCcCustomTilePattern,
} from '@/utils/colorCycle/ccCustomTilePattern';

import { PATTERN_STYLES } from './patternOptions';

type Props = {
  value: NonNullable<BrushSettings['patternStyle']>;
  patternTileId?: string | null;
  onChange: (updates: Partial<BrushSettings>) => void;
  className?: string;
};

const ADD_NEW_VALUE = '__add_cc_tile_pattern__';
const FALLBACK_PREVIEW_COLORS: [string, string] = ['#ff1f1f', '#9f00e8'];

type RgbaColor = [number, number, number, number];

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const parseHexColor = (color: string): RgbaColor | null => {
  const normalized = color.trim();
  const shortHex = /^#([0-9a-f]{3,4})$/i.exec(normalized);
  if (shortHex) {
    const parts = shortHex[1].split('').map((part) => parseInt(`${part}${part}`, 16));
    return [
      parts[0] ?? 0,
      parts[1] ?? 0,
      parts[2] ?? 0,
      parts[3] ?? 255,
    ];
  }
  const longHex = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(normalized);
  if (longHex) {
    return [
      parseInt(longHex[1].slice(0, 2), 16),
      parseInt(longHex[1].slice(2, 4), 16),
      parseInt(longHex[1].slice(4, 6), 16),
      longHex[1].length === 8 ? parseInt(longHex[1].slice(6, 8), 16) : 255,
    ];
  }
  return null;
};

const parseRgbColor = (color: string): RgbaColor | null => {
  const normalized = color.trim();
  if (!normalized.startsWith('rgb')) {
    return null;
  }
  const parts = normalized
    .slice(normalized.indexOf('(') + 1, normalized.lastIndexOf(')'))
    .split(',')
    .map((part) => part.trim());
  if (parts.length < 3 || parts.length > 4 || parts.some((part) => part.length === 0)) {
    return null;
  }
  const alpha = parts[3]?.endsWith('%')
    ? Number(parts[3].slice(0, -1)) / 100
    : Number(parts[3] ?? 1);
  return [
    clampByte(Number(parts[0])),
    clampByte(Number(parts[1])),
    clampByte(Number(parts[2])),
    clampByte(alpha * 255),
  ];
};

const hueToRgb = (p: number, q: number, t: number): number => {
  let next = t;
  if (next < 0) next += 1;
  if (next > 1) next -= 1;
  if (next < 1 / 6) return p + (q - p) * 6 * next;
  if (next < 1 / 2) return q;
  if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
  return p;
};

const parseHslColor = (color: string): RgbaColor | null => {
  const normalized = color.trim();
  if (!normalized.startsWith('hsl')) {
    return null;
  }
  const parts = normalized
    .slice(normalized.indexOf('(') + 1, normalized.lastIndexOf(')'))
    .split(',')
    .map((part) => part.trim());
  if (parts.length < 3 || parts.length > 4 || !parts[1].endsWith('%') || !parts[2].endsWith('%')) {
    return null;
  }
  const h = (((Number(parts[0]) % 360) + 360) % 360) / 360;
  const s = Math.max(0, Math.min(1, Number(parts[1].slice(0, -1)) / 100));
  const l = Math.max(0, Math.min(1, Number(parts[2].slice(0, -1)) / 100));
  const alpha = parts[3]?.endsWith('%')
    ? Number(parts[3].slice(0, -1)) / 100
    : Number(parts[3] ?? 1);
  if (s === 0) {
    const gray = clampByte(l * 255);
    return [gray, gray, gray, clampByte(alpha * 255)];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    clampByte(hueToRgb(p, q, h + 1 / 3) * 255),
    clampByte(hueToRgb(p, q, h) * 255),
    clampByte(hueToRgb(p, q, h - 1 / 3) * 255),
    clampByte(alpha * 255),
  ];
};

const NAMED_PREVIEW_COLORS: Record<string, RgbaColor> = {
  black: [0, 0, 0, 255],
  white: [255, 255, 255, 255],
  red: [255, 0, 0, 255],
  green: [0, 128, 0, 255],
  blue: [0, 0, 255, 255],
  transparent: [0, 0, 0, 0],
};

const parsePreviewColor = (color: string): RgbaColor | null => {
  const normalized = color.trim().toLowerCase();
  return parseHexColor(normalized)
    ?? parseRgbColor(normalized)
    ?? parseHslColor(normalized)
    ?? NAMED_PREVIEW_COLORS[normalized]
    ?? null;
};

const colorLuminance = ([r, g, b, a]: RgbaColor): number =>
  ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255) * (a / 255);

const colorDistance = (
  [r1, g1, b1]: RgbaColor,
  [r2, g2, b2]: RgbaColor
): number => Math.hypot(r1 - r2, g1 - g2, b1 - b2);

export const resolveVisibleTilePreviewColors = (
  colors: [string, string]
): [string, string] => {
  const first = parsePreviewColor(colors[0]);
  const second = parsePreviewColor(colors[1]);
  if (!first || !second) {
    return colors;
  }
  const firstLum = colorLuminance(first);
  const secondLum = colorLuminance(second);
  const contrast = Math.abs(firstLum - secondLum);
  const maxLum = Math.max(firstLum, secondLum);
  if (
    first[3] < 16 ||
    second[3] < 16 ||
    maxLum < 0.18 ||
    (contrast < 0.08 && colorDistance(first, second) < 64)
  ) {
    return FALLBACK_PREVIEW_COLORS;
  }
  return colors;
};

export const renderTilePreviewImageData = (
  imageData: ImageData,
  width: number,
  height: number,
  colors: [string, string]
): ImageData => {
  const resolvedColors = resolveVisibleTilePreviewColors(colors);
  const firstColor = parsePreviewColor(resolvedColors[0]) ?? parsePreviewColor(FALLBACK_PREVIEW_COLORS[0]);
  const secondColor = parsePreviewColor(resolvedColors[1]) ?? parsePreviewColor(FALLBACK_PREVIEW_COLORS[1]);
  const preview = new ImageData(width, height);
  const tileWidth = Math.max(1, imageData.width);
  const tileHeight = Math.max(1, imageData.height);
  for (let y = 0; y < height; y += 1) {
    const tileY = y % tileHeight;
    for (let x = 0; x < width; x += 1) {
      const tileX = x % tileWidth;
      const sourceIdx = (tileY * tileWidth + tileX) * 4;
      const r = imageData.data[sourceIdx] ?? 255;
      const g = imageData.data[sourceIdx + 1] ?? 255;
      const b = imageData.data[sourceIdx + 2] ?? 255;
      const a = imageData.data[sourceIdx + 3] ?? 0;
      const alpha = a / 255;
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const threshold = alpha * luminance + (1 - alpha);
      const ink = threshold < 0.5 ? firstColor : secondColor;
      const targetIdx = (y * width + x) * 4;
      preview.data[targetIdx] = ink?.[0] ?? 255;
      preview.data[targetIdx + 1] = ink?.[1] ?? 31;
      preview.data[targetIdx + 2] = ink?.[2] ?? 31;
      preview.data[targetIdx + 3] = ink?.[3] ?? 255;
    }
  }
  return preview;
};

const readImageFile = async (file: File): Promise<ImageData | null> => {
  if (!file.type.startsWith('image/')) {
    return null;
  }
  const bitmap = await createImageBitmap(file);
  const width = Math.max(1, Math.floor(bitmap.width));
  const height = Math.max(1, Math.floor(bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return ctx.getImageData(0, 0, width, height);
};

const drawImageData = (
  canvas: HTMLCanvasElement | null,
  imageData: ImageData | null
) => {
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const width = imageData ? imageData.width : 1;
  const height = imageData ? imageData.height : 1;
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!imageData) {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const temp = document.createElement('canvas');
  temp.width = width;
  temp.height = height;
  temp.getContext('2d')?.putImageData(imageData, 0, 0);
  ctx.drawImage(temp, 0, 0, canvas.width, canvas.height);
};

const drawPreview = (
  canvas: HTMLCanvasElement | null,
  imageData: ImageData | null,
  colors: [string, string]
) => {
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const parent = canvas.parentElement;
  const previewWidth = Math.max(1, Math.floor(parent?.clientWidth || imageData?.width || 1));
  const previewHeight = Math.max(1, Math.floor(parent?.clientHeight || imageData?.height || 1));
  canvas.width = previewWidth;
  canvas.height = previewHeight;
  canvas.style.width = `${previewWidth}px`;
  canvas.style.height = `${previewHeight}px`;
  ctx.clearRect(0, 0, previewWidth, previewHeight);
  if (!imageData) {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, previewWidth, previewHeight);
    return;
  }
  ctx.putImageData(renderTilePreviewImageData(imageData, previewWidth, previewHeight, colors), 0, 0);
};

const AddTilePatternModal = ({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (imageData: ImageData) => void;
}) => {
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const rawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gradient = useAppStore((state) => state.tools.brushSettings.colorCycleGradient);
  const previewColors = useMemo<[string, string]>(() => {
    const stops = gradient && gradient.length >= 2 ? gradient : null;
    return [
      stops?.[0]?.color ?? '#111111',
      stops?.[stops.length - 1]?.color ?? '#f4f4f4',
    ];
  }, [gradient]);
  const visiblePreviewColors = useMemo(
    () => resolveVisibleTilePreviewColors(previewColors),
    [previewColors]
  );

  useEffect(() => {
    const draw = () => {
      drawImageData(rawCanvasRef.current, imageData);
      drawPreview(previewCanvasRef.current, imageData, visiblePreviewColors);
    };

    draw();
    return undefined;
  }, [imageData, visiblePreviewColors]);

  const loadFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const nextImageData = await readImageFile(file);
      if (!nextImageData) {
        setError('Could not read image pixels.');
        return;
      }
      setImageData(nextImageData);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not read image pixels.');
    }
  }, []);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    const item = Array.from(event.clipboardData.items).find((entry) => entry.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (!file) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();
    void loadFile(file);
  }, [loadFile]);

  useEffect(() => {
    modalRef.current?.focus();

    const handleDocumentPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? [])
        .find((entry) => entry.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (!file) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void loadFile(file);
    };

    document.addEventListener('paste', handleDocumentPaste, true);
    return () => {
      document.removeEventListener('paste', handleDocumentPaste, true);
    };
  }, [loadFile]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const file = Array.from(event.dataTransfer.files).find((entry) => entry.type.startsWith('image/'));
    if (!file) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void loadFile(file);
  }, [loadFile]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70">
      <div
        ref={modalRef}
        tabIndex={-1}
        className="w-[1120px] max-w-[calc(100vw-24px)] border border-[#555] bg-[#1a1a1a] p-3 text-[#D9D9D9] shadow-xl"
        onPaste={handlePaste}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDrop={handleDrop}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Add Tile Pattern</h2>
          <button type="button" className="px-2 text-xs hover:bg-[#333]" onClick={onClose}>
            x
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1 text-xs text-[#aaa]">Pixels</div>
            <div className="h-80 overflow-auto border border-[#333] bg-[#101010]">
              <canvas ref={rawCanvasRef} />
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs text-[#aaa]">Tile Preview</div>
            <div className="h-80 overflow-auto border border-[#333] bg-[#101010]">
              <canvas ref={previewCanvasRef} />
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <label className="cursor-pointer border border-[#555] px-2 py-1 text-xs hover:bg-[#333]">
            Import PNG
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void loadFile(file);
                }
              }}
            />
          </label>
          <span className="text-xs text-[#777]">Paste image pixels into this window.</span>
        </div>
        {error ? <div className="mt-2 text-xs text-amber-400">{error}</div> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="border border-[#555] px-3 py-1 text-xs hover:bg-[#333]" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="border border-[#d9d9d9] px-3 py-1 text-xs hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!imageData}
            onClick={() => {
              if (imageData) {
                onSave(imageData);
              }
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export const CcPatternDropdown = ({
  value,
  patternTileId,
  onChange,
  className,
}: Props) => {
  const [isAdding, setIsAdding] = useState(false);
  const tilePatterns = useAppStore(selectCcCustomTilePatterns);
  const addCcCustomTilePattern = useAppStore((state) => state.addCcCustomTilePattern);
  const removeCcCustomTilePattern = useAppStore((state) => state.removeCcCustomTilePattern);

  const selectedValue = value === 'image-tile' && patternTileId
    ? `tile:${patternTileId}`
    : value;

  const options = useMemo(() => [
    { value: ADD_NEW_VALUE, label: '+ Add New', isAction: true },
    ...PATTERN_STYLES.map((option) => ({ value: option.value, label: option.label })),
    ...tilePatterns.map((pattern) => ({
      value: `tile:${pattern.id}`,
      label: pattern.name,
    })),
  ], [tilePatterns]);

  return (
    <>
      <Dropdown
        value={selectedValue}
        options={options}
        onAction={(action) => {
          if (action === ADD_NEW_VALUE) {
            setIsAdding(true);
          }
        }}
        onChange={(nextValue) => {
          if (nextValue.startsWith('tile:')) {
            onChange({
              ditherAlgorithm: 'pattern',
              patternStyle: 'image-tile',
              patternTileId: nextValue.slice('tile:'.length),
            });
            return;
          }
          onChange({
            ditherAlgorithm: 'pattern',
            patternStyle: nextValue as NonNullable<BrushSettings['patternStyle']>,
            patternTileId: nextValue === 'image-tile' ? patternTileId ?? null : null,
          });
        }}
        renderOption={(option) => {
          const tileId = option.value.startsWith('tile:') ? option.value.slice('tile:'.length) : null;
          return (
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {tileId ? (
                <button
                  type="button"
                  data-dropdown-interactive="true"
                  className="shrink-0 px-1 text-[#aaa] hover:bg-[#333] hover:text-[#fff]"
                  aria-label={`Remove ${option.label}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    removeCcCustomTilePattern(tileId);
                  }}
                >
                  x
                </button>
              ) : null}
            </div>
          );
        }}
        className={className}
      />
      {isAdding ? (
        <AddTilePatternModal
          onClose={() => setIsAdding(false)}
          onSave={(imageData) => {
            const patternNumber = tilePatterns.length + 1;
            const pattern = makeCcCustomTilePattern({
              name: `Tile ${patternNumber}`,
              imageData,
            });
            addCcCustomTilePattern(pattern);
            onChange({
              ditherAlgorithm: 'pattern',
              patternStyle: 'image-tile',
              patternTileId: pattern.id,
            });
            setIsAdding(false);
          }}
        />
      ) : null}
    </>
  );
};

export default CcPatternDropdown;
