import { normalizeGobletFlowBuffer } from '../gobletPlaybackMath';
import { Renderer2D } from '../Renderer2D';
import { decodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';

const palette = Uint32Array.from({ length: 256 }, (_, i) => (0xff000000 | i) >>> 0);

describe('legacy distance-band playback', () => {
  it('uses one fixed palette shift for every ink, independent of old source positions', () => {
    const renderer = new Renderer2D({ width: 5, height: 1 });
    const bands = new Uint8Array([0, 64, 127, 128, 255]);
    const speed = decodeColorCycleSpeedByte(17);
    for (const oldSource of [1, 65, 128, 255]) {
      for (let step = 0; step <= 256; step++) {
        renderer.render({
          indexData: new Uint8Array(5).fill(oldSource),
          gradientIdData: new Uint8Array(5),
          flowData: new Uint8Array(5).fill(4),
          phaseData: bands,
          speedData: new Uint8Array(5).fill(17),
          paletteSlots: [palette], basePalette: palette,
          phase: 0, baseOffset: 0, baseTime: step / 256 / speed, flowMode: 'forward',
        });
        const pixels = new Uint32Array(renderer.getImageData().data.buffer);
        for (let i = 0; i < bands.length; i++) {
          expect(pixels[i]).toBe(palette[(bands[i] - step + 256) % 256]);
        }
      }
    }
    renderer.cleanup();
  });

  it('keeps the legacy distance channel through export normalization', () => {
    expect([...normalizeGobletFlowBuffer(new Uint8Array([1, 4, 5, 3]), null, 4)]).toEqual([1, 4, 5, 3]);
  });
});
