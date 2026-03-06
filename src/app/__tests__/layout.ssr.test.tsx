
class MockMessagePort implements MessagePort {
  onmessage: ((this: MessagePort, ev: MessageEvent<unknown>) => unknown) | null = null;
  onmessageerror: ((this: MessagePort, ev: MessageEvent<unknown>) => unknown) | null = null;

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    void type;
    void listener;
    void options;
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void {
    void type;
    void listener;
    void options;
  }

  dispatchEvent(event: Event): boolean {
    void event;
    return true;
  }

  start(): void {}
  close(): void {}
  postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
    void message;
    void transfer;
  }
}

class MockMessageChannel implements MessageChannel {
  port1 = new MockMessagePort();
  port2 = new MockMessagePort();
}

(globalThis as typeof globalThis & { MessageChannel?: typeof MessageChannel }).MessageChannel = MockMessageChannel;

import { renderToString } from 'react-dom/server';
import RootLayout from '../layout';

jest.mock('../globals.css', () => ({}));

jest.mock('next/font/google', () => ({
  IBM_Plex_Mono: jest.fn(() => ({
    variable: '--font-ibm-plex-mono',
  })),
}));

jest.mock('next/script', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

describe('RootLayout SSR', () => {
  it('wraps children with html/body scaffolding', () => {
    const html = renderToString(
      <RootLayout>
        <div id="app-root">hello</div>
      </RootLayout>
    );

    expect(html).toContain('<html');
    expect(html).toContain('<body');
    expect(html).toContain('app-root');
  });
});
