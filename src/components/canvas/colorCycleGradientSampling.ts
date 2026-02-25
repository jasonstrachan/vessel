export type GradientStop = { position: number; color: string };

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
};

const rgbToHex = (r: number, g: number, b: number): string => {
  const toHex = (value: number) => value.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const interpolateStopColorAt = (position: number, stops: GradientStop[]): string => {
  if (stops.length === 0) {
    return '#ffffff';
  }
  if (stops.length === 1) {
    return stops[0].color;
  }

  let before = stops[0];
  let after = stops[stops.length - 1];

  for (let i = 0; i < stops.length - 1; i += 1) {
    const current = stops[i];
    const next = stops[i + 1];
    if (position >= current.position && position <= next.position) {
      before = current;
      after = next;
      break;
    }
  }

  const range = after.position - before.position;
  const t = range > 0 ? (position - before.position) / range : 0;
  const startRgb = hexToRgb(before.color);
  const endRgb = hexToRgb(after.color);
  const lerp = (start: number, end: number) => Math.round(start + (end - start) * t);

  return rgbToHex(lerp(startRgb.r, endRgb.r), lerp(startRgb.g, endRgb.g), lerp(startRgb.b, endRgb.b));
};

export const resampleStopsToColors = (stops: GradientStop[], count: number): string[] => {
  const targetCount = Math.max(2, count | 0);
  const colors: string[] = [];
  for (let index = 0; index < targetCount; index += 1) {
    const position = targetCount === 1 ? 0 : index / (targetCount - 1);
    colors.push(interpolateStopColorAt(position, stops));
  }
  return colors;
};
