import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const SOURCE_COMMIT = 'e976bf66ca181d6f14d7f120d3c665e2197a59d8';
const SOURCE_PIXELS_PER_OUTPUT_PIXEL = 50;
const SOURCE_INSET = 4;
const EXCLUDED_FILENAMES = new Set([
  'Shadowgate.png',
]);

const iconLabel = (filename) => {
  const basename = filename.replace(/\.png$/i, '');
  const capitalized = basename === 'bomb' ? 'Bomb' : basename;
  return capitalized.replaceAll(' - ', ' — ');
};

const iconSlug = (filename) => filename
  .replace(/\.png$/i, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const byteHex = (value) => value.toString(16).padStart(2, '0');

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

const readIcon = async (sourceRoot, filename) => {
  const sourcePath = path.join(sourceRoot, 'png', filename);
  const metadata = await sharp(sourcePath).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not read source dimensions for ${filename}.`);
  }
  const sourceWidth = Math.round(metadata.width / SOURCE_PIXELS_PER_OUTPUT_PIXEL);
  const sourceHeight = Math.round(metadata.height / SOURCE_PIXELS_PER_OUTPUT_PIXEL);
  const iconWidth = sourceWidth - SOURCE_INSET * 2;
  const iconHeight = sourceHeight - SOURCE_INSET * 2;
  if (iconWidth < 1 || iconHeight < 1) {
    throw new Error(`Source is too small after inset removal: ${filename}.`);
  }
  const { data, info } = await sharp(sourcePath)
    .resize(sourceWidth, sourceHeight, { kernel: sharp.kernel.nearest })
    .extract({
      left: SOURCE_INSET,
      top: SOURCE_INSET,
      width: iconWidth,
      height: iconHeight,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const palette = ['#00000000'];
  const paletteIndexes = new Map([[palette[0], 0]]);
  const pixels = [];
  let opacity = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  let hasChromaticPixel = false;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const pixelRed = data[offset] ?? 0;
    const pixelGreen = data[offset + 1] ?? 0;
    const pixelBlue = data[offset + 2] ?? 0;
    const alpha = data[offset + 3] ?? 255;
    const color = alpha === 0
      ? palette[0]
      : `#${byteHex(pixelRed)}${byteHex(pixelGreen)}${byteHex(pixelBlue)}${byteHex(alpha)}`;
    let paletteIndex = paletteIndexes.get(color);
    if (paletteIndex === undefined) {
      paletteIndex = palette.length;
      if (paletteIndex > 255) {
        throw new Error(`Source uses more than 256 colours: ${filename}.`);
      }
      palette.push(color);
      paletteIndexes.set(color, paletteIndex);
    }
    pixels.push(paletteIndex);
    if (alpha > 0 && (pixelRed !== pixelGreen || pixelGreen !== pixelBlue)) {
      hasChromaticPixel = true;
    }
    const alphaWeight = alpha / 255;
    opacity += alphaWeight;
    red += pixelRed * alphaWeight;
    green += pixelGreen * alphaWeight;
    blue += pixelBlue * alphaWeight;
  }
  if (hasChromaticPixel) return null;
  const signature = toOklab([
    red / opacity,
    green / opacity,
    blue / opacity,
  ]);
  return {
    id: `mac1-${iconSlug(filename)}`,
    label: `Classic Mac · ${iconLabel(filename)}`,
    width: iconWidth,
    height: iconHeight,
    palette,
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

const filenames = (await readdir(path.join(sourceRoot, 'png')))
  .filter((filename) => (
    filename.toLowerCase().endsWith('.png')
    && !EXCLUDED_FILENAMES.has(filename)
  ))
  .sort((left, right) => left.localeCompare(right));
const icons = (await Promise.all(filenames.map((filename) => readIcon(sourceRoot, filename))))
  .filter((icon) => icon !== null);
const output = `// Generated from thomasareed/Classic-Mac-icons commit ${SOURCE_COMMIT}.
// The upstream repository does not declare a licence; see THIRD_PARTY_NOTICES.md.

import type { UiShapeIconDefinition } from '@/utils/uiShapeIcons';

export const UI_SHAPE_MACINTOSH_ICONS: readonly UiShapeIconDefinition[] = [
${icons.map(formatIcon).join('\n')}
];
`;

await writeFile(outputPath, output);
