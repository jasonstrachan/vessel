import type {
  GobletSizeReport,
  WebGLExportMetadata,
} from '@/utils/export/goblet/gobletTypes';

export interface GobletArtifact {
  blob: Blob;
  filename: string;
  metadata: WebGLExportMetadata;
  sizeReport: GobletSizeReport;
}

export interface GobletHealthMetric {
  id: string;
  label: string;
  value: string;
  status: 'ok' | 'warning';
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const getGobletArtifactHealth = (artifact: GobletArtifact): GobletHealthMetric[] => {
  const { metadata, sizeReport } = artifact;
  const dynamicLayerCount = metadata.layers.filter((layer) => (
    Boolean(layer.colorCycle?.isAnimating) || Boolean(layer.sequential)
  )).length;
  const designPixels = Math.max(1, metadata.viewport.designWidth)
    * Math.max(1, metadata.viewport.designHeight);

  return [
    {
      id: 'artifact-size',
      label: 'Artifact',
      value: formatBytes(artifact.blob.size),
      status: artifact.blob.size > 25 * 1024 * 1024 ? 'warning' : 'ok',
    },
    {
      id: 'layers',
      label: 'Layers',
      value: `${metadata.layers.length} total / ${dynamicLayerCount} animated`,
      status: dynamicLayerCount > 12 || metadata.layers.length > 40 ? 'warning' : 'ok',
    },
    {
      id: 'viewport',
      label: 'Viewport',
      value: `${metadata.viewport.designWidth} × ${metadata.viewport.designHeight}`,
      status: designPixels > 4_000_000 ? 'warning' : 'ok',
    },
    {
      id: 'animation',
      label: 'Animation',
      value: `${metadata.animation.totalFrames} frames at ${metadata.animation.fps} FPS`,
      status: metadata.animation.fps > 60 ? 'warning' : 'ok',
    },
    {
      id: 'payload',
      label: 'Artwork payload (raw)',
      value: formatBytes(
        sizeReport.ccBufferBytes
        + sizeReport.maskBytes
        + sizeReport.textureBytes
        + sizeReport.sequentialFrameBytes,
      ),
      status: sizeReport.sequentialFrameBytes > 20 * 1024 * 1024 ? 'warning' : 'ok',
    },
  ];
};
