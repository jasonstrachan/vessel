const mockPostMessage = jest.fn();

// Provide a lightweight DedicatedWorkerGlobalScope stub
(global as unknown as { self: any }).self = {
  postMessage: mockPostMessage,
};

// Import the worker module which registers onmessage on self
import '../gradientWorker';

describe('gradientWorker message contract', () => {
  beforeEach(() => {
    mockPostMessage.mockClear();
  });

  it('processes updateGradient messages and transfers the palette buffer', () => {
    const stops = [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ];

    (self as any).onmessage({ data: { type: 'updateGradient', data: { stops }, id: 1 } } as MessageEvent);

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const [message, transfer] = mockPostMessage.mock.calls[0];
    expect(message.type).toBe('success');
    expect(message.id).toBe(1);
    expect(message.result).toBeInstanceOf(Uint8ClampedArray);
    expect(transfer).toHaveLength(1);
    expect(transfer[0]).toBe(message.result.buffer);
    expect(message.result.length).toBe(256 * 4);
    expect(message.result[0]).toBe(0);
    expect(message.result[message.result.length - 1]).toBe(255);
  });

  it('applies palette colors to indexed buffer with clamping at bounds', () => {
    const palette = new Uint8ClampedArray([
      // 2-color palette (RGBA)
      10, 20, 30, 255,
      200, 210, 220, 255,
    ]);

    (self as any).onmessage({ data: { type: 'updateGradient', data: { palette }, id: 2 } } as MessageEvent);
    mockPostMessage.mockClear();

    const indexData = new Uint8Array([0, 1, 2, 255]);
    (self as any).onmessage({ data: { type: 'applyToBuffer', data: { indexData, offset: 0 }, id: 3 } } as MessageEvent);

    const [message] = mockPostMessage.mock.calls[0];
    expect(message.type).toBe('success');
    expect(message.id).toBe(3);
    const result = message.result as Uint8ClampedArray;
    expect(Array.from(result.slice(0, 4))).toEqual([0, 0, 0, 0]); // index 0 clears
    expect(Array.from(result.slice(4, 8))).toEqual([10, 20, 30, 255]); // index 1 maps first color
    // index 2 clamps to last palette entry
    expect(Array.from(result.slice(8, 12))).toEqual([200, 210, 220, 255]);
    // index 255 also clamps to last palette entry
    expect(Array.from(result.slice(12, 16))).toEqual([200, 210, 220, 255]);
  });

  it('shifts palette and returns an error on unknown message type', () => {
    (self as any).onmessage({ data: { type: 'shiftPalette', data: { offset: 0.25 }, id: 4 } } as MessageEvent);
    expect(mockPostMessage).toHaveBeenCalled();
    const shiftCall = mockPostMessage.mock.calls[0][0];
    expect(shiftCall.type).toBe('success');
    expect(shiftCall.result).toBeInstanceOf(Uint8ClampedArray);

    mockPostMessage.mockClear();
    (self as any).onmessage({ data: { type: 'noop', data: {}, id: 5 } } as MessageEvent);
    const errorCall = mockPostMessage.mock.calls[0][0];
    expect(errorCall.type).toBe('error');
    expect(errorCall.id).toBe(5);
  });
});
