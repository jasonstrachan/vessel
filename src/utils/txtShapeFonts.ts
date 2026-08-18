import type { TxtShapeFontFamily } from '@/types';

export interface TxtShapeFontDefinition {
  family: TxtShapeFontFamily;
  label: string;
  stack: string;
  minimumSize: number;
  sizeStep: number;
  nativePixelSize?: number;
  asset: {
    fileName: string;
    format: 'opentype' | 'woff2';
  };
}

export const TXT_SHAPE_MAX_FONT_SIZE = 40;
export const TXT_SHAPE_DEFAULT_FONT_FAMILY: TxtShapeFontFamily = 'mek-mono';

export const TXT_SHAPE_FONT_DEFINITIONS: readonly TxtShapeFontDefinition[] = [
  {
    family: 'mek-sans',
    label: 'MEK Sans',
    stack: "'MEK Sans', sans-serif",
    minimumSize: 10,
    sizeStep: 1,
    asset: {
      fileName: 'MEKSANS-REGULAR.OTF',
      format: 'opentype',
    },
  },
  {
    family: 'mek-mono',
    label: 'MEK Mono',
    stack: "'MEK Mono', monospace",
    minimumSize: 12,
    sizeStep: 1,
    asset: {
      fileName: 'MEK-MONO-REGULAR.OTF',
      format: 'opentype',
    },
  },
  {
    family: 'jetbrains-mono',
    label: 'JetBrains Mono',
    stack: "'JetBrains Mono', monospace",
    minimumSize: 8,
    sizeStep: 1,
    asset: {
      fileName: 'JETBRAINS-MONO-REGULAR.WOFF2',
      format: 'woff2',
    },
  },
  {
    family: 'ibm-plex-mono',
    label: 'IBM Plex Mono',
    stack: "'IBM Plex Mono', monospace",
    minimumSize: 8,
    sizeStep: 1,
    asset: {
      fileName: 'IBM-PLEX-MONO-REGULAR.WOFF2',
      format: 'woff2',
    },
  },
  {
    family: 'departure-mono',
    label: 'Departure Mono',
    stack: "'Departure Mono', monospace",
    minimumSize: 11,
    sizeStep: 11,
    nativePixelSize: 11,
    asset: {
      fileName: 'DEPARTURE-MONO-REGULAR.WOFF2',
      format: 'woff2',
    },
  },
] as const;

const FONT_DEFINITIONS_BY_FAMILY = new Map(
  TXT_SHAPE_FONT_DEFINITIONS.map((definition) => [definition.family, definition]),
);

export const isTxtShapeFontFamily = (value: unknown): value is TxtShapeFontFamily =>
  typeof value === 'string' && FONT_DEFINITIONS_BY_FAMILY.has(value as TxtShapeFontFamily);

export const normalizeTxtShapeFontFamily = (value: unknown): TxtShapeFontFamily =>
  isTxtShapeFontFamily(value) ? value : TXT_SHAPE_DEFAULT_FONT_FAMILY;

export const getTxtShapeFontDefinition = (
  family: TxtShapeFontFamily,
): TxtShapeFontDefinition => FONT_DEFINITIONS_BY_FAMILY.get(family)
  ?? FONT_DEFINITIONS_BY_FAMILY.get(TXT_SHAPE_DEFAULT_FONT_FAMILY)!;

export const getTxtShapeFontMinimumSize = (family: TxtShapeFontFamily): number =>
  getTxtShapeFontDefinition(family).minimumSize;

export const getTxtShapeFontSizeStep = (family: TxtShapeFontFamily): number =>
  getTxtShapeFontDefinition(family).sizeStep;

export const normalizeTxtShapeFontSize = (
  family: TxtShapeFontFamily,
  requestedSize: number,
  maximumSize = TXT_SHAPE_MAX_FONT_SIZE,
): number => {
  const definition = getTxtShapeFontDefinition(family);
  const finiteSize = Number.isFinite(requestedSize) ? requestedSize : definition.minimumSize;
  const effectiveMaximum = Math.max(definition.minimumSize, Math.floor(maximumSize));
  if (definition.nativePixelSize) {
    const maximumScale = Math.max(1, Math.floor(effectiveMaximum / definition.nativePixelSize));
    const scale = Math.max(
      1,
      Math.min(maximumScale, Math.round(finiteSize / definition.nativePixelSize)),
    );
    return definition.nativePixelSize * scale;
  }

  const step = Math.max(1, definition.sizeStep);
  const steppedSize = definition.minimumSize
    + Math.round((finiteSize - definition.minimumSize) / step) * step;
  return Math.max(definition.minimumSize, Math.min(effectiveMaximum, steppedSize));
};

export const getTxtShapeRasterFontSize = (
  family: TxtShapeFontFamily,
  fontSize: number,
): number => {
  const definition = getTxtShapeFontDefinition(family);
  return definition.nativePixelSize ?? normalizeTxtShapeFontSize(family, fontSize);
};

export const getTxtShapePixelScale = (
  family: TxtShapeFontFamily,
  fontSize: number,
): number => {
  const definition = getTxtShapeFontDefinition(family);
  return definition.nativePixelSize
    ? normalizeTxtShapeFontSize(family, fontSize) / definition.nativePixelSize
    : 1;
};

export const loadTxtShapeFont = async (
  family: TxtShapeFontFamily,
  size = getTxtShapeFontMinimumSize(family),
): Promise<boolean> => {
  if (typeof document === 'undefined' || !document.fonts) return false;
  const definition = getTxtShapeFontDefinition(family);
  const familyName = definition.stack.match(/^'([^']+)'/)?.[1];
  if (!familyName) return false;
  const descriptor = `${Math.max(definition.minimumSize, size)}px "${familyName}"`;
  try {
    await document.fonts.load(descriptor);
    return document.fonts.check(descriptor);
  } catch {
    return false;
  }
};

export const createTxtShapeFontFaceCss = (basePath = ''): string => {
  const normalizedBasePath = basePath.trim().replace(/\/$/, '');
  return TXT_SHAPE_FONT_DEFINITIONS.flatMap((definition) => {
    const familyName = definition.stack.match(/^'([^']+)'/)?.[1];
    if (!familyName) return [];
    const source = `${normalizedBasePath}/assets/fonts/${definition.asset.fileName}`;
    return [
      `@font-face{font-family:'${familyName}';src:url('${source}') format('${definition.asset.format}');font-style:normal;font-weight:400;font-display:block;}`,
    ];
  }).join('\n');
};
