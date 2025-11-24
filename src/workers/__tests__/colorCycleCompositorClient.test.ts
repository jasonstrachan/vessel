/* eslint-disable @typescript-eslint/no-explicit-any */
import { ColorCycleCompositorClient } from '../colorCycleCompositorClient';

class FakeWorker implements Worker {
  onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null = null;
  onmessageerror: ((this: Worker, ev: MessageEvent<any>) => any) | null = null;
  onerror: ((this: AbstractWorker, ev: ErrorEvent) => any) | null = null;
  private listeners: Record<'message' | 'error', Set<EventListener>> = {
    message: new Set(),
    error: new Set(),
  };

  postMessage = jest.fn((payload: any) => {
    if (payload.type === 'ping') {
      this.emit('message', { data: { type: 'pong', requestId: payload.requestId } } as any);
    }
  });
  terminate = jest.fn();
  addEventListener = (type: 'message' | 'error', listener: EventListener) => {
    this.listeners[type].add(listener);
  };
  removeEventListener = (type: 'message' | 'error', listener: EventListener) => {
    this.listeners[type].delete(listener);
  };
  dispatchEvent = () => true;

  emit(type: 'message' | 'error', event: any) {
    this.listeners[type].forEach((l) => l(event));
  }
}

describe('ColorCycleCompositorClient', () => {
  it('pings and receives frame callbacks', async () => {
    const worker = new FakeWorker();
    const client = new ColorCycleCompositorClient(worker as unknown as Worker);

    await expect(client.ping()).resolves.toBeUndefined();

    const listener = jest.fn();
    const unsubscribe = client.onFrame(listener);
    worker.emit('message', { data: { type: 'frame', layers: [{ id: 'L1' }] } } as any);
    expect(listener).toHaveBeenCalledWith([{ id: 'L1' }]);
    unsubscribe();
    client.dispose();
  });

  it('rejects pending requests on worker error', async () => {
    const worker = new FakeWorker();
    const client = new ColorCycleCompositorClient(worker as unknown as Worker);
    const promise = client.requestFrame();
    worker.emit('error', { message: 'boom', error: new Error('boom') } as any);
    await expect(promise).rejects.toThrow('boom');
    client.dispose();
  });
});
