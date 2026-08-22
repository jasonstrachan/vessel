import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import {
  GobletReleaseActions,
  GobletReleaseSummary,
  resolveGobletPreviewFrame,
} from '@/components/modals/GobletReleasePanel';
import type { GobletArtifact } from '@/utils/export/goblet/gobletArtifact';
import { registerGobletPublisher } from '@/utils/export/goblet/gobletPublisherRegistry';

const createArtifact = (width = 1024, height = 768): GobletArtifact => ({
  blob: new Blob(['<html></html>'], { type: 'text/html' }),
  filename: 'artwork-goblet.html',
  metadata: {
    format: 'vessel-goblet2',
    version: 1,
    exportedAt: '2026-08-15T00:00:00.000Z',
    project: {
      id: 'project-1',
      name: 'Artwork',
      width,
      height,
      backgroundColor: '#000000',
    },
    viewport: {
      mode: 'fixed',
      designWidth: width,
      designHeight: height,
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
      htmlBackgroundColor: '#262626',
      transparencyBackgroundMode: 'checker',
    },
    layers: [],
  },
  sizeReport: {
    format: 'single-html',
    totalBytes: 13,
    metadataBytes: 0,
    runtimeBytes: 0,
    htmlBytes: 13,
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

describe('GobletReleaseSummary preview', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let hostWidth = 640;

  beforeAll(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: jest.fn(() => 'blob:artifact'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: jest.fn(),
    });
  });

  beforeEach(() => {
    hostWidth = 640;
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: 320,
      height: 320,
      left: 0,
      right: hostWidth,
      top: 0,
      width: hostWidth,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevokeObjectURL,
    });
  });

  it('fits the artifact native viewport inside the preview without iframe scrolling', async () => {
    render(<GobletReleaseSummary artifact={createArtifact()} />);

    const frame = await screen.findByTestId('goblet-preview-frame');
    await waitFor(() => expect(frame).toHaveStyle({ opacity: 1 }));

    expect(frame).toHaveAttribute('scrolling', 'no');
    expect(frame).toHaveStyle({
      height: '768px',
      transform: 'translate(-50%, -50%) scale(0.4166666666666667)',
      width: '1024px',
    });
    expect(screen.getByTestId('goblet-preview-host')).toHaveClass('overflow-hidden');

    hostWidth = 320;
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(frame).toHaveStyle({
      transform: 'translate(-50%, -50%) scale(0.3125)',
    }));
  });

  it('uses project dimensions when legacy viewport dimensions are unavailable', () => {
    const artifact = createArtifact(800, 400);
    artifact.metadata.viewport.designWidth = 0;
    artifact.metadata.viewport.designHeight = 0;

    expect(resolveGobletPreviewFrame(artifact, 400, 320)).toEqual({
      width: 800,
      height: 400,
      scale: 0.5,
    });
  });
});

describe('GobletReleaseActions', () => {
  it('prevents dismissal and download while a publish is in flight', () => {
    render(
      <GobletReleaseActions
        artifact={createArtifact()}
        publishingPublisherId="archive"
        onClose={jest.fn()}
        onDownload={jest.fn()}
        onPublish={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  });

  it('keeps an incompatible publisher visible with an actionable disabled state', () => {
    const unregister = registerGobletPublisher({
      id: 'html-archive',
      label: 'HTML archive',
      canPublish: () => false,
      unavailableReason: 'Single HTML required',
      publish: jest.fn(async () => ({ message: 'Published' })),
    });

    try {
      render(
        <GobletReleaseActions
          artifact={createArtifact()}
          publishingPublisherId={null}
          onClose={jest.fn()}
          onDownload={jest.fn()}
          onPublish={jest.fn()}
        />,
      );

      expect(screen.getByRole('button', {
        name: 'Publish to HTML archive (Single HTML required)',
      })).toBeDisabled();
    } finally {
      act(() => unregister());
    }
  });
});
