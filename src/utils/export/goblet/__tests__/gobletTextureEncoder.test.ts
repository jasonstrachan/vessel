import { canvasToDataURL } from '@/utils/export/goblet/gobletTextureEncoder';

// Browsers silently return a PNG-typed blob from toBlob when they cannot encode
// the requested format (AVIF encode is unsupported in current Chrome/Safari).
// These tests pin the negotiation loop so that silent fallback advances to the
// next format instead of ending negotiation with PNG on the first attempt.

type ToBlobImpl = (type: string | undefined, quality: number | undefined) => Blob | null;

const BLOB_BYTES = new Uint8Array([1, 2, 3, 4]);

const makeCanvas = (impl: ToBlobImpl): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  canvas.toBlob = ((callback: BlobCallback, type?: string, quality?: number) => {
    callback(impl(type, quality));
  }) as typeof canvas.toBlob;
  return canvas;
};

const blobOf = (type: string): Blob => new Blob([BLOB_BYTES], { type });

describe('canvasToDataURL format negotiation', () => {
  it('advances to WebP when the AVIF request silently returns a PNG blob (Chrome-like)', async () => {
    const requested: Array<string | undefined> = [];
    const canvas = makeCanvas((type) => {
      requested.push(type);
      if (type === 'image/webp') {
        return blobOf('image/webp');
      }
      return blobOf('image/png');
    });

    const result = await canvasToDataURL(canvas);

    expect(result.format).toBe('image/webp');
    expect(result.dataUrl.startsWith('data:image/webp;base64,')).toBe(true);
    expect(requested).toEqual(['image/avif', 'image/webp']);
  });

  it('lands on PNG when neither AVIF nor WebP is encodable (Safari-like)', async () => {
    const requested: Array<string | undefined> = [];
    const canvas = makeCanvas((type) => {
      requested.push(type);
      return blobOf('image/png');
    });

    const result = await canvasToDataURL(canvas);

    expect(result.format).toBe('image/png');
    expect(result.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(requested).toEqual(['image/avif', 'image/webp', 'image/png']);
  });

  it('uses AVIF when the browser genuinely encodes it', async () => {
    const canvas = makeCanvas((type) => blobOf(type ?? 'image/png'));

    const result = await canvasToDataURL(canvas);

    expect(result.format).toBe('image/avif');
    expect(result.dataUrl.startsWith('data:image/avif;base64,')).toBe(true);
  });

  it('treats an untyped blob as unsupported and keeps negotiating', async () => {
    const canvas = makeCanvas((type) => (type === 'image/webp' ? blobOf('image/webp') : blobOf('')));

    const result = await canvasToDataURL(canvas);

    expect(result.format).toBe('image/webp');
  });

  it('encodes TXT Shape layers directly as WebP at quality 0.85', async () => {
    const requested: Array<{ type: string | undefined; quality: number | undefined }> = [];
    const canvas = makeCanvas((type, quality) => {
      requested.push({ type, quality });
      return blobOf(type ?? 'image/png');
    });

    const result = await canvasToDataURL(canvas, 'txt-shape');

    expect(result.format).toBe('image/webp');
    expect(result.dataUrl.startsWith('data:image/webp;base64,')).toBe(true);
    expect(requested).toEqual([{ type: 'image/webp', quality: 0.85 }]);
  });
});
