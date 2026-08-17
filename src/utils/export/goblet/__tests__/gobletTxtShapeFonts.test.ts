import {
  inlineTxtShapeFontsInGobletTemplate,
} from '@/utils/export/goblet/gobletTxtShapeFonts';
import type { TxtShape } from '@/types';

const shape: TxtShape = {
  id: 'txt-font',
  layerId: 'layer-font',
  x: 0,
  y: 0,
  width: 100,
  height: 40,
  content: 'PIXEL',
  fontFamily: 'departure-mono',
  fontSize: 11,
  lineHeight: 1.2,
  textAlign: 'left',
  colorSource: 'manual',
  color: '#000000',
  selectionColor: '#ffffff',
  selectionBackgroundColor: '#000000',
  selections: [{ start: 0, end: 5 }],
  createdAt: 1,
  updatedAt: 1,
};

describe('Goblet TXT Shape fonts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(globalThis, 'fetch');
  });

  it('embeds every used custom face so downloaded Goblets remain portable', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
    });

    const html = await inlineTxtShapeFontsInGobletTemplate({
      template: "@font-face{src:url('../assets/fonts/DEPARTURE-MONO-REGULAR.WOFF2')}",
      shapes: [shape],
      assetPrefix: '/vessel',
      gobletAssetRoot: 'goblet2',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost/vessel/assets/fonts/DEPARTURE-MONO-REGULAR.WOFF2',
      { cache: 'no-store', signal: undefined },
    );
    expect(html).toContain('data:font/woff2;base64,AQID');
    expect(html).not.toContain('../assets/fonts/DEPARTURE-MONO-REGULAR.WOFF2');
  });

  it('does not fetch unused bundled faces', async () => {
    const fetchMock = jest.fn();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
    });
    const html = await inlineTxtShapeFontsInGobletTemplate({
      template: '<style></style>',
      shapes: [{ ...shape, fontFamily: 'monospace' }],
      gobletAssetRoot: 'goblet',
    });

    expect(html).toBe('<style></style>');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
