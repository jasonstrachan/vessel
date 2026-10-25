import { renderVesselWebGL as renderLegacy } from '../public/goblet/goblet';
import { renderVesselWebGL as renderCurrent } from '../public/goblet2/goblet2';

const runtimes = [ ['legacy', renderLegacy], ['current', renderCurrent] ] as const;

describe.each(runtimes)('%s Recolor actual public runtime', (_name, render) => {
  it('initializes literal nonuniform RGB332 material at the captured fractional tick', async () => {
    const raf = jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const canvas = document.createElement('canvas');
    const blits: number[][] = [];
    const prototype: CanvasRenderingContext2D = Object.getPrototypeOf(canvas.getContext('2d'));
    const originalPut = prototype.putImageData;
    const put = jest.spyOn(prototype, 'putImageData').mockImplementation(function (this: CanvasRenderingContext2D, image: ImageData, x: number, y: number) {
      if (image.width === 4 && image.height === 1) blits.push(Array.from(image.data));
      return Reflect.apply(originalPut, this, [image, x, y]);
    });
    const metadata = {
      format: 'vessel-goblet', project: { width: 4, height: 1 },
      viewport: { width: 4, height: 1, designWidth: 4, designHeight: 1, mode: 'fixed' },
      layers: [{ id: 'recolor', visible: true, opacity: 1, blendMode: 'source-over',
        colorCycle: { mode: 'recolor', isAnimating: true, recolorSettings: {
          width: 4, height: 1, indexBuffer: [43, 236, 89, 167],
          cycleColors: 16, mappingMode: 'continuous', flowMapping: 'palette',
          gradient: [{ position: 0, color: '#ff0000' }, { position: 1, color: '#0000ff' }],
          animation: { currentTick: 4, speed: 0.75, isPlaying: true, flowDirection: 'reverse' },
        } },
      }],
    };
    try {
      await render(metadata, canvas);
      // Independent phase at tick4: wrap(index/255 - 1/4).
      const expected = [43, 236, 89, 167].flatMap((code) => {
        const position = ((code / 255 - 0.25) % 1 + 1) % 1;
        return [Math.round(255 * (1 - position)), 0, Math.round(255 * position), 255];
      });
      expect(blits.length).toBeGreaterThan(0);
      expect(blits[0]).toEqual(expected);
    } finally { raf.mockRestore(); put.mockRestore(); }
  });
});

const flows = ['forward', 'reverse', 'pingpong', 'bounce'] as const;
const mappings = ['continuous', 'banded'] as const;

describe.each(runtimes)('%s Recolor playback matrix', (_name, render) => {
  it.each(flows.flatMap((flow) => mappings.flatMap((mapping) => (['palette', 'directional', 'luminance'] as const).flatMap((sourceMap) => [false, true].map((lookup) => [flow, mapping, sourceMap, lookup] as const)))))(
    '%s %s %s lookup=%s preserves alpha and elapsed material',
    async (flow, mapping, sourceMap, lookup) => {
      const indices = [0, 43, 236, 89, 167, 255, 16, 128];
      const phaseMap = [255, 167, 89, 236, 43, 0, 128, 16];
      const indexPhaseMap = lookup ? Array.from({ length: 256 }, (_, i) => 255 - i) : undefined;
      const alphas = [255, 128, 0, 255, 128, 255, 255, 128];
      const source = document.createElement('canvas'); source.width = 8; source.height = 1;
      source.getContext('2d')!.putImageData(new ImageData(Uint8ClampedArray.from(
        alphas.flatMap((alpha) => [50, 60, 70, alpha]),
      ), 8, 1), 0, 0);
      const image = jest.spyOn(window, 'Image').mockImplementation(() => {
        const asset = document.createElement('canvas'); asset.width = 8; asset.height = 1;
        asset.getContext('2d')!.putImageData(source.getContext('2d')!.getImageData(0, 0, 8, 1), 0, 0);
        Object.defineProperty(asset, 'src', { set: () => queueMicrotask(() => asset.onload?.(new Event('load'))) });
        return asset as unknown as HTMLImageElement;
      });
      const rasterDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__');
      Object.defineProperty(globalThis, '__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__', { configurable: true, value: true });
      const callbacks: FrameRequestCallback[] = [];
      const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callbacks.push(callback); return callbacks.length; });
      const clock = jest.spyOn(performance, 'now').mockReturnValue(1000);
      const canvas = document.createElement('canvas');
      const prototype: CanvasRenderingContext2D = Object.getPrototypeOf(canvas.getContext('2d'));
      const blits: number[][] = [];
      const original = prototype.putImageData;
      const put = jest.spyOn(prototype, 'putImageData').mockImplementation(function (this: CanvasRenderingContext2D, data: ImageData, x: number, y: number) {
        if (data.width === 8 && data.height === 1 && data.data[1] === 0) blits.push(Array.from(data.data));
        return Reflect.apply(original, this, [data, x, y]);
      });
      const expected = (tick: number) => indices.flatMap((code, i) => {
        const input = sourceMap === 'palette' ? code : phaseMap[i];
        const mapped = lookup ? (255 - input) / 255 : input / 255;
        const base = mapping === 'continuous' ? mapped
          : lookup ? Math.min(15, Math.floor(mapped * 16)) / 16 : input % 16 / 16;
        const raw = base + (flow === 'reverse' ? -1 : 1) * tick / 16;
        const cycle = ((raw % 2) + 2) % 2;
        const position = Math.min(0.999999, flow === 'pingpong' || flow === 'bounce'
          ? (cycle <= 1 ? cycle : 2 - cycle) : ((raw % 1) + 1) % 1);
        const gradientAlpha = Math.round(128 + 127 * position);
        return [Math.round(255 * (1 - position)), 0, Math.round(255 * position), Math.round(alphas[i] * gradientAlpha / 255)];
      });
      try {
        await render({
          format: 'vessel-goblet', project: { width: 8, height: 1 },
          viewport: { width: 8, height: 1, mode: 'fixed' },
          layers: [{ id: 'alpha-recolor', visible: true, opacity: 1, assets: { texture: 'fixture-source' },
            source: { width: 8, height: 1 }, colorCycle: { mode: 'recolor', isAnimating: true,
              recolorSettings: { width: 8, height: 1, indexBuffer: indices, cycleColors: 16,
                mappingMode: mapping, flowMapping: sourceMap, indexPhaseMap,
                phaseMap: sourceMap === 'palette' ? undefined : phaseMap,
                gradient: [{ position: 0, color: '#ff0000', opacity: 0.5 }, { position: 1, color: '#0000ff', opacity: 1 }],
                animation: { flowDirection: flow, currentTick: 4, speed: 0.75, isPlaying: true },
              } },
          }],
        }, canvas);
        expect(blits[0]).toEqual(expected(4));
        const frame = callbacks.shift(); expect(frame).toBeDefined();
        frame!(1000);
        const nextFrame = callbacks.shift(); expect(nextFrame).toBeDefined();
        nextFrame!(1500);
        expect(blits.at(-1)).toEqual(expected(10));
      } finally {
        put.mockRestore(); image.mockRestore(); raf.mockRestore(); clock.mockRestore();
        if (rasterDescriptor) Object.defineProperty(globalThis, '__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__', rasterDescriptor);
        else Reflect.deleteProperty(globalThis, '__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__');
      }
    },
  );
});

describe.each(runtimes)('%s scaled Recolor lookup', (_name, render) => {
  it('downsamples pixel planes while retaining the entire 256-entry palette map', async () => {
    const prior = localStorage.getItem('vesselGobletHalfRes');
    localStorage.setItem('vesselGobletHalfRes', 'true');
    const raf = jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const canvas = document.createElement('canvas');
    const prototype: CanvasRenderingContext2D = Object.getPrototypeOf(canvas.getContext('2d'));
    const original = prototype.putImageData;
    const blits: number[][] = [];
    const put = jest.spyOn(prototype, 'putImageData').mockImplementation(function (this: CanvasRenderingContext2D, data: ImageData, x: number, y: number) {
      if (data.width === 4 && data.height === 1) blits.push(Array.from(data.data));
      return Reflect.apply(original, this, [data, x, y]);
    });
    try {
      await render({ format: 'vessel-goblet', project: { width: 8, height: 2 },
        viewport: { width: 8, height: 2, mode: 'fixed' },
        layers: [{ id: 'scaled', visible: true, opacity: 1, source: { width: 8, height: 2 },
          colorCycle: { mode: 'recolor', recolorSettings: {
            width: 8, height: 2, indexBuffer: [43, 0, 236, 0, 89, 0, 167, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            indexPhaseMap: Array.from({ length: 256 }, (_, i) => 255 - i),
            cycleColors: 16, mappingMode: 'continuous', flowMapping: 'palette',
            gradient: [{ position: 0, color: '#ff0000' }, { position: 1, color: '#0000ff' }],
            animation: { currentTick: 0, speed: 0, isPlaying: false, flowDirection: 'forward' },
          } },
        }],
      }, canvas);
      expect(blits[0]).toEqual([43, 0, 212, 255, 236, 0, 19, 255, 89, 0, 166, 255, 167, 0, 88, 255]);
    } finally {
      put.mockRestore(); raf.mockRestore();
      if (prior === null) localStorage.removeItem('vesselGobletHalfRes');
      else localStorage.setItem('vesselGobletHalfRes', prior);
    }
  });
});
