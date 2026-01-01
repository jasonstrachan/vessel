import { estimateExport, runExport } from '@/utils/export/exportService';
import type { ExportEstimateRequest, FrameProvider } from '@/utils/export/types';

describe('exportService', () => {
  const makeFrameProvider = (): FrameProvider => ({
    getDimensions: () => ({ width: 2, height: 2 }),
    compositeToCanvas: (canvas) => {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'rgb(255, 0, 0)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    },
    beginAnimationSession: () => ({
      stepFrame: () => {},
      advanceFrame: () => {},
      finish: () => {},
    }),
  });

  it('estimates GIF palette size and bytes', async () => {
    const gifencModule = {
      quantize: jest.fn(() => [[255, 0, 0, 255]]),
      applyPalette: jest.fn(() => new Uint8Array([0, 0, 0, 0])),
      GIFEncoder: jest.fn(() => ({
        writeFrame: jest.fn(),
        finish: jest.fn(),
        bytes: jest.fn(() => new Uint8Array(12)),
      })),
    } as unknown as typeof import('gifenc');

    const request: ExportEstimateRequest = {
      kind: 'gif',
      scale: 1,
      frameProvider: makeFrameProvider(),
      gifencModule,
      options: {
        fps: 12,
        durationSeconds: 1,
        repeat: 0,
        autoFrames: false,
        frameStep: 1,
        ditherMethod: 'none',
        ditherStrength: 1,
        maxColors: 128,
        autoColors: true,
      },
    };

    const result = await estimateExport(request);
    expect(result.paletteSize).toBeGreaterThan(0);
    expect(result.estimatedBytes).toBeGreaterThan(0);
  });

  it('runs PNG export and returns a blob', async () => {
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
      callback(new Blob(['png'], { type: 'image/png' }));
    };

    const abortController = new AbortController();
    const result = await runExport({
      kind: 'png',
      filenameBase: 'Demo',
      scale: 1,
      frameProvider: makeFrameProvider(),
      options: {
        quality: 1,
        includeBackground: true,
        backgroundColor: '#000000',
      },
    }, jest.fn(), abortController.signal);

    expect(result.kind).toBe('png');
    if (result.kind === 'png') {
      expect(result.filename).toBe('Demo@1x.png');
      expect(result.blob).toBeInstanceOf(Blob);
    }

    HTMLCanvasElement.prototype.toBlob = originalToBlob;
  });
});
