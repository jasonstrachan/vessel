/* eslint-disable @typescript-eslint/no-explicit-any */
describe('colorCycleCompositor.worker', () => {
  it('responds to ping and rejects unsupported commands', async () => {
    const messages: any[] = [];

    // Minimal worker-like global
    const listeners: Array<(event: MessageEvent<any>) => void> = [];
    (globalThis as any).self = {
      addEventListener: (_type: string, handler: (event: MessageEvent<any>) => void) => {
        listeners.push(handler);
      },
      postMessage: (payload: any) => messages.push(payload),
    } as any;

    // Import after stubbing self so the listener registers
    await import('../colorCycleCompositor.worker.js');

    // Dispatch a ping
    listeners.forEach((handler) => handler({ data: { type: 'ping', requestId: 1 } } as any));

    // Dispatch versioned layer input
    listeners.forEach((handler) => handler({
      data: {
        type: 'ensure-layer',
        layerId: 'layer-cc',
        width: 4,
        height: 3,
        documentVersion: 12,
        requestId: 3,
      },
    } as any));

    // Dispatch unsupported
    listeners.forEach((handler) => handler({ data: { type: 'unknown', requestId: 2 } } as any));

    expect(messages).toEqual([
      { type: 'pong', requestId: 1 },
      { type: 'ack', requestId: 3, command: 'ensure-layer' },
      { type: 'error', requestId: 2, message: 'Unsupported color cycle compositor command: unknown' },
    ]);
  });
});
