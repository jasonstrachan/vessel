jest.mock('@/hooks/brushEngine/dithering', () => ({
  applyDitheringWithFillResolution: jest.fn((img: ImageData) => img),
}));

jest.mock('@/utils/colorCycle/concentricFillCore', () => ({
  fillConcentricToBuffer: jest.fn(async () => new Uint8Array([1, 2, 3]).buffer),
}));

describe('colorCycleFill.worker', () => {
  it('handles perceptual dither job', () => {
    const messages: any[] = [];
    const listeners: Array<(e: MessageEvent<any>) => void> = [];

    (globalThis as any).self = {
      onmessage: null,
      postMessage: (payload: any) => messages.push(payload),
    };

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../colorCycleFill.worker');

    const handler = (globalThis as any).self.onmessage as (e: MessageEvent<any>) => void;

    handler({
      data: {
        id: 1,
        job: {
          type: 'perceptual-dither',
          pixels: new Uint8ClampedArray([0, 0, 0, 255]),
          width: 1,
          height: 1,
          quantLevels: 2,
          ditherPixelSize: 1,
          paletteCss: ['#000', '#fff'],
          paletteMapEntries: [{ rgb: [0, 0, 0], index: 1 }],
          baseOffset: 0,
        },
      },
    } as any);

    expect(messages[0]).toMatchObject({ ok: true, type: 'perceptual-dither' });
    expect(messages[0].result).toBeDefined();
  });

  it('handles concentric fill job (async)', async () => {
    const messages: any[] = [];
    (globalThis as any).self = {
      onmessage: null,
      postMessage: (payload: any) => messages.push(payload),
    };

    // Re-require to bind new self
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../colorCycleFill.worker');
    const handler = (globalThis as any).self.onmessage as (e: MessageEvent<any>) => void;

    await handler({
      data: {
        id: 2,
        job: {
          type: 'concentric-fill',
          vertices: new Float32Array([0, 0, 1, 0, 1, 1]),
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          bands: [],
          baseOffset: 0,
          maxDist: 1,
          ditherEnabled: false,
          ditherStrength: 0,
          ditherPixelSize: 1,
          noiseSeed: 1,
        },
      },
    } as any);

    await new Promise((r) => setTimeout(r, 0));
    expect(messages[0]).toMatchObject({ ok: true, type: 'concentric-fill' });
  });
});
