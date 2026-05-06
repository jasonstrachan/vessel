import type { GobletAssetName } from '@/utils/export/goblet/gobletRuntimeAssets';
import { createZipGobletHtml } from '@/utils/export/goblet/gobletHtmlBuilder';
import type { GobletBinaryPayloadEntry } from '@/utils/export/goblet/gobletSizeReport';

type JSZipConstructor = typeof import('jszip');

let jszipCtorPromise: Promise<JSZipConstructor> | null = null;

const loadJSZip = async (): Promise<JSZipConstructor> => {
  if (!jszipCtorPromise) {
    jszipCtorPromise = import('jszip').then((mod) => {
      const namespace = mod as unknown as { default?: JSZipConstructor };
      return namespace.default ?? (mod as unknown as JSZipConstructor);
    });
  }
  return jszipCtorPromise;
};

export interface GobletZipBuildRequest {
  indexHtml: string;
  metadataFilename: string;
  metadataJson: string;
  diagnosticsEnabled: boolean;
  runtimeAsset: GobletAssetName;
  runtimeJs: string;
  alignJs: string;
  displayFilterJs: string;
  numJs: string;
  inflateJs: string;
  minify: boolean;
  embedMetadataFallback?: boolean;
  binaryEntries?: GobletBinaryPayloadEntry[];
}

export const createGobletZipBlob = async ({
  indexHtml,
  metadataFilename,
  metadataJson,
  diagnosticsEnabled,
  runtimeAsset,
  runtimeJs,
  alignJs,
  displayFilterJs,
  numJs,
  inflateJs,
  minify,
  embedMetadataFallback = false,
  binaryEntries = [],
}: GobletZipBuildRequest): Promise<Blob> => {
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  zip.file(
    'index.html',
    createZipGobletHtml(
      indexHtml,
      metadataFilename,
      embedMetadataFallback ? metadataJson : null,
      diagnosticsEnabled
    )
  );
  zip.file(runtimeAsset, runtimeJs);
  zip.file('alignFitResolver.js', alignJs);
  zip.file('displayFilterPipeline.js', displayFilterJs);
  zip.file('num.js', numJs);
  zip.file('fflate-inflate.js', inflateJs);
  zip.file(metadataFilename, metadataJson);
  binaryEntries.forEach((entry) => {
    zip.file(entry.path, entry.bytes);
  });
  return await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: {
      level: minify ? 9 : 6
    }
  });
};
