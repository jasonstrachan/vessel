import JSZip from 'jszip';

import {
  createGobletSizeReport,
  createGobletZipPayloadPlan,
  updateGobletSizeReportPayloadTotals,
} from '@/utils/export/goblet/gobletSizeReport';
import type { WebGLExportMetadata } from '@/utils/export/goblet/gobletTypes';

const baseMetadata = (): WebGLExportMetadata => ({
  format: 'vessel-goblet2',
  version: 1,
  exportedAt: '2026-05-06T00:00:00.000Z',
  project: {
    id: 'project',
    name: 'Project',
    width: 64,
    height: 64,
    backgroundColor: 'transparent',
  },
  colorCycle: {
    schemaVersion: 2,
  },
  viewport: {
    mode: 'fixed',
    designWidth: 64,
    designHeight: 64,
  },
  container: {
    flow: 'row',
    justify: 'center',
    align: 'center',
    wrap: false,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    sizeMode: 'fixed',
    width: 64,
    height: 64,
  },
  animation: {
    fps: 24,
    totalFrames: 1,
    durationSeconds: 1,
    perfectLoop: true,
  },
  settings: {
    includeHiddenLayers: true,
    embedCanvasFallback: false,
    minifyOutput: true,
    pixelPerfectStack: false,
    perfectLoop: true,
    bundleFormat: 'zip',
    displayFilters: [],
    htmlTitle: 'Goblet',
    htmlBackgroundColor: '#000000',
    transparencyBackgroundMode: 'checker',
  },
  layers: [],
});

const addBrushLayer = (metadata: WebGLExportMetadata, length: number): WebGLExportMetadata => {
  metadata.layers.push({
    id: `brush-${length}`,
    name: `Brush ${length}`,
    type: 'color-cycle',
    source: { width: length, height: 1 },
    documentBoundsPx: { x: 0, y: 0, width: length, height: 1 },
    documentBoundsPercent: { x: 0, y: 0, width: 100, height: 100 },
    alignment: {
      fit: 'none',
      horizontal: 'left',
      vertical: 'top',
      positioning: 'anchor',
    },
    colorCycle: {
      mode: 'brush',
      isAnimating: true,
      brushState: {
        width: length,
        height: 1,
        indexBuffer: Array.from({ length }, (_, index) => (index % 251) + 1),
        gradientIdBuffer: Array.from({ length }, (_, index) => index % 2),
        flowBuffer: Array.from({ length }, () => 1),
        phaseBuffer: Array.from({ length }, (_, index) => index & 255),
        gradientStops: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        animationOffset: 0,
        targetFPS: 24,
      },
    },
  });
  return metadata;
};

const addSequentialLayer = (metadata: WebGLExportMetadata): WebGLExportMetadata => {
  metadata.layers.push({
    id: 'seq',
    name: 'Sequential',
    type: 'sequential',
    source: { width: 1, height: 1 },
    documentBoundsPx: { x: 0, y: 0, width: 1, height: 1 },
    documentBoundsPercent: { x: 0, y: 0, width: 100, height: 100 },
    alignment: {
      fit: 'none',
      horizontal: 'left',
      vertical: 'top',
      positioning: 'anchor',
    },
    assets: {
      textureFrames: [
        'data:image/png;base64,AAAA',
        'data:image/png;base64,AAAA',
      ],
      textureFrameMap: [0, 1],
    },
    sequential: {
      fps: 12,
      totalFrames: 2,
      durationSeconds: 1,
      perfectLoop: true,
    },
  });
  return metadata;
};

describe('Goblet size report', () => {
  it('breaks down sparse, dense, and sequential fixture payloads', () => {
    const sparse = addBrushLayer(baseMetadata(), 32);
    const dense = addBrushLayer(baseMetadata(), 2048);
    const sequential = addSequentialLayer(baseMetadata());

    const sparseJson = JSON.stringify(sparse);
    const denseJson = JSON.stringify(dense);
    const sequentialJson = JSON.stringify(sequential);

    const sparseReport = createGobletSizeReport({
      metadata: sparse,
      metadataJson: sparseJson,
      format: 'json',
    });
    const denseReport = createGobletSizeReport({
      metadata: dense,
      metadataJson: denseJson,
      format: 'json',
    });
    const sequentialReport = createGobletSizeReport({
      metadata: sequential,
      metadataJson: sequentialJson,
      format: 'json',
    });

    expect(sparseReport.ccBufferBytes).toBe(32 * 4);
    expect(denseReport.ccBufferBytes).toBe(2048 * 4);
    expect(denseReport.ccBufferBytes).toBeGreaterThan(sparseReport.ccBufferBytes);
    expect(sequentialReport.sequentialFrameBytes).toBeGreaterThan(0);
  });

  it('externalizes large ZIP numeric payloads while leaving small payloads inline', () => {
    const sparse = addBrushLayer(baseMetadata(), 32);
    const dense = addBrushLayer(baseMetadata(), 2048);

    const sparsePlan = createGobletZipPayloadPlan({
      metadata: sparse,
      metadataJson: JSON.stringify(sparse),
      runtimeBytes: 100,
      htmlBytes: 50,
    });
    const densePlan = createGobletZipPayloadPlan({
      metadata: dense,
      metadataJson: JSON.stringify(dense),
      runtimeBytes: 100,
      htmlBytes: 50,
    });

    expect(sparsePlan.binaryEntries).toHaveLength(0);
    expect(densePlan.binaryEntries.length).toBeGreaterThanOrEqual(4);
    expect(densePlan.report.binarySidecarBytes).toBe(2048 * 4);
    expect(JSON.stringify(densePlan.metadata)).toContain('"ref":"buffers/');
  });

  it('recomputes ZIP totals from the rewritten metadata and sidecars', () => {
    const dense = addBrushLayer(baseMetadata(), 2048);
    const inlineJson = JSON.stringify(dense);
    const densePlan = createGobletZipPayloadPlan({
      metadata: dense,
      metadataJson: inlineJson,
      runtimeBytes: 100,
      htmlBytes: 50,
    });
    const rewrittenJson = JSON.stringify(densePlan.metadata);

    const finalizedReport = updateGobletSizeReportPayloadTotals(
      densePlan.report,
      rewrittenJson,
      densePlan.binaryEntries
    );

    expect(finalizedReport.metadataBytes).toBe(new TextEncoder().encode(rewrittenJson).byteLength);
    expect(finalizedReport.binarySidecarBytes).toBe(2048 * 4);
    expect(finalizedReport.totalBytes).toBe(
      finalizedReport.metadataBytes +
      finalizedReport.runtimeBytes +
      finalizedReport.htmlBytes +
      finalizedReport.binarySidecarBytes
    );
    expect(finalizedReport.totalBytes).toBeLessThan(densePlan.report.totalBytes);
  });

  it('shows a smaller ZIP for deterministic dense noisy buffers', async () => {
    const length = 65_536;
    let seed = 1;
    const nextByte = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed & 255;
    };
    const metadata = addBrushLayer(baseMetadata(), length);
    const brushState = metadata.layers[0].colorCycle?.brushState;
    if (!brushState) {
      throw new Error('Missing brush state');
    }
    brushState.indexBuffer = Array.from({ length }, nextByte);
    brushState.gradientIdBuffer = Array.from({ length }, nextByte);
    brushState.flowBuffer = Array.from({ length }, nextByte);
    brushState.phaseBuffer = Array.from({ length }, nextByte);

    const inlineJson = JSON.stringify(metadata);
    const sidecarPlan = createGobletZipPayloadPlan({
      metadata,
      metadataJson: inlineJson,
      runtimeBytes: 100,
      htmlBytes: 50,
    });
    const sidecarJson = JSON.stringify(sidecarPlan.metadata);
    const compression = {
      type: 'nodebuffer' as const,
      compression: 'DEFLATE' as const,
      compressionOptions: { level: 9 },
    };

    const compatibleZip = new JSZip();
    compatibleZip.file('index.html', inlineJson);
    compatibleZip.file('bundle-goblet.json', inlineJson);
    const leanZip = new JSZip();
    leanZip.file('index.html', 'fetch("bundle-goblet.json")');
    leanZip.file('bundle-goblet.json', sidecarJson);
    sidecarPlan.binaryEntries.forEach((entry) => {
      leanZip.file(entry.path, entry.bytes);
    });

    const compatibleBytes = await compatibleZip.generateAsync(compression);
    const leanBytes = await leanZip.generateAsync(compression);

    expect(leanBytes.byteLength).toBeLessThan(compatibleBytes.byteLength);
    expect(compatibleBytes.byteLength - leanBytes.byteLength).toBeGreaterThan(1_000);
  });
});
