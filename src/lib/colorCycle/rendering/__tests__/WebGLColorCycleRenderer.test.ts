import { packDefMetaDataForUpload } from '../WebGLColorCycleRenderer';

describe('packDefMetaDataForUpload', () => {
  it('packs only the dirty rect for partial uploads', () => {
    const width = 4;
    const height = 3;
    const defIds = new Uint16Array(width * height);
    const phases = new Uint8Array(width * height);

    for (let i = 0; i < defIds.length; i += 1) {
      defIds[i] = 0x100 + i;
      phases[i] = i + 1;
    }

    const upload = packDefMetaDataForUpload(width, height, defIds, phases, {
      x: 1,
      y: 1,
      width: 2,
      height: 2,
    });

    expect(upload.isFullCanvasLayout).toBe(false);
    expect(upload.data).toHaveLength(2 * 2 * 4);
    expect([...upload.data]).toEqual([
      0x05, 0x01, 6, 255,
      0x06, 0x01, 7, 255,
      0x09, 0x01, 10, 255,
      0x0a, 0x01, 11, 255,
    ]);
  });

  it('keeps full-canvas layout for full uploads', () => {
    const width = 2;
    const height = 1;
    const upload = packDefMetaDataForUpload(
      width,
      height,
      new Uint16Array([0x1234, 0]),
      new Uint8Array([9, 10]),
      { x: 0, y: 0, width, height }
    );

    expect(upload.isFullCanvasLayout).toBe(true);
    expect([...upload.data]).toEqual([
      0x34, 0x12, 9, 255,
      0, 0, 10, 255,
    ]);
  });
});
