import type { UiShape } from '@/types';
import { WINDOWS_95_UI_SHAPE_PALETTE } from '@/utils/uiShape';
import {
  normalizeUiShapeImageAssets,
  resolveUiShapeViewportImageDataUrl,
  upsertUiImageAsset,
} from '@/utils/uiShapeImageAssets';

const dataUrl = 'data:image/png;base64,AAAA';

const createShape = (id: string, panX: number, zoomEnd: number): UiShape => ({
  id,
  layerId: 'layer-1',
  x: 0,
  y: 0,
  width: 64,
  height: 48,
  gridSize: 8,
  theme: 'windows-95',
  drawMode: 'place',
  regionKind: 'rectangle',
  componentKinds: ['image-viewport'],
  colorSource: 'default',
  palette: { ...WINDOWS_95_UI_SHAPE_PALETTE },
  components: [{
    id: `${id}-viewport`,
    kind: 'image-viewport',
    x: 0,
    y: 0,
    width: 64,
    height: 48,
    imageViewport: {
      dataUrl,
      naturalWidth: 320,
      naturalHeight: 240,
      scrollbars: 'both',
    },
    canonicalState: { panX, panY: 0.5, zoom: 1 },
    animation: {
      enabled: true,
      kind: 'viewport-pan-zoom',
      speed: 0.2,
      direction: 1,
      rangeStart: panX,
      rangeEnd: 1,
      panYStart: 0.5,
      panYEnd: 0.5,
      zoomStart: 1,
      zoomEnd,
      phaseOffset: 0,
    },
  }],
  createdAt: 1,
  updatedAt: 1,
});

describe('UI Shape image assets', () => {
  it('migrates duplicate inline images into one shared asset without merging view states', () => {
    const result = normalizeUiShapeImageAssets({
      assets: undefined,
      shapes: [createShape('first', 0.1, 2), createShape('second', 0.8, 3)],
    });

    expect(result.assets).toHaveLength(1);
    const first = result.shapes[0]!.components[0]!;
    const second = result.shapes[1]!.components[0]!;
    expect(first.imageViewport).toEqual(expect.objectContaining({
      assetId: result.assets[0]!.id,
      naturalWidth: 320,
      naturalHeight: 240,
    }));
    expect(first.imageViewport?.dataUrl).toBeUndefined();
    expect(second.imageViewport?.assetId).toBe(first.imageViewport?.assetId);
    expect(first.canonicalState.panX).toBe(0.1);
    expect(second.canonicalState.panX).toBe(0.8);
    expect(first.animation?.zoomEnd).toBe(2);
    expect(second.animation?.zoomEnd).toBe(3);
    expect(resolveUiShapeViewportImageDataUrl(first.imageViewport, result.assets)).toBe(dataUrl);
  });

  it('deduplicates repeated imports by image payload', () => {
    const first = upsertUiImageAsset({
      assets: [],
      dataUrl,
      name: 'First.png',
      naturalWidth: 320,
      naturalHeight: 240,
    });
    const second = upsertUiImageAsset({
      assets: first.assets,
      dataUrl,
      name: 'Second.png',
      naturalWidth: 320,
      naturalHeight: 240,
    });

    expect(second.assets).toHaveLength(1);
    expect(second.asset.id).toBe(first.asset.id);
    expect(second.asset.name).toBe('First.png');
  });
});
