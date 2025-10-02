export interface RGBAColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clampByte = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(255, Math.round(value)));
};

const parseHexChannel = (hex: string): number => parseInt(hex, 16);

const fromHex = (hex: string): RGBAColor | null => {
  const normalized = hex.trim().replace(/^#/, '');

  if (normalized.length === 3 || normalized.length === 4) {
    const r = parseHexChannel(normalized[0] + normalized[0]);
    const g = parseHexChannel(normalized[1] + normalized[1]);
    const b = parseHexChannel(normalized[2] + normalized[2]);
    const a = normalized.length === 4 ? parseHexChannel(normalized[3] + normalized[3]) : 255;
    return { r, g, b, a };
  }

  if (normalized.length === 6 || normalized.length === 8) {
    const r = parseHexChannel(normalized.slice(0, 2));
    const g = parseHexChannel(normalized.slice(2, 4));
    const b = parseHexChannel(normalized.slice(4, 6));
    const a = normalized.length === 8 ? parseHexChannel(normalized.slice(6, 8)) : 255;
    return { r, g, b, a };
  }

  return null;
};

const parseComponent = (component: string): number | null => {
  if (!component) {
    return null;
  }
  const value = component.trim();
  const percent = value.endsWith('%');
  const numeric = parseFloat(value);
  if (Number.isNaN(numeric)) {
    return null;
  }
  if (percent) {
    return clampByte((numeric / 100) * 255);
  }
  return clampByte(numeric);
};

const parseAlphaComponent = (component: string): number | null => {
  if (!component) {
    return null;
  }
  const value = component.trim();
  const percent = value.endsWith('%');
  const numeric = parseFloat(value);
  if (Number.isNaN(numeric)) {
    return null;
  }
  if (percent) {
    return clampByte((numeric / 100) * 255);
  }
  if (numeric <= 1) {
    return clampByte(numeric * 255);
  }
  return clampByte(numeric);
};

const fromRgbString = (color: string): RGBAColor | null => {
  const match = color.match(/^rgba?\((.*)\)$/i);
  if (!match) {
    return null;
  }

  const raw = match[1]
    .replace(/\s*\/\s*/, ' / ')
    .trim();

  // Extract numeric tokens (supports both comma and space separated forms)
  const components = raw.match(/[+-]?\d*\.?\d+%?/g);
  if (!components || components.length < 3) {
    return null;
  }

  const [rComp, gComp, bComp, aComp] = components;
  const r = parseComponent(rComp);
  const g = parseComponent(gComp);
  const b = parseComponent(bComp);
  if (r === null || g === null || b === null) {
    return null;
  }

  const a = aComp ? parseAlphaComponent(aComp) : 255;
  return { r, g, b, a: a ?? 255 };
};

export const DEFAULT_RGBA: RGBAColor = { r: 255, g: 255, b: 255, a: 255 };

export function parseCssColor(color: string, fallback: RGBAColor = DEFAULT_RGBA): RGBAColor {
  if (!color) {
    return { ...fallback };
  }

  const trimmed = color.trim();
  if (trimmed.length === 0) {
    return { ...fallback };
  }

  if (trimmed.toLowerCase() === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const hex = fromHex(trimmed);
  if (hex) {
    return hex;
  }

  const rgb = fromRgbString(trimmed);
  if (rgb) {
    return rgb;
  }

  return { ...fallback };
}
