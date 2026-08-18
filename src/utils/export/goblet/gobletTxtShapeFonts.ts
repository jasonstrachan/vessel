import type { TxtShape } from '@/types';
import {
  getTxtShapeFontDefinition,
  getTxtShapeFontMimeType,
  loadTxtShapeFont,
} from '@/utils/txtShapeFonts';
import { ensureTxtShapeMonoFonts } from '@/utils/txtShapeMonoRenderer';
import {
  resolveGobletAssetUrl,
  type GobletAssetRoot,
} from '@/utils/export/goblet/gobletRuntimeAssets';

interface TxtShapeFontUsage {
  family: TxtShape['fontFamily'];
  size: number;
}

const getUsedBundledFonts = (shapes: readonly TxtShape[]): TxtShapeFontUsage[] => {
  const usageByFamily = new Map<TxtShape['fontFamily'], number>();
  shapes.forEach((shape) => {
    const definition = getTxtShapeFontDefinition(shape.fontFamily);
    if (!definition.asset) return;
    usageByFamily.set(
      shape.fontFamily,
      Math.max(shape.fontSize, usageByFamily.get(shape.fontFamily) ?? 0),
    );
  });
  return [...usageByFamily].map(([family, size]) => ({ family, size }));
};

export const ensureTxtShapeFontsReadyForRaster = async (
  shapes: readonly TxtShape[],
): Promise<void> => {
  const usages = getUsedBundledFonts(shapes);
  const [loaded, didLoadMonoFaces] = await Promise.all([
    Promise.all(usages.map(({ family, size }) => loadTxtShapeFont(family, size))),
    ensureTxtShapeMonoFonts(usages.map(({ family }) => family)),
  ]);
  const missingIndex = loaded.findIndex((didLoad) => !didLoad);
  if (missingIndex >= 0) {
    const definition = getTxtShapeFontDefinition(usages[missingIndex]!.family);
    throw new Error(`TXT Shape font "${definition.label}" is not available for Goblet export.`);
  }
  if (!didLoadMonoFaces) {
    throw new Error('TXT Shape monochrome font renderer is not available for Goblet export.');
  }
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const resolveFontAssetUrl = (
  fileName: string,
  assetPrefix: string | undefined,
  gobletAssetRoot: GobletAssetRoot,
): string => {
  const indexUrl = resolveGobletAssetUrl('index.html', assetPrefix, gobletAssetRoot);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  return new URL(`../assets/fonts/${fileName}`, new URL(indexUrl, origin)).toString();
};

interface InlineTxtShapeFontsOptions {
  template: string;
  shapes: readonly TxtShape[];
  assetPrefix?: string;
  gobletAssetRoot: GobletAssetRoot;
  signal?: AbortSignal;
}

export const inlineTxtShapeFontsInGobletTemplate = async ({
  template,
  shapes,
  assetPrefix,
  gobletAssetRoot,
  signal,
}: InlineTxtShapeFontsOptions): Promise<string> => {
  let inlined = template;
  for (const { family } of getUsedBundledFonts(shapes)) {
    const definition = getTxtShapeFontDefinition(family);
    if (!definition.asset) continue;
    const url = resolveFontAssetUrl(definition.asset.fileName, assetPrefix, gobletAssetRoot);
    const response = await fetch(url, { cache: 'no-store', signal });
    if (!response.ok) {
      throw new Error(
        `Failed to bundle TXT Shape font ${definition.asset.fileName} from ${url} (${response.status})`,
      );
    }
    const mimeType = getTxtShapeFontMimeType(definition.asset.format);
    const dataUrl = `data:${mimeType};base64,${bytesToBase64(new Uint8Array(await response.arrayBuffer()))}`;
    inlined = inlined.replaceAll(`../assets/fonts/${definition.asset.fileName}`, dataUrl);
  }
  return inlined;
};
