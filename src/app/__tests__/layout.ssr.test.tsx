const { TextEncoder, TextDecoder } = require('util');
(global as unknown as { TextEncoder?: typeof TextEncoder; TextDecoder?: typeof TextDecoder }).TextEncoder = TextEncoder;
(global as unknown as { TextEncoder?: typeof TextEncoder; TextDecoder?: typeof TextDecoder }).TextDecoder = TextDecoder;

class MockPort {
  addEventListener() {}
  start() {}
  close() {}
  postMessage() {}
}

(global as unknown as { MessageChannel?: typeof MessageChannel }).MessageChannel = class {
  port1 = new MockPort();
  port2 = new MockPort();
};

import { renderToString } from 'react-dom/server';
import RootLayout from '../layout';

jest.mock('../globals.css', () => ({}));

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
