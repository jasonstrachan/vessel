import {
  getGobletArtifactHealth,
  type GobletArtifact,
} from '@/utils/export/goblet/gobletArtifact';
import {
  getGobletPublishers,
  registerGobletPublisher,
} from '@/utils/export/goblet/gobletPublisherRegistry';

const createArtifact = (): GobletArtifact => ({
  blob: new Blob(['goblet'], { type: 'text/html' }),
  filename: 'artwork-goblet.html',
  metadata: {
    format: 'vessel-goblet2',
    version: 1,
    exportedAt: '2026-08-15T00:00:00.000Z',
    project: {
      id: 'project-1',
      name: 'Artwork',
      width: 512,
      height: 512,
      backgroundColor: '#000000',
    },
    viewport: {
      mode: 'fixed',
      designWidth: 512,
      designHeight: 512,
    },
    container: {
      flow: 'row',
      justify: 'start',
      align: 'start',
      wrap: false,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      sizeMode: 'fill',
    },
    animation: {
      fps: 60,
      totalFrames: 120,
      durationSeconds: 2,
      perfectLoop: true,
    },
    settings: {
      includeHiddenLayers: false,
      embedCanvasFallback: false,
      minifyOutput: true,
      pixelPerfectStack: true,
      perfectLoop: true,
      bundleFormat: 'single-html',
      displayFilters: [],
      htmlTitle: 'Artwork',
      htmlBackgroundColor: '#000000',
      transparencyBackgroundMode: 'checker',
    },
    layers: [],
  },
  sizeReport: {
    format: 'single-html',
    totalBytes: 7,
    metadataBytes: 0,
    runtimeBytes: 0,
    htmlBytes: 7,
    ccBufferBytes: 0,
    maskBytes: 0,
    textureBytes: 0,
    sequentialFrameBytes: 0,
    previewBytes: 0,
    fallbackBytes: 0,
    binarySidecarBytes: 0,
    binarySidecarCount: 0,
    duplicatedMetadataBytes: 0,
  },
});

describe('Goblet release workflow', () => {
  it('summarizes artifact and performance health from the built artifact', () => {
    const metrics = getGobletArtifactHealth(createArtifact());

    expect(metrics.map((metric) => metric.id)).toEqual([
      'artifact-size',
      'layers',
      'viewport',
      'animation',
      'payload',
    ]);
    expect(metrics.every((metric) => metric.status === 'ok')).toBe(true);
  });

  it('passes the exact artifact object to a registered publisher', async () => {
    const artifact = createArtifact();
    const publish = jest.fn(async () => ({ message: 'Published' }));
    const unregister = registerGobletPublisher({
      id: 'test-archive',
      label: 'Test archive',
      publish,
    });

    try {
      const publisher = getGobletPublishers().find((entry) => entry.id === 'test-archive');
      await publisher?.publish(artifact, {
        projectId: 'project-1',
        projectName: 'Artwork',
      });

      expect(publish).toHaveBeenCalledWith(artifact, {
        projectId: 'project-1',
        projectName: 'Artwork',
      });
    } finally {
      unregister();
    }
  });

  it('does not silently replace a registered publisher with the same id', () => {
    const unregister = registerGobletPublisher({
      id: 'duplicate-test',
      label: 'Original',
      publish: async () => ({ message: 'Published' }),
    });

    try {
      expect(() => registerGobletPublisher({
        id: 'duplicate-test',
        label: 'Replacement',
        publish: async () => ({ message: 'Published' }),
      })).toThrow('already registered');
      expect(getGobletPublishers().find(({ id }) => id === 'duplicate-test')?.label).toBe('Original');
    } finally {
      unregister();
    }
  });
});
