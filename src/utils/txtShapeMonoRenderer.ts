import type {
  Face,
  FreeType,
  LoadedGlyph,
} from '@zkl2333/freetype-wasm';

import type { TxtShapeFontFamily } from '@/types';
import {
  getTxtShapeFontDefinition,
  getTxtShapeRasterFontSize,
} from '@/utils/txtShapeFonts';

interface CachedFace {
  face: Face;
  ascender: number;
  descender: number;
  unitsPerEm: number;
}

interface CachedGlyph {
  bitmap: LoadedGlyph;
  glyphIndex: number;
  advance: number;
  runs: TxtShapeMonoBitmapRun[];
}

export interface TxtShapeMonoBitmapRun {
  x: number;
  y: number;
  width: number;
}

const faceCache = new Map<TxtShapeFontFamily, CachedFace>();
const facePromises = new Map<TxtShapeFontFamily, Promise<boolean>>();
const glyphCache = new Map<string, CachedGlyph>();
const kerningCache = new Map<string, number>();
let freeTypePromise: Promise<FreeType> | null = null;
let rasterRevision = 0;
type TxtShapeMonoRasterListener = (family: TxtShapeFontFamily) => void;
const rasterListeners = new Set<TxtShapeMonoRasterListener>();

const FT_LOAD_TARGET_MONO = 0x20000;
const FT_RENDER_MODE_MONO = 2;
const FT_PIXEL_MODE_MONO = 1;
const FT_KERNING_DEFAULT = 0;

const getAssetPrefix = (): string => (
  process.env.VESSEL_BASE_PATH?.trim().replace(/\/$/, '') ?? ''
);

const getFreeType = (): Promise<FreeType> => {
  if (!freeTypePromise) {
    freeTypePromise = import('@zkl2333/freetype-wasm').then(({ default: initFreeType }) => (
      initFreeType()
    ));
  }
  return freeTypePromise;
};

export const getTxtShapeMonoRasterRevision = (): number => rasterRevision;

export const subscribeTxtShapeMonoRasterRevision = (
  listener: TxtShapeMonoRasterListener,
): (() => void) => {
  rasterListeners.add(listener);
  return () => rasterListeners.delete(listener);
};

const notifyTxtShapeMonoRasterReady = (family: TxtShapeFontFamily): void => {
  [...rasterListeners].forEach((listener) => {
    try {
      listener(family);
    } catch {
      // A redraw subscriber must not make an otherwise valid font face fail to load.
    }
  });
};

export const ensureTxtShapeMonoFont = (
  family: TxtShapeFontFamily,
): Promise<boolean> => {
  if (faceCache.has(family)) return Promise.resolve(true);
  const pending = facePromises.get(family);
  if (pending) return pending;
  if (
    process.env.NODE_ENV === 'test'
    || typeof window === 'undefined'
    || typeof fetch !== 'function'
  ) {
    return Promise.resolve(false);
  }

  const definition = getTxtShapeFontDefinition(family);
  const promise = Promise.all([
    getFreeType(),
    fetch(`${getAssetPrefix()}/assets/fonts/${definition.asset.fileName}`),
  ]).then(async ([freeType, response]) => {
    if (!response.ok) return false;
    const face = freeType.newFace(new Uint8Array(await response.arrayBuffer()));
    const info = face.info();
    faceCache.set(family, {
      face,
      ascender: info.ascender,
      descender: info.descender,
      unitsPerEm: Math.max(1, info.unitsPerEM),
    });
    rasterRevision += 1;
    notifyTxtShapeMonoRasterReady(family);
    return true;
  }).catch(() => false);
  facePromises.set(family, promise);
  return promise;
};

export const ensureTxtShapeMonoFonts = async (
  families: readonly TxtShapeFontFamily[],
): Promise<boolean> => {
  if (process.env.NODE_ENV === 'test') return true;
  const results = await Promise.all([...new Set(families)].map(ensureTxtShapeMonoFont));
  return results.every(Boolean);
};

const getGlyph = (
  family: TxtShapeFontFamily,
  fontSize: number,
  codepoint: number,
): CachedGlyph | null => {
  const cachedFace = faceCache.get(family);
  if (!cachedFace) {
    void ensureTxtShapeMonoFont(family);
    return null;
  }

  const rasterSize = getTxtShapeRasterFontSize(family, fontSize);
  const cacheKey = `${family}:${rasterSize}:${codepoint}`;
  const cachedGlyph = glyphCache.get(cacheKey);
  if (cachedGlyph) return cachedGlyph;

  cachedFace.face.setPixelSize(rasterSize);
  const glyphIndex = cachedFace.face.charIndex(codepoint);
  const bitmap = cachedFace.face.loadGlyph({
    char: codepoint,
    flags: FT_LOAD_TARGET_MONO,
    renderMode: FT_RENDER_MODE_MONO,
  });
  if (bitmap.pixelMode !== FT_PIXEL_MODE_MONO) return null;
  const glyph = {
    bitmap,
    glyphIndex,
    advance: Math.round(bitmap.advance.x / 64),
    runs: getTxtShapeMonoBitmapRuns(bitmap),
  };
  glyphCache.set(cacheKey, glyph);
  return glyph;
};

const getKerning = (
  face: Face,
  family: TxtShapeFontFamily,
  fontSize: number,
  leftGlyphIndex: number,
  rightGlyphIndex: number,
): number => {
  if (leftGlyphIndex === 0 || rightGlyphIndex === 0) return 0;
  const cacheKey = `${family}:${fontSize}:${leftGlyphIndex}:${rightGlyphIndex}`;
  const cached = kerningCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const kerning = Math.round(
    face.kerning(leftGlyphIndex, rightGlyphIndex, FT_KERNING_DEFAULT).x / 64,
  );
  kerningCache.set(cacheKey, kerning);
  return kerning;
};

export const measureTxtShapeMonoText = (
  family: TxtShapeFontFamily,
  fontSize: number,
  text: string,
  letterSpacing = 0,
): number | null => {
  const cachedFace = faceCache.get(family);
  if (!cachedFace) {
    void ensureTxtShapeMonoFont(family);
    return null;
  }

  const rasterSize = getTxtShapeRasterFontSize(family, fontSize);
  cachedFace.face.setPixelSize(rasterSize);
  let width = 0;
  let previousGlyphIndex = 0;
  let characterIndex = 0;
  const resolvedLetterSpacing = Number.isFinite(letterSpacing)
    ? Math.max(0, Math.round(letterSpacing))
    : 0;
  for (const character of text) {
    const glyph = getGlyph(family, fontSize, character.codePointAt(0)!);
    if (!glyph) return null;
    if (characterIndex > 0) width += resolvedLetterSpacing;
    width += getKerning(
      cachedFace.face,
      family,
      rasterSize,
      previousGlyphIndex,
      glyph.glyphIndex,
    );
    width += glyph.advance;
    previousGlyphIndex = glyph.glyphIndex;
    characterIndex += 1;
  }
  return width;
};

export const getTxtShapeMonoBitmapRuns = (
  bitmap: Pick<LoadedGlyph, 'buffer' | 'pitch' | 'rows' | 'width'>,
): TxtShapeMonoBitmapRun[] => {
  const runs: TxtShapeMonoBitmapRun[] = [];
  const rowStride = Math.abs(bitmap.pitch);
  for (let y = 0; y < bitmap.rows; y += 1) {
    const sourceY = bitmap.pitch < 0 ? bitmap.rows - y - 1 : y;
    const rowOffset = sourceY * rowStride;
    let runStart = -1;
    for (let x = 0; x <= bitmap.width; x += 1) {
      const isSet = x < bitmap.width
        && (bitmap.buffer[rowOffset + (x >> 3)]! & (0x80 >> (x & 7))) !== 0;
      if (isSet && runStart < 0) runStart = x;
      if (!isSet && runStart >= 0) {
        runs.push({ x: runStart, y, width: x - runStart });
        runStart = -1;
      }
    }
  }
  return runs;
};

export const calculateTxtShapeMonoBaseline = ({
  ascender,
  descender,
  unitsPerEm,
  fontSize,
  lineHeight,
}: {
  ascender: number;
  descender: number;
  unitsPerEm: number;
  fontSize: number;
  lineHeight: number;
}): number => {
  const scale = fontSize / Math.max(1, unitsPerEm);
  const ascenderPx = ascender * scale;
  const fontBoxHeight = (ascender - descender) * scale;
  return Math.round(ascenderPx + (lineHeight - fontBoxHeight) / 2);
};

export const drawTxtShapeMonoTextMask = ({
  context,
  family,
  fontSize,
  text,
  x,
  y,
  lineHeight,
  letterSpacing = 0,
}: {
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  family: TxtShapeFontFamily;
  fontSize: number;
  text: string;
  x: number;
  y: number;
  lineHeight: number;
  letterSpacing?: number;
}): boolean => {
  const cachedFace = faceCache.get(family);
  if (!cachedFace) {
    void ensureTxtShapeMonoFont(family);
    return false;
  }

  const rasterSize = getTxtShapeRasterFontSize(family, fontSize);
  cachedFace.face.setPixelSize(rasterSize);
  const baseline = calculateTxtShapeMonoBaseline({
    ascender: cachedFace.ascender,
    descender: cachedFace.descender,
    unitsPerEm: cachedFace.unitsPerEm,
    fontSize: rasterSize,
    lineHeight,
  });
  let penX = Math.round(x);
  let previousGlyphIndex = 0;
  let characterIndex = 0;
  const resolvedLetterSpacing = Number.isFinite(letterSpacing)
    ? Math.max(0, Math.round(letterSpacing))
    : 0;
  for (const character of text) {
    const glyph = getGlyph(family, fontSize, character.codePointAt(0)!);
    if (!glyph) return false;
    if (characterIndex > 0) penX += resolvedLetterSpacing;
    penX += getKerning(
      cachedFace.face,
      family,
      rasterSize,
      previousGlyphIndex,
      glyph.glyphIndex,
    );
    const glyphX = penX + glyph.bitmap.bitmapLeft;
    const glyphY = Math.round(y) + baseline - glyph.bitmap.bitmapTop;
    glyph.runs.forEach((run) => {
      context.fillRect(glyphX + run.x, glyphY + run.y, run.width, 1);
    });
    penX += glyph.advance;
    previousGlyphIndex = glyph.glyphIndex;
    characterIndex += 1;
  }
  return true;
};
