import * as realGifenc from 'gifenc';

import { estimateExport, runExport } from '@/utils/export/exportService';
import type { ExportEstimateRequest, ExportProgress, FrameProvider, GifExportRequest } from '@/utils/export/types';

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


  const readGraphicControls = (bytes: Uint8Array) => {
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe('GIF89a');
    let offset = 13 + ((bytes[10] & 128) ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0);
    const controls: Array<{ transparent: boolean; index: number }> = [];
    const skipBlocks = () => {
      while (bytes[offset] !== 0) {
        offset += bytes[offset] + 1;
        if (offset >= bytes.length) throw new Error('Truncated test GIF');
      }
      offset += 1;
    };
    while (offset < bytes.length && bytes[offset] !== 0x3b) {
      const tag = bytes[offset++];
      if (tag === 0x21) {
        const kind = bytes[offset++];
        if (kind === 0xf9) {
          expect(bytes[offset]).toBe(4);
          controls.push({ transparent: (bytes[offset + 1] & 1) !== 0, index: bytes[offset + 4] });
        }
        skipBlocks();
      } else if (tag === 0x2c) {
        const packed = bytes[offset + 8];
        offset += 9 + ((packed & 128) ? 3 * (1 << ((packed & 7) + 1)) : 0);
        offset += 1; // LZW minimum code size; skip image payload without decoding it.
        skipBlocks();
      } else {
        throw new Error('Unexpected test GIF block');
      }
    }
    expect(bytes[offset]).toBe(0x3b);
    return controls;
  };

  const literalGifRequest = (frameProvider: FrameProvider): GifExportRequest => ({
    kind: 'gif', filenameBase: 'Literal', scale: 1, frameProvider, gifencModule: realGifenc,
    options: {
      fps: 50, durationSeconds: 0.04, repeat: -1, autoFrames: false,
      frameStep: 1, ditherMethod: 'none', ditherStrength: 1, maxColors: 4, autoColors: true,
    },
  });

  it.each([true, false])('writes the real GIF transparency flag for transparent source %s', async (transparent) => {
    const rgba = new Uint8ClampedArray([
      0, 0, 0, transparent ? 0 : 255, 255, 0, 0, 255,
      0, 0, 255, 255, 255, 0, 0, 255,
    ]);
    const context = { getImageData: () => new ImageData(rgba.slice(), 2, 2) };
    const getContext = jest.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation((() => context) as unknown as HTMLCanvasElement['getContext']);
    const finish = jest.fn();
    const provider: FrameProvider = {
      getDimensions: () => ({ width: 2, height: 2 }), compositeToCanvas: jest.fn(),
      beginAnimationSession: () => ({ stepFrame: jest.fn(), advanceFrame: jest.fn(), finish }),
    };
    try {
      const result = await runExport(literalGifRequest(provider), jest.fn(), new AbortController().signal);
      if (result.kind !== 'gif') throw new Error('Expected actual GIF');
      const controls = readGraphicControls(await blobToBytes(result.blob));
      expect(controls).toHaveLength(2);
      expect(controls.map((control) => control.transparent)).toEqual([transparent, transparent]);
      if (transparent) expect(controls.map((control) => control.index)).toEqual([0, 0]);
      expect(finish).toHaveBeenCalledTimes(1);
    } finally {
      getContext.mockRestore();
    }
  });

  it('rejects an already aborted GIF without consuming pixels or producing encoder output', async () => {
    const controller = new AbortController();
    controller.abort();
    const encoder = realGifenc.GIFEncoder();
    const encoderFinish = jest.spyOn(encoder, 'finish');
    const encoderBytes = jest.spyOn(encoder, 'bytes');
    const sessionFinish = jest.fn();
    const beginAnimationSession = jest.fn(() => ({
      stepFrame: jest.fn(), advanceFrame: jest.fn(), finish: sessionFinish,
    }));
    const compositeToCanvas = jest.fn();
    const provider: FrameProvider = {
      getDimensions: () => ({ width: 2, height: 2 }), compositeToCanvas, beginAnimationSession,
    };
    const request = { ...literalGifRequest(provider), gifencModule: {
      ...realGifenc, GIFEncoder: jest.fn(() => encoder),
    } };
    await expect(runExport(request, jest.fn(), controller.signal))
      .rejects.toMatchObject({ name: 'AbortError', message: 'Export cancelled' });
    expect(compositeToCanvas).not.toHaveBeenCalled();
    expect(encoderFinish).not.toHaveBeenCalled();
    expect(encoderBytes).not.toHaveBeenCalled();
    expect(sessionFinish).toHaveBeenCalledTimes(beginAnimationSession.mock.calls.length);
  });

  it.each(['analyze', 'encode', 'final-encode'] as const)('rejects cancellation during %s without producing an export and restores the session', async (stage) => {
    const context = { getImageData: () => new ImageData(new Uint8ClampedArray([
      255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
    ]), 2, 2) };
    const getContext = jest.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation((() => context) as unknown as HTMLCanvasElement['getContext']);
    const controller = new AbortController();
    const progress: ExportProgress[] = [];
    let frame = 17;
    const finish = jest.fn(() => { frame = 17; });
    const provider: FrameProvider = {
      getDimensions: () => ({ width: 2, height: 2 }), compositeToCanvas: jest.fn(),
      beginAnimationSession: () => ({
        stepFrame: ({ frameIndex }) => { frame = frameIndex; }, advanceFrame: jest.fn(), finish,
      }),
    };
    const onProgress = (value: ExportProgress) => {
      progress.push(value);
      if ((stage === 'analyze' && value.phase === 'analyze')
        || (stage === 'encode' && value.phase === 'encode')
        || (stage === 'final-encode' && value.phase === 'encode' && value.percent === 100)) controller.abort();
    };
    try {
      await expect(runExport(literalGifRequest(provider), onProgress, controller.signal))
        .rejects.toMatchObject({ name: 'AbortError', message: 'Export cancelled' });
      expect(controller.signal.aborted).toBe(true);
      expect(progress.some((value) => value.phase === 'finalize')).toBe(false);
      expect(finish).toHaveBeenCalledTimes(1);
      expect(frame).toBe(17);
    } finally {
      getContext.mockRestore();
    }
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

  it('finishes a GIF animation session when frame rendering throws', async () => {
    const finish = jest.fn();
    const frameProvider: FrameProvider = {
      getDimensions: () => ({ width: 2, height: 2 }),
      compositeToCanvas: () => {
        throw new Error('render failed');
      },
      beginAnimationSession: () => ({
        stepFrame: jest.fn(),
        advanceFrame: jest.fn(),
        finish,
      }),
    };

    await expect(runExport({
      kind: 'gif',
      filenameBase: 'Failure',
      scale: 1,
      frameProvider,
      gifencModule: createDeterministicGifencModule(),
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
    }, jest.fn(), new AbortController().signal)).rejects.toThrow('render failed');

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
