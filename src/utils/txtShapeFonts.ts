import type { TxtShapeFontFamily } from '@/types';

export interface TxtShapeFontDefinition {
  family: TxtShapeFontFamily;
  label: string;
  stack: string;
  minimumSize: number;
  asset?: {
    fileName: string;
    format: 'opentype' | 'woff2';
  };
}

export const TXT_SHAPE_FONT_DEFINITIONS: readonly TxtShapeFontDefinition[] = [
  {
    family: 'monospace',
    label: 'Monospace',
    stack: "ui-monospace, 'Courier New', monospace",
    minimumSize: 6,
  },
  {
    family: 'sans-serif',
    label: 'Sans serif',
    stack: 'Arial, Helvetica, sans-serif',
    minimumSize: 6,
  },
  {
    family: 'serif',
    label: 'Serif',
    stack: "Georgia, 'Times New Roman', serif",
    minimumSize: 6,
  },
  {
    family: 'mek-sans',
    label: 'MEK Sans',
    stack: "'MEK Sans', sans-serif",
    minimumSize: 8,
    asset: {
      fileName: 'MEKSANS-REGULAR.OTF',
      format: 'opentype',
    },
  },
  {
    family: 'mek-mono',
    label: 'MEK Mono',
    stack: "'MEK Mono', monospace",
    minimumSize: 6,
    asset: {
      fileName: 'MEK-MONO-REGULAR.OTF',
      format: 'opentype',
    },
  },
  {
    family: 'jetbrains-mono',
    label: 'JetBrains Mono',
    stack: "'JetBrains Mono', monospace",
    minimumSize: 6,
    asset: {
      fileName: 'JETBRAINS-MONO-REGULAR.WOFF2',
      format: 'woff2',
    },
  },
  {
    family: 'ibm-plex-mono',
    label: 'IBM Plex Mono',
    stack: "'IBM Plex Mono', monospace",
    minimumSize: 6,
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

export const getTxtShapeFontDefinition = (
  family: TxtShapeFontFamily,
): TxtShapeFontDefinition => FONT_DEFINITIONS_BY_FAMILY.get(family)
  ?? FONT_DEFINITIONS_BY_FAMILY.get('monospace')!;

export const getTxtShapeFontMinimumSize = (family: TxtShapeFontFamily): number =>
  getTxtShapeFontDefinition(family).minimumSize;

export const loadTxtShapeFont = async (
  family: TxtShapeFontFamily,
  size = getTxtShapeFontMinimumSize(family),
): Promise<boolean> => {
  if (typeof document === 'undefined' || !document.fonts) return false;
  const definition = getTxtShapeFontDefinition(family);
  const familyName = definition.stack.match(/^'([^']+)'/)?.[1];
  if (!definition.asset || !familyName) return true;
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
    if (!definition.asset) return [];
    const familyName = definition.stack.match(/^'([^']+)'/)?.[1];
    if (!familyName) return [];
    const source = `${normalizedBasePath}/assets/fonts/${definition.asset.fileName}`;
    return [
      `@font-face{font-family:'${familyName}';src:url('${source}') format('${definition.asset.format}');font-style:normal;font-weight:400;font-display:block;}`,
    ];
  }).join('\n');
};
