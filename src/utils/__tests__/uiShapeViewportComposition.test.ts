import type { UiImageAsset, UiShape, UiShapeComponent } from '@/types';
import { WINDOWS_95_UI_SHAPE_PALETTE } from '@/utils/uiShape';
import {
  composeUiShapeViewportCrops,
  getUiShapeViewportDescendantIds,
  normalizeUiShapeViewportHierarchy,
  resolveUiShapeViewportAncestorClipRects,
  resolveUiShapeViewportRootId,
} from '@/utils/uiShapeViewportComposition';

const asset: UiImageAsset = {
  id: 'portrait',
  name: 'Portrait',
  dataUrl: 'data:image/png;base64,AAAA',
  naturalWidth: 400,
  naturalHeight: 300,
  focusPoints: [
    { x: 0.25, y: 0.35, weight: 1 },
    { x: 0.75, y: 0.62, weight: 0.9 },
    { x: 0.52, y: 0.5, weight: 0.7 },
  ],
  createdAt: 1,
  updatedAt: 1,
};

const viewport = (
  id: string,
  parentId?: string,
  overrides: Partial<UiShapeComponent> = {},
): UiShapeComponent => ({
  id,
  ...(parentId ? { parentId } : {}),
  kind: 'image-viewport',
  x: parentId ? 20 : 0,
  y: parentId ? 16 : 0,
  width: parentId ? 70 : 120,
  height: parentId ? 52 : 90,
  imageViewport: {
    assetId: asset.id,
    naturalWidth: asset.naturalWidth,
    naturalHeight: asset.naturalHeight,
    scrollbars: parentId ? 'none' : 'both',
    autoCropA: true,
    autoCropB: true,
  },
  canonicalState: { panX: 0.5, panY: 0.5, zoom: 1 },
  ...overrides,
});

const shape = (components: UiShapeComponent[]): UiShape => ({
  id: 'shape',
  layerId: 'layer',
  x: 10,
  y: 12,
  width: 120,
  height: 90,
  gridSize: 2,
  theme: 'windows-95',
  drawMode: 'place',
  regionKind: 'rectangle',
  componentKinds: ['image-viewport'],
  colorSource: 'default',
  palette: { ...WINDOWS_95_UI_SHAPE_PALETTE },
  components,
  createdAt: 1,
  updatedAt: 1,
});

describe('UI Shape viewport composition', () => {
  it('normalizes a valid tree and drops cyclic or non-viewport parents', () => {
    const components = [
      viewport('root', 'child'),
      viewport('child', 'root'),
      { ...viewport('orphan'), parentId: 'missing' },
      { ...viewport('button-child'), parentId: 'button' },
      { ...viewport('button'), kind: 'button' as const, imageViewport: undefined },
    ];

    const normalized = normalizeUiShapeViewportHierarchy(components);

    expect(normalized.find((component) => component.id === 'root')?.parentId).toBeUndefined();
    expect(normalized.find((component) => component.id === 'child')?.parentId).toBeUndefined();
    expect(normalized.find((component) => component.id === 'orphan')?.parentId).toBeUndefined();
    expect(normalized.find((component) => component.id === 'button-child')?.parentId)
      .toBeUndefined();
  });

  it('resolves roots, descendants, and ancestor content clipping', () => {
    const source = shape([viewport('root'), viewport('child', 'root')]);

    expect(resolveUiShapeViewportRootId(source.components, 'child')).toBe('root');
    expect(getUiShapeViewportDescendantIds(source.components, 'root')).toEqual(['child']);
    expect(resolveUiShapeViewportAncestorClipRects(source, 'child')).toEqual([
      expect.objectContaining({ x: 2, y: 2 }),
    ]);
  });

  it('makes Cascade progressively tighter and coordinates Survey coverage', () => {
    const source = shape([
      viewport('root'),
      viewport('child-a', 'root'),
      viewport('child-b', 'root', { x: 42, y: 28 }),
    ]);
    const cascade = composeUiShapeViewportCrops({
      shape: source,
      rootId: 'root',
      assets: [asset],
      preset: 'cascade',
    });
    const cascadeRoot = cascade.components.find((component) => component.id === 'root')!;
    const cascadeChild = cascade.components.find((component) => component.id === 'child-a')!;
    expect(cascadeChild.canonicalState.zoom).toBeGreaterThan(cascadeRoot.canonicalState.zoom!);
    expect(cascadeRoot.imageViewport?.compositionPreset).toBe('cascade');

    const survey = composeUiShapeViewportCrops({
      shape: source,
      rootId: 'root',
      assets: [asset],
      preset: 'survey',
    });
    const states = survey.components.map((component) => (
      `${component.canonicalState.panX}:${component.canonicalState.panY}`
    ));
    expect(new Set(states).size).toBeGreaterThan(1);
  });

  it('keeps manually adjusted A and B states as solver anchors', () => {
    const manual = viewport('root', undefined, {
      imageViewport: {
        assetId: asset.id,
        naturalWidth: asset.naturalWidth,
        naturalHeight: asset.naturalHeight,
        scrollbars: 'both',
        autoCropA: false,
        autoCropB: false,
      },
      canonicalState: { panX: 0.12, panY: 0.82, zoom: 2.4 },
      animation: {
        enabled: true,
        kind: 'viewport-pan-zoom',
        speed: 0.18,
        direction: 1,
        rangeStart: 0.12,
        rangeEnd: 0.91,
        panYStart: 0.82,
        panYEnd: 0.14,
        zoomStart: 2.4,
        zoomEnd: 3.1,
        phaseOffset: 0,
      },
    });

    const composed = composeUiShapeViewportCrops({
      shape: shape([manual]),
      rootId: manual.id,
      assets: [asset],
      preset: 'counterpoint',
    }).components[0]!;

    expect(composed.canonicalState).toEqual(expect.objectContaining({
      panX: 0.12,
      panY: 0.82,
      zoom: 2.4,
    }));
    expect(composed.animation).toEqual(expect.objectContaining({
      rangeEnd: 0.91,
      panYEnd: 0.14,
      zoomEnd: 3.1,
    }));
  });

  it('solves automatic ancestors around a manually anchored descendant', () => {
    const automaticRoot = viewport('root');
    const manualChild = viewport('child', 'root', {
      imageViewport: {
        assetId: asset.id,
        naturalWidth: asset.naturalWidth,
        naturalHeight: asset.naturalHeight,
        scrollbars: 'none',
        autoCropA: false,
        autoCropB: false,
      },
      canonicalState: { panX: 0.98, panY: 0.94, zoom: 3.5 },
      animation: {
        enabled: true,
        kind: 'viewport-pan-zoom',
        speed: 0.18,
        direction: 1,
        rangeStart: 0.98,
        rangeEnd: 0.02,
        panYStart: 0.94,
        panYEnd: 0.08,
        zoomStart: 3.5,
        zoomEnd: 4,
        phaseOffset: 0,
      },
    });
    const composed = composeUiShapeViewportCrops({
      shape: shape([automaticRoot, manualChild]),
      rootId: automaticRoot.id,
      assets: [asset],
      preset: 'survey',
    });
    const root = composed.components.find((component) => component.id === automaticRoot.id)!;
    const child = composed.components.find((component) => component.id === manualChild.id)!;

    expect(child.canonicalState).toEqual(expect.objectContaining({
      panX: 0.98,
      panY: 0.94,
      zoom: 3.5,
    }));
    expect(root.canonicalState.panX).not.toBe(child.canonicalState.panX);
    expect(root.canonicalState.panY).not.toBe(child.canonicalState.panY);
  });
});
