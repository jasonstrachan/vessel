import {
  resolveUiShapeViewportLayout,
  resolveUiShapeViewportPanFromDrag,
  resolveUiShapeViewportZoomAtPoint,
} from '@/utils/uiShapeViewport';

describe('UI Shape image viewport geometry', () => {
  it('centres vertical pan and uses unit zoom when state is absent or invalid', () => {
    const layout = resolveUiShapeViewportLayout({
      width: 220,
      height: 160,
      naturalWidth: 400,
      naturalHeight: 300,
      scrollbars: 'both',
      state: { zoom: Number.NaN },
      theme: 'windows-95',
    });

    expect(layout.panX).toBe(0);
    expect(layout.panY).toBe(0.5);
    expect(layout.zoom).toBe(1);
  });

  it('derives both scrollbar ratios and positions from one viewport state', () => {
    const layout = resolveUiShapeViewportLayout({
      width: 220,
      height: 160,
      naturalWidth: 400,
      naturalHeight: 300,
      scrollbars: 'both',
      state: { panX: 0.25, panY: 0.75, zoom: 1.5 },
      theme: 'windows-95',
    });

    expect(layout.horizontalScrollbar).not.toBeNull();
    expect(layout.verticalScrollbar).not.toBeNull();
    expect(layout.horizontalRatio).toBeCloseTo(
      layout.contentRect.width / layout.scaledWidth,
    );
    expect(layout.verticalRatio).toBeCloseTo(
      layout.contentRect.height / layout.scaledHeight,
    );
    expect(layout.scrollX).toBeCloseTo(layout.maxScrollX * 0.25);
    expect(layout.scrollY).toBeCloseTo(layout.maxScrollY * 0.75);
  });

  it('moves the image and both thumbs from the same drag result', () => {
    const layout = resolveUiShapeViewportLayout({
      width: 180,
      height: 120,
      naturalWidth: 480,
      naturalHeight: 320,
      scrollbars: 'both',
      state: { panX: 0.5, panY: 0.5, zoom: 1 },
      theme: 'windows-3.1',
    });
    const next = resolveUiShapeViewportPanFromDrag({
      layout,
      deltaX: -30,
      deltaY: 20,
    });

    expect(next.panX).toBeGreaterThan(layout.panX);
    expect(next.panY).toBeLessThan(layout.panY);
    const nextLayout = resolveUiShapeViewportLayout({
      width: 180,
      height: 120,
      naturalWidth: 480,
      naturalHeight: 320,
      scrollbars: 'both',
      state: { ...next, zoom: layout.zoom },
      theme: 'windows-3.1',
    });
    expect(nextLayout.scrollX).toBeGreaterThan(layout.scrollX);
    expect(nextLayout.scrollY).toBeLessThan(layout.scrollY);
  });

  it('updates thumb size and preserves the cursor focal point while zooming', () => {
    const before = resolveUiShapeViewportLayout({
      width: 200,
      height: 140,
      naturalWidth: 360,
      naturalHeight: 240,
      scrollbars: 'both',
      state: { panX: 0.4, panY: 0.6, zoom: 1 },
      theme: 'macintosh-system-7',
    });
    const focalX = before.contentRect.width * 0.35;
    const focalY = before.contentRect.height * 0.65;
    const sourceX = (before.scrollX + focalX) / before.zoom;
    const sourceY = (before.scrollY + focalY) / before.zoom;
    const nextState = resolveUiShapeViewportZoomAtPoint({
      layout: before,
      localX: focalX,
      localY: focalY,
      zoom: 1.75,
      naturalWidth: 360,
      naturalHeight: 240,
    });
    const after = resolveUiShapeViewportLayout({
      width: 200,
      height: 140,
      naturalWidth: 360,
      naturalHeight: 240,
      scrollbars: 'both',
      state: nextState,
      theme: 'macintosh-system-7',
    });

    expect(after.horizontalRatio).toBeLessThan(before.horizontalRatio);
    expect(after.verticalRatio).toBeLessThan(before.verticalRatio);
    expect((after.scrollX + focalX) / after.zoom).toBeCloseTo(sourceX);
    expect((after.scrollY + focalY) / after.zoom).toBeCloseTo(sourceY);
  });

  it('fills the tracks when the image has no overflow', () => {
    const layout = resolveUiShapeViewportLayout({
      width: 240,
      height: 180,
      naturalWidth: 32,
      naturalHeight: 24,
      scrollbars: 'both',
      state: { panX: 0.8, panY: 0.2, zoom: 1 },
      theme: 'macintosh-system-1',
    });

    expect(layout.maxScrollX).toBe(0);
    expect(layout.maxScrollY).toBe(0);
    expect(layout.horizontalRatio).toBe(1);
    expect(layout.verticalRatio).toBe(1);
  });
});
