import type { CustomBrush } from '@/types';
import {
  clearStoredCustomBrushes,
  loadCustomBrushesFromStorage,
  saveCustomBrushesToStorage,
} from '@/utils/customBrushPersistence';

const STORAGE_KEY = 'vessel-custom-brushes';

const createImageData = (width: number, height: number): ImageData => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 200;
    data[i + 1] = 100;
    data[i + 2] = 50;
    data[i + 3] = 255;
  }
  return new ImageData(data, width, height);
};

describe('customBrushPersistence', () => {
  const OriginalImage = global.Image;

  beforeEach(() => {
    class MockImage {
      onload: (() => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      set src(_value: string) {
        setTimeout(() => {
          this.onload?.();
        }, 0);
      }
    }

    // jsdom Image does not reliably resolve data URLs in unit tests.
    (global as typeof global & { Image: typeof Image }).Image = MockImage as unknown as typeof Image;
    clearStoredCustomBrushes();
  });

  afterEach(() => {
    (global as typeof global & { Image: typeof Image }).Image = OriginalImage;
    clearStoredCustomBrushes();
  });

  it('round-trips custom brush color-cycle metadata through local storage', async () => {
    const brush: CustomBrush = {
      id: 'cc-brush-1',
      name: 'CC Brush',
      imageData: createImageData(2, 2),
      thumbnail: '',
      width: 2,
      height: 2,
      createdAt: 123,
      naturalWidth: 2,
      naturalHeight: 2,
      maxDimension: 2,
      colorCycle: {
        schemaVersion: 1,
        source: 'color-cycle-layer',
        gradient: [
          { position: 0, color: '#112233' },
          { position: 1, color: '#445566' },
        ],
        speed: 1.75,
        phaseMode: 'jittered',
        phaseJitter: 0.4,
      },
    };

    saveCustomBrushesToStorage([brush], brush.id);
    const loaded = await loadCustomBrushesFromStorage();

    expect(loaded).not.toBeNull();
    expect(loaded?.defaultCustomBrushId).toBe(brush.id);
    expect(loaded?.brushes).toHaveLength(1);
    expect(loaded?.brushes[0].colorCycle).toEqual({
      schemaVersion: 1,
      source: 'color-cycle-layer',
      gradient: [
        { position: 0, color: '#112233' },
        { position: 1, color: '#445566' },
      ],
      speed: 1.75,
      phaseMode: 'jittered',
      phaseJitter: 0.4,
    });
  });

  it('sanitizes invalid persisted color-cycle metadata values on load', async () => {
    const payload = {
      version: 1,
      defaultCustomBrushId: null,
      brushes: [
        {
          id: 'cc-brush-2',
          name: 'Broken Brush',
          width: 1,
          height: 1,
          thumbnail: '',
          createdAt: 1,
          imageDataUrl: 'data:image/png;base64,AAAA',
          colorCycle: {
            schemaVersion: 1,
            source: 'bad-source',
            gradient: [
              { position: -1, color: '#abcabc' },
              { position: 5, color: '#defdef' },
            ],
            speed: 'bad',
            phaseMode: 'bad-mode',
            phaseJitter: 7,
          },
        },
      ],
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    const loaded = await loadCustomBrushesFromStorage();

    expect(loaded?.brushes[0].colorCycle).toEqual({
      schemaVersion: 1,
      source: 'unknown',
      gradient: [
        { position: 0, color: '#abcabc' },
        { position: 1, color: '#defdef' },
      ],
      speed: undefined,
      phaseMode: undefined,
      phaseJitter: 1,
    });
  });

  it('round-trips schema v2 captured-data payload through local storage', async () => {
    const brush: CustomBrush = {
      id: 'cc-brush-v2',
      name: 'CC Brush V2',
      imageData: createImageData(2, 2),
      thumbnail: '',
      width: 2,
      height: 2,
      createdAt: 456,
      naturalWidth: 2,
      naturalHeight: 2,
      maxDimension: 2,
      colorCycle: {
        schemaVersion: 2,
        mode: 'captured-data',
        source: 'color-cycle-layer',
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        speed: 0.25,
        phaseMode: 'global',
        phaseJitter: 0,
        sourceCycleLength: 256,
        mapWidth: 2,
        mapHeight: 2,
        phaseMap: new Uint16Array([0, 64, 128, 255]),
        indexMap: new Uint16Array([1, 2, 3, 4]),
        alphaMask: new Uint8Array([255, 200, 128, 0]),
        useAlphaMask: true,
      },
    };

    saveCustomBrushesToStorage([brush], brush.id);
    const loaded = await loadCustomBrushesFromStorage();

    expect(loaded?.brushes[0].colorCycle?.schemaVersion).toBe(2);
    const cc = loaded?.brushes[0].colorCycle;
    if (!cc || cc.schemaVersion !== 2) {
      throw new Error('Expected schema v2 color cycle payload');
    }
    expect(cc.mode).toBe('captured-data');
    expect(Array.from(cc.phaseMap ?? [])).toEqual([0, 64, 128, 255]);
    expect(Array.from(cc.indexMap ?? [])).toEqual([1, 2, 3, 4]);
    expect(Array.from(cc.alphaMask ?? [])).toEqual([255, 200, 128, 0]);
  });

  it('falls back malformed schema v2 payloads to tip mode', async () => {
    const payload = {
      version: 1,
      defaultCustomBrushId: null,
      brushes: [
        {
          id: 'cc-brush-v2-bad',
          name: 'Broken Brush',
          width: 2,
          height: 2,
          thumbnail: '',
          createdAt: 1,
          imageDataUrl: 'data:image/png;base64,AAAA',
          colorCycle: {
            schemaVersion: 2,
            mode: 'captured-data',
            source: 'color-cycle-layer',
            sourceCycleLength: 0,
            mapWidth: 2,
            mapHeight: 2,
            phaseMapBase64: 'AAAA',
          },
        },
      ],
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    const loaded = await loadCustomBrushesFromStorage();
    const cc = loaded?.brushes[0].colorCycle;
    expect(cc?.schemaVersion).toBe(2);
    if (!cc || cc.schemaVersion !== 2) {
      throw new Error('Expected schema v2 color cycle payload');
    }
    expect(cc.mode).toBe('tip');
    expect(cc.sourceCycleLength).toBe(1);
  });
});
