import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const SOURCE_COMMIT = 'e976bf66ca181d6f14d7f120d3c665e2197a59d8';
const SOURCE_GRID_SIZE = 40;
const ICON_SIZE = 32;
const SOURCE_INSET = (SOURCE_GRID_SIZE - ICON_SIZE) / 2;

const ICONS = [
  ['happy-mac', 'Happy Mac', 'Happy Mac.png'],
  ['sad-mac', 'Sad Mac', 'Sad Mac.png'],
  ['floppy', 'Floppy', 'Floppy.png'],
  ['trash', 'Trash', 'Trash.png'],
  ['text-file', 'Text File', 'Text file.png'],
  ['font-suitcase', 'Font Suitcase', 'Font suitcase.png'],
  ['command', 'Command', 'Command.png'],
  ['watch', 'Watch', 'Watch.png'],
  ['macpaint', 'MacPaint', 'MacPaint.png'],
  ['paint-brush', 'Paint Brush', 'Paint brush.png'],
];

const srgbToLinear = (value) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};

const toOklab = ([red, green, blue]) => {
  const r = srgbToLinear(red);
  const g = srgbToLinear(green);
  const b = srgbToLinear(blue);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const labB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { lightness, a, b: labB, chroma: Math.hypot(a, labB) };
};

const encodeRuns = (pixels) => {
  const runs = [];
  let color = pixels[0];
  let length = 0;
  pixels.forEach((pixel) => {
    if (pixel === color && length < 255) {
      length += 1;
      return;
    }
    runs.push(length, color);
    color = pixel;
    length = 1;
  });
  runs.push(length, color);
  return Buffer.from(runs).toString('base64');
};

const readIcon = async (sourceRoot, [slug, label, filename]) => {
  const { data, info } = await sharp(path.join(sourceRoot, 'png', filename))
    .resize(SOURCE_GRID_SIZE, SOURCE_GRID_SIZE, { kernel: sharp.kernel.nearest })
    .extract({
      left: SOURCE_INSET,
      top: SOURCE_INSET,
      width: ICON_SIZE,
      height: ICON_SIZE,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = [];
  let opaqueCount = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const alpha = data[offset + 3];
    if (alpha < 128) {
      pixels.push(0);
      continue;
    }
    const pixelRed = data[offset];
    const pixelGreen = data[offset + 1];
    const pixelBlue = data[offset + 2];
    const isBlack = (pixelRed + pixelGreen + pixelBlue) / 3 < 128;
    pixels.push(isBlack ? 2 : 1);
    opaqueCount += 1;
    red += pixelRed;
    green += pixelGreen;
    blue += pixelBlue;
  }
  const signature = toOklab([
    red / opaqueCount,
    green / opaqueCount,
    blue / opaqueCount,
  ]);
  return {
    id: `mac1-${slug}`,
    label: `System 1 · ${label}`,
    width: ICON_SIZE,
    height: ICON_SIZE,
    palette: ['#00000000', '#ffffffff', '#000000ff'],
    pixels: encodeRuns(pixels),
    encoding: 'rle',
    signature: Object.fromEntries(Object.entries(signature).map(([key, value]) => (
      [key, Number(value.toFixed(6))]
    ))),
  };
};

const formatIcon = (icon) => `  ${JSON.stringify(icon, null, 2)
  .replaceAll('"', "'")
  .replaceAll('\n', '\n  ')},`;

const [sourceRoot, outputPath] = process.argv.slice(2);
if (!sourceRoot || !outputPath) {
  throw new Error(
    'Usage: node scripts/generate-ui-shape-macintosh-icons.mjs <Classic-Mac-icons root> <output>',
  );
}

const icons = await Promise.all(ICONS.map((icon) => readIcon(sourceRoot, icon)));
const output = `// Generated from thomasareed/Classic-Mac-icons commit ${SOURCE_COMMIT}.
// The upstream repository does not declare a licence; see THIRD_PARTY_NOTICES.md.

import type { UiShapeIconDefinition } from '@/utils/uiShapeIcons';

export const UI_SHAPE_MACINTOSH_ICONS: readonly UiShapeIconDefinition[] = [
${icons.map(formatIcon).join('\n')}
];
`;

await writeFile(outputPath, output);
