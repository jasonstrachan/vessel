import { drawSelectionLayer } from '../drawingCanvasSelection';
import { strokeMarqueePath, strokeMarqueeRect } from '@/utils/marqueeStroke';
import { getSelectionMaskContourPath } from '@/utils/selectionMaskContourPath';

jest.mock('@/utils/marqueeStroke', () => ({
  strokeMarqueeRect: jest.fn(),
  strokeMarqueePath: jest.fn(),
}));

jest.mock('@/utils/selectionMaskContourPath', () => ({
  getSelectionMaskContourPath: jest.fn(() => new Path2D()),
}));

describe('drawSelectionLayer', () => {
  it('clamps marquee rect to project bounds so ants stay on canvas edges', () => {
    const ctx = {
      save: jest.fn(),
      restore: jest.fn(),
      translate: jest.fn(),
      scale: jest.fn(),
      beginPath: jest.fn(),
      rect: jest.fn(),
      clip: jest.fn(),
      setLineDash: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      stroke: jest.fn(),
      fillStyle: '#fff',
      strokeStyle: '#000',
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D;

    drawSelectionLayer({
      ctx,
      projectWidth: 100,
      projectHeight: 80,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      marchingAntsOffset: 0,
      selectionStart: { x: -20, y: -10 },
      selectionEnd: { x: 40, y: 30 },
      isSelecting: true,
      selectionStartRef: null,
      selectionMask: null,
      selectionMaskBounds: null,
      selectionVectorPath: null,
      activeCanvasShape: null,
      applyCanvasShapeClip: jest.fn(),
    });

    expect(strokeMarqueeRect).toHaveBeenCalledWith(
      ctx,
      0,
      0,
      40,
      30,
      expect.objectContaining({
        animated: true,
        marchingAntsOffset: 0,
        scale: 1,
      })
    );
  });
});


describe('completed polygon mask outline authority', () => {
  const originalPath2D = global.Path2D;
  class CapturedPath {
    commands: Array<{ type: 'move' | 'line' | 'close'; x?: number; y?: number }> = [];
    moveTo(x: number, y: number) { this.commands.push({ type: 'move', x, y }); }
    lineTo(x: number, y: number) { this.commands.push({ type: 'line', x, y }); }
    closePath() { this.commands.push({ type: 'close' }); }
  }
  const context = () => ({
    save: jest.fn(), restore: jest.fn(), translate: jest.fn(), scale: jest.fn(),
    beginPath: jest.fn(), rect: jest.fn(), clip: jest.fn(), setLineDash: jest.fn(),
    arc: jest.fn(), fill: jest.fn(), stroke: jest.fn(), fillStyle: '#fff', strokeStyle: '#000', lineWidth: 1,
  });
  const fixtures = [
    {
      name: 'hole with retraced bridge', bounds: { x: 8, y: 10, width: 6, height: 6 },
      rows: ['111111', '111111', '110011', '110011', '111111', '111111'],
      points: [{ x: 8, y: 10 }, { x: 14, y: 10 }, { x: 14, y: 16 }, { x: 8, y: 16 },
        { x: 8, y: 10 }, { x: 10, y: 12 }, { x: 10, y: 14 }, { x: 12, y: 14 },
        { x: 12, y: 12 }, { x: 10, y: 12 }, { x: 8, y: 10 }],
    },
    {
      name: 'outside vector clipped at top and right project edges', bounds: { x: 28, y: 0, width: 4, height: 4 },
      rows: ['1111', '1111', '1111', '1111'],
      points: [{ x: 28, y: 4 }, { x: 38, y: 4 }, { x: 38, y: -8 }, { x: 28, y: -8 }],
    },
  ];
  beforeEach(() => {
    jest.clearAllMocks();
    global.Path2D = CapturedPath as unknown as typeof Path2D;
  });
  afterEach(() => { global.Path2D = originalPath2D; });

  const polygonFixtures = fixtures.flatMap((fixture) =>
    (['freehand', 'click-line'] as const).map((mode) => ({ ...fixture, mode }))
  );

  it.each(polygonFixtures)('uses the mask contour and its offset for $mode $name despite retained vector metadata', ({ bounds, rows, points, mode }) => {
    const ctx = context();
    const mask = new ImageData(bounds.width, bounds.height);
    rows.forEach((row, y) => Array.from(row).forEach((cell, x) => {
      if (cell === '1') mask.data[(y * mask.width + x) * 4 + 3] = 255;
    }));
    const originalBytes = mask.data.slice();
    const vectorPath = { mode, points };
    const originalVector = { ...vectorPath, points: points.map((point) => ({ ...point })) };
    const contourUtility = jest.requireActual<typeof import('@/utils/selectionMaskContourPath')>('@/utils/selectionMaskContourPath');
    const contourPath = contourUtility.getSelectionMaskContourPath(mask);
    jest.mocked(getSelectionMaskContourPath).mockImplementation(contourUtility.getSelectionMaskContourPath);
    const applyCanvasShapeClip = jest.fn();
    drawSelectionLayer({
      ctx: ctx as unknown as CanvasRenderingContext2D, projectWidth: 32, projectHeight: 32,
      scale: 2, offsetX: 75, offsetY: 45, marchingAntsOffset: 3,
      selectionStart: { x: bounds.x, y: bounds.y },
      selectionEnd: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      selectionMask: mask, selectionMaskBounds: bounds, selectionVectorPath: vectorPath,
      activeCanvasShape: null, applyCanvasShapeClip,
    });
    expect(getSelectionMaskContourPath).toHaveBeenCalledTimes(1);
    expect(getSelectionMaskContourPath).toHaveBeenCalledWith(mask);
    expect(strokeMarqueePath).toHaveBeenCalledTimes(1);
    expect(strokeMarqueePath).toHaveBeenCalledWith(ctx, contourPath, { scale: 2, marchingAntsOffset: 3, animated: true });
    expect(ctx.translate.mock.calls).toEqual([[75, 45], [bounds.x, bounds.y]]);
    expect(ctx.scale).toHaveBeenCalledWith(2, 2);
    expect(ctx.rect).toHaveBeenCalledWith(0, 0, 32, 32);
    expect(ctx.clip).toHaveBeenCalledTimes(1);
    expect(ctx.save).toHaveBeenCalledTimes(2); expect(ctx.restore).toHaveBeenCalledTimes(2);
    if (mode === 'click-line') {
      expect(ctx.arc.mock.calls).toEqual(points.map((point) => [point.x, point.y, 1.5, 0, Math.PI * 2]));
      expect(ctx.fill).toHaveBeenCalledTimes(points.length);
      expect(ctx.stroke).toHaveBeenCalledTimes(points.length);
    } else {
      expect(ctx.arc).not.toHaveBeenCalled();
    }
    expect(strokeMarqueeRect).not.toHaveBeenCalled();
    expect(mask.data).toEqual(originalBytes); expect(vectorPath).toEqual(originalVector);
    const commands = (contourPath as unknown as CapturedPath).commands;
    const edges: string[] = [];
    let previous: { x: number; y: number } | null = null;
    for (const command of commands) {
      if (command.type === 'close') continue;
      const point = { x: command.x!, y: command.y! };
      if (command.type === 'line' && previous) {
        // A retraced diagonal bridge inside the mask is not a selection boundary.
        expect(point.x === previous.x || point.y === previous.y).toBe(true);
        edges.push(`${previous.x},${previous.y}:${point.x},${point.y}`);
      }
      previous = point;
    }
    if (bounds.y === 10) {
      expect(commands.filter((command) => command.type === 'move')).toHaveLength(2);
      expect(edges).toHaveLength(32);
      expect(edges).toEqual(expect.arrayContaining(['2,2:2,3', '3,2:2,2', '4,3:4,2', '2,4:3,4']));
    } else {
      expect(commands.filter((command) => command.type === 'move')).toHaveLength(1);
      expect(edges).toEqual(expect.arrayContaining(['2,0:3,0', '3,0:4,0', '4,0:4,1', '4,3:4,4']));
    }
  });

  it('keeps rectangle rendering for a selection without a mask', () => {
    const ctx = context();
    drawSelectionLayer({
      ctx: ctx as unknown as CanvasRenderingContext2D, projectWidth: 32, projectHeight: 32,
      scale: 2, offsetX: 75, offsetY: 45, marchingAntsOffset: 3,
      selectionStart: { x: -2, y: 10 }, selectionEnd: { x: 14, y: 40 },
      selectionMask: null, selectionMaskBounds: null,
      selectionVectorPath: { mode: 'freehand', points: [{ x: 2, y: 10 }, { x: 14, y: 16 }] },
      activeCanvasShape: null, applyCanvasShapeClip: jest.fn(),
    });
    expect(getSelectionMaskContourPath).not.toHaveBeenCalled(); expect(strokeMarqueePath).not.toHaveBeenCalled();
    expect(strokeMarqueeRect).toHaveBeenCalledWith(ctx, 0, 10, 14, 22, { scale: 2, marchingAntsOffset: 3, animated: true });
    expect(ctx.arc).not.toHaveBeenCalled();
  });
});
