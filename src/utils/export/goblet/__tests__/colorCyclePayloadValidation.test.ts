import { validateGobletColorCyclePayload } from '@/utils/export/goblet/colorCyclePayloadValidation';
import { packArrayToB64Z } from '@/utils/export/b64z';
import type { WebGLSerializedColorCycle } from '@/utils/export/goblet/gobletTypes';

const createBrushPayload = (overrides: Partial<WebGLSerializedColorCycle['brushState']> = {}): WebGLSerializedColorCycle => ({
  mode: 'brush',
  isAnimating: true,
  speedMin: 0.1,
  speedMax: 1,
  brushState: {
    width: 2,
    height: 2,
    indexBuffer: [1, 2, 3, 4],
    gradientIdBuffer: [0, 0, 0, 0],
    gradientDefIdBuffer: [1, 1, 1, 1],
    speedBuffer: [128, 128, 128, 128],
    flowBuffer: [1, 1, 1, 1],
    phaseBuffer: [0, 64, 128, 192],
    gradientStops: [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ],
    animationOffset: 0,
    ...overrides,
  },
  slotPalettes: [{
    slot: 0,
    stops: [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ],
  }],
});

const filledBytes = (length: number, value: number): number[] => Array.from(new Uint8Array(length).fill(value));

describe('validateGobletColorCyclePayload', () => {
  it('accepts a complete animated brush payload and returns pixel stats', () => {
    const result = validateGobletColorCyclePayload(createBrushPayload(), {
      layerId: 'cc-layer',
      hasContent: true,
    });

    expect(result.ok).toBe(true);
    expect(result.stats).toMatchObject({
      payloadPixels: 4,
      nonZeroPaint: 4,
      usedSlots: 1,
      paletteSlots: 1,
    });
  });

  it('rejects mismatched buffer dimensions', () => {
    const result = validateGobletColorCyclePayload(createBrushPayload({
      speedBuffer: [128, 128],
    }), {
      layerId: 'cc-layer',
      hasContent: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('buffer-length-mismatch');
  });

  it.each([
    'indexBuffer',
    'gradientIdBuffer',
    'gradientDefIdBuffer',
    'speedBuffer',
    'flowBuffer',
    'phaseBuffer',
  ] as const)('rejects missing required animated brush buffer %s', (bufferName) => {
    const payload = createBrushPayload({
      [bufferName]: undefined,
    });

    const result = validateGobletColorCyclePayload(payload, {
      layerId: 'cc-layer',
      hasContent: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing-required-buffer');
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'missing-required-buffer',
        message: expect.stringContaining(bufferName),
      }),
    ]));
  });

  it('rejects empty required animated brush buffers', () => {
    const result = validateGobletColorCyclePayload(createBrushPayload({
      speedBuffer: [],
    }), {
      layerId: 'cc-layer',
      hasContent: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing-required-buffer');
  });

  it('accepts missing speed buffer when slot-speed metadata is present', () => {
    const payload = createBrushPayload({
      speedBuffer: undefined,
    });
    payload.speedMode = 'slot';
    payload.slotSpeeds = [{ slot: 0, speed: 1.25 }];

    const result = validateGobletColorCyclePayload(payload, {
      layerId: 'cc-layer',
      hasContent: true,
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics.find((diagnostic) => diagnostic.code === 'missing-required-buffer')).toBeUndefined();
  });

  it('rejects empty paint for a layer marked as content-bearing', () => {
    const result = validateGobletColorCyclePayload(createBrushPayload({
      indexBuffer: [0, 0, 0, 0],
    }), {
      layerId: 'cc-layer',
      hasContent: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('empty-paint-with-content');
  });

  it('rejects empty packed paint for a layer marked as content-bearing', async () => {
    const width = 32;
    const height = 32;
    const pixels = width * height;
    const packedPaint = await packArrayToB64Z(new Uint8Array(pixels).fill(0), 32);
    expect(packedPaint).not.toBeNull();

    const result = validateGobletColorCyclePayload(createBrushPayload({
      width,
      height,
      indexBuffer: packedPaint ?? '',
      gradientIdBuffer: filledBytes(pixels, 0),
      gradientDefIdBuffer: filledBytes(pixels, 1),
      speedBuffer: filledBytes(pixels, 128),
      flowBuffer: filledBytes(pixels, 1),
      phaseBuffer: filledBytes(pixels, 0),
    }), {
      layerId: 'cc-layer',
      hasContent: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('empty-paint-with-content');
  });

  it('rejects mismatched packed buffer dimensions', async () => {
    const width = 32;
    const height = 32;
    const pixels = width * height;
    const packedSpeed = await packArrayToB64Z(new Uint8Array(pixels - 1).fill(128), 32);
    expect(packedSpeed).not.toBeNull();

    const result = validateGobletColorCyclePayload(createBrushPayload({
      width,
      height,
      indexBuffer: filledBytes(pixels, 1),
      gradientIdBuffer: filledBytes(pixels, 0),
      gradientDefIdBuffer: filledBytes(pixels, 1),
      speedBuffer: packedSpeed ?? '',
      flowBuffer: filledBytes(pixels, 1),
      phaseBuffer: filledBytes(pixels, 0),
    }), {
      layerId: 'cc-layer',
      hasContent: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('buffer-length-mismatch');
  });

  it('rejects invalid packed buffer payloads', () => {
    const result = validateGobletColorCyclePayload(createBrushPayload({
      indexBuffer: 'b64z:not-valid',
    }), {
      layerId: 'cc-layer',
      hasContent: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid-packed-buffer');
  });

  it('validates 8-bit gradient slots without truncating them to 6 bits', () => {
    const payload = createBrushPayload({
      gradientIdBuffer: [79, 79, 79, 79],
    });
    payload.slotPalettes = [{
      slot: 79,
      stops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
    }];

    const result = validateGobletColorCyclePayload(payload, {
      layerId: 'cc-layer',
      hasContent: true,
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics.find((diagnostic) => diagnostic.code === 'missing-slot-palette')).toBeUndefined();
  });

  it('accepts packed uint16 gradient definition ids', async () => {
    const width = 32;
    const height = 32;
    const pixels = width * height;
    const defIdBytes = new Uint8Array(Uint16Array.from({ length: pixels }, () => 241).buffer);
    const packedDefIds = await packArrayToB64Z(defIdBytes, 32);
    expect(packedDefIds).not.toBeNull();

    const result = validateGobletColorCyclePayload(createBrushPayload({
      width,
      height,
      indexBuffer: filledBytes(pixels, 1),
      gradientIdBuffer: filledBytes(pixels, 0),
      gradientDefIdBuffer: packedDefIds ?? '',
      speedBuffer: filledBytes(pixels, 128),
      flowBuffer: filledBytes(pixels, 1),
      phaseBuffer: filledBytes(pixels, 0),
    }), {
      layerId: 'cc-layer',
      hasContent: true,
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics.find((diagnostic) => diagnostic.code === 'buffer-length-mismatch')).toBeUndefined();
  });

  it('rejects mask dimension mismatches', () => {
    const result = validateGobletColorCyclePayload({
      ...createBrushPayload(),
      alphaMask: {
        width: 1,
        height: 4,
        data: [255, 255, 255, 255],
      },
    }, {
      layerId: 'cc-layer',
      hasContent: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('alpha-mask-size-mismatch');
  });
});
