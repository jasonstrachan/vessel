import type { GobletArtifact } from '@/utils/export/goblet/gobletArtifact';
import {
  __resetHostGobletPublishersForTests,
  createManifestGobletPublisher,
  hydrateHostGobletPublishers,
  parseGobletPublisherManifest,
} from '@/utils/export/goblet/gobletPublisherManifest';
import { getGobletPublishers } from '@/utils/export/goblet/gobletPublisherRegistry';

const response = ({
  body = '',
  contentType = 'application/json',
  status = 200,
  url = 'https://studio.example/vessel-publishers.json',
}: {
  body?: string;
  contentType?: string;
  status?: number;
  url?: string;
}): Response => ({
  ok: status >= 200 && status < 300,
  status,
  url,
  headers: {
    get: (name: string) => name.toLowerCase() === 'content-type' ? contentType : null,
  } as Headers,
  json: async () => JSON.parse(body),
  text: async () => body,
} as Response);

const createArtifact = (): GobletArtifact => ({
  blob: new Blob(['goblet'], { type: 'text/html' }),
  filename: 'portrait-goblet.html',
  metadata: {
    format: 'vessel-goblet2',
    version: 1,
    exportedAt: '2026-08-15T00:00:00.000Z',
    project: {
      id: 'project-1',
      name: 'Portrait',
      width: 512,
      height: 640,
      backgroundColor: '#000000',
    },
    viewport: {
      mode: 'fixed',
      designWidth: 512,
      designHeight: 640,
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
      htmlTitle: 'Portrait',
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

describe('Goblet publisher manifests', () => {
  afterEach(() => {
    __resetHostGobletPublishersForTests();
  });

  it('validates data-only publisher descriptors and resolves relative endpoints', () => {
    expect(parseGobletPublisherManifest({
      schemaVersion: 1,
      publishers: [{ id: 'archive', label: 'Archive', endpoint: './publish' }],
    }, 'https://studio.example/config/publishers.json')).toEqual({
      schemaVersion: 1,
      publishers: [{
        id: 'archive',
        label: 'Archive',
        endpoint: 'https://studio.example/config/publish',
      }],
    });

    expect(() => parseGobletPublisherManifest({
      schemaVersion: 1,
      publishers: [{
        id: 'archive',
        label: 'Archive',
        endpoint: 'https://token:secret@publisher.example/upload',
      }],
    }, 'https://studio.example/vessel-publishers.json')).toThrow('without embedded credentials');
  });

  it('posts the exact artifact and schema-versioned metadata to the fixed endpoint', async () => {
    const fetcher = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => response({
      body: JSON.stringify({ message: 'Stored', url: 'https://archive.example/works/1' }),
    }));
    const artifact = createArtifact();
    const publisher = createManifestGobletPublisher({
      id: 'archive',
      label: 'Archive',
      endpoint: 'https://publisher.example/api/vessel/goblets',
    }, fetcher);

    await expect(publisher.publish(artifact, {
      projectId: 'project-1',
      projectName: 'Portrait',
    })).resolves.toEqual({
      message: 'Stored',
      url: 'https://archive.example/works/1',
    });

    const [endpoint, init] = fetcher.mock.calls[0];
    expect(endpoint).toBe('https://publisher.example/api/vessel/goblets');
    expect(init).toEqual(expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    }));
    const form = init?.body as FormData;
    const file = form.get('file') as File;
    expect(file.name).toBe(artifact.filename);
    expect(file.size).toBe(artifact.blob.size);
    expect(JSON.parse(String(form.get('metadata')))).toEqual({
      schemaVersion: 1,
      source: 'vessel',
      project: { id: 'project-1', name: 'Portrait' },
      artifact: {
        filename: 'portrait-goblet.html',
        mimeType: 'text/html',
        bytes: 6,
        format: 'vessel-goblet2',
        version: 1,
        exportedAt: '2026-08-15T00:00:00.000Z',
        width: 512,
        height: 640,
        durationSeconds: 2,
      },
    });
  });

  it('hydrates a host manifest once and treats a missing manifest as no publisher', async () => {
    const manifestFetcher = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => response({
      body: JSON.stringify({
        schemaVersion: 1,
        publishers: [{
          id: 'archive',
          label: 'Archive',
          endpoint: 'https://publisher.example/api/vessel/goblets',
        }],
      }),
    }));

    const first = await hydrateHostGobletPublishers({
      fetcher: manifestFetcher,
      manifestUrl: 'https://studio.example/vessel-publishers.json',
    });
    const second = await hydrateHostGobletPublishers({
      fetcher: manifestFetcher,
      manifestUrl: 'https://studio.example/vessel-publishers.json',
    });

    expect(first).toHaveLength(1);
    expect(second).toBe(first);
    expect(manifestFetcher).toHaveBeenCalledTimes(1);
    expect(getGobletPublishers().map(({ id }) => id)).toContain('archive');

    __resetHostGobletPublishersForTests();
    const missingFetcher = jest.fn<Promise<Response>, Parameters<typeof fetch>>(
      async () => response({ status: 404 }),
    );
    await expect(hydrateHostGobletPublishers({
      fetcher: missingFetcher,
      manifestUrl: 'https://studio.example/vessel-publishers.json',
    })).resolves.toEqual([]);
    expect(getGobletPublishers()).toEqual([]);
  });
});
