import { estimateExport, runExport } from '@/utils/export/exportService';
import type { ExportEstimateRequest, FrameProvider } from '@/utils/export/types';

describe('exportService', () => {
  const blobToBytes = async (blob: Blob): Promise<Uint8Array> => {
    const maybeArrayBuffer = blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
    if (typeof maybeArrayBuffer.arrayBuffer === 'function') {
      return new Uint8Array(await maybeArrayBuffer.arrayBuffer());
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
      reader.onload = () => {
        const result = reader.result;
        if (!(result instanceof ArrayBuffer)) {
          reject(new Error('Unexpected FileReader result'));
          return;
        }
        resolve(new Uint8Array(result));
      };
      reader.readAsArrayBuffer(blob);
    });
  };

  const hashBytes = (bytes: Uint8Array): string => {
    let hash = 2166136261;
    for (let i = 0; i < bytes.length; i += 1) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };

  const createDeterministicGifencModule = (): typeof import('gifenc') => ({
    quantize: jest.fn((rgba: Uint8Array) => {
      const palette = new Map<number, [number, number, number, number]>();
      for (let i = 0; i < rgba.length; i += 4) {
        const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
        if (!palette.has(key)) {
          palette.set(key, [rgba[i], rgba[i + 1], rgba[i + 2], 255]);
          if (palette.size >= 256) {
            break;
          }
        }
      }
      return palette.size > 0 ? Array.from(palette.values()) : [[0, 0, 0, 255]];
    }),
    applyPalette: jest.fn((data: Uint8ClampedArray, palette: number[][]) => {
      const index = new Uint8Array(data.length / 4);
      for (let p = 0, px = 0; p < data.length; p += 4, px += 1) {
        const rgb = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
        let match = palette.findIndex(
          (entry) => ((entry[0] << 16) | (entry[1] << 8) | entry[2]) === rgb
        );
        if (match < 0) {
          match = 0;
        }
        index[px] = match;
      }
      return index;
    }),
    GIFEncoder: jest.fn(() => {
      const framePayload: number[] = [];
      return {
        writeFrame: jest.fn((
          index: Uint8Array,
          width: number,
          height: number,
          options: { delay?: number; repeat?: number; transparentIndex?: number }
        ) => {
          framePayload.push(
            width & 0xff,
            height & 0xff,
            (options.delay ?? 0) & 0xff,
            (options.repeat ?? 0) & 0xff,
            (options.transparentIndex ?? 255) & 0xff
          );
          for (let i = 0; i < index.length; i += 1) {
            framePayload.push(index[i]);
          }
        }),
        finish: jest.fn(),
        bytes: jest.fn(() => Uint8Array.from(framePayload)),
      };
    }),
  } as unknown as typeof import('gifenc'));

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

  it('always finishes animation session during estimate to restore runtime state', async () => {
    const finish = jest.fn();
    const frameProvider: FrameProvider = {
      getDimensions: () => ({ width: 2, height: 2 }),
      compositeToCanvas: (canvas) => {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = 'rgb(255, 0, 0)';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      },
      beginAnimationSession: () => ({
        stepFrame: jest.fn(),
        advanceFrame: jest.fn(),
        finish,
      }),
    };

    const request: ExportEstimateRequest = {
      kind: 'gif',
      scale: 1,
      frameProvider,
      options: {
        fps: 12,
        durationSeconds: 1,
        repeat: 0,
        autoFrames: false,
        frameStep: 1,
        ditherMethod: 'none',
        ditherStrength: 1,
        maxColors: 64,
        autoColors: true,
      },
      gifencModule: {
        quantize: jest.fn(() => [[255, 0, 0, 255]]),
        applyPalette: jest.fn(() => new Uint8Array([0, 0, 0, 0])),
        GIFEncoder: jest.fn(() => ({
          writeFrame: jest.fn(),
          finish: jest.fn(),
          bytes: jest.fn(() => new Uint8Array(12)),
        })),
      } as unknown as typeof import('gifenc'),
    };

    await estimateExport(request);
    expect(finish).toHaveBeenCalledTimes(1);
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

  it('produces hash-identical GIF bytes for repeated fixed-seed frame sessions', async () => {
    const makeSequentialLikeFrameProvider = () => {
      let currentFrame = 0;
      const steppedFrames: number[] = [];

      const frameProvider: FrameProvider = {
        getDimensions: () => ({ width: 2, height: 2 }),
        compositeToCanvas: (canvas) => {
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            return;
          }
          const r = (currentFrame * 53) % 256;
          const g = (currentFrame * 97) % 256;
          const b = (currentFrame * 193) % 256;
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        },
        beginAnimationSession: () => ({
          stepFrame: ({ frameIndex }) => {
            currentFrame = frameIndex;
            steppedFrames.push(frameIndex);
          },
          advanceFrame: () => {},
          finish: () => {
            currentFrame = 0;
          },
        }),
      };

      return { frameProvider, steppedFrames };
    };

    const runDeterministicGif = async () => {
      const { frameProvider, steppedFrames } = makeSequentialLikeFrameProvider();
      const result = await runExport(
        {
          kind: 'gif',
          filenameBase: 'Deterministic',
          scale: 1,
          frameProvider,
          gifencModule: createDeterministicGifencModule(),
          options: {
            fps: 10,
            durationSeconds: 0.2,
            repeat: 0,
            autoFrames: false,
            frameStep: 1,
            ditherMethod: 'none',
            ditherStrength: 1,
            maxColors: 64,
            autoColors: true,
          },
        },
        jest.fn(),
        new AbortController().signal
      );

      if (result.kind !== 'gif') {
        throw new Error(`Expected gif export, received ${result.kind}`);
      }

      const bytes = await blobToBytes(result.blob);
      return { bytes, hash: hashBytes(bytes), steppedFrames };
    };

    const first = await runDeterministicGif();
    const second = await runDeterministicGif();

    expect(first.steppedFrames).toEqual([0, 1]);
    expect(second.steppedFrames).toEqual([0, 1]);
    expect(first.bytes).toEqual(second.bytes);
    expect(first.hash).toBe(second.hash);
  });
});
