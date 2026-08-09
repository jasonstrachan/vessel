import { commitVesselCollaborationGesture } from '../commitVesselCollaborationGesture';

const createHandlers = () => ({
  startDrawing: jest.fn(),
  continueDrawing: jest.fn(),
  finalizeDrawing: jest.fn(async () => undefined),
  startShapeDrawing: jest.fn(() => true),
  continueShapeDrawing: jest.fn(),
  finalizeShapeDrawing: jest.fn(async () => undefined),
  isSelectingDirectionRef: { current: false },
  directionPreviewRef: { current: null as { x: number; y: number } | null },
  ccStrokeDirectionRef: { current: null as { x: number; y: number } | null },
});

describe('commitVesselCollaborationGesture', () => {
  it('preserves exact ordered shape topology and commits direction atomically', async () => {
    const handlers = createHandlers();
    const points = [
      { x: 20, y: 25, pressure: 0.4 },
      { x: 130, y: 18, pressure: 0.6 },
      { x: 164, y: 92, pressure: 0.7 },
      { x: 71, y: 139, pressure: 0.8 },
      { x: 29, y: 88, pressure: 0.5 },
    ];

    await commitVesselCollaborationGesture({
      handlers,
      gesture: {
        kind: 'shape',
        points,
        direction: [{ x: 45, y: 60 }, { x: 125, y: 90 }],
      },
    });

    expect(handlers.startShapeDrawing).toHaveBeenCalledWith(
      points[0],
      0.4,
      expect.any(Number),
      0.4,
      { renderPreview: false },
    );
    expect(handlers.continueShapeDrawing.mock.calls.map(([point]) => point)).toEqual(points.slice(1));
    expect(handlers.startShapeDrawing).toHaveBeenCalledTimes(2);
    expect(handlers.startShapeDrawing).toHaveBeenLastCalledWith(
      { x: 125, y: 90 },
      1,
      expect.any(Number),
      1,
      { renderPreview: false },
    );
    expect(handlers.finalizeShapeDrawing).toHaveBeenCalledTimes(1);
    expect(handlers.startDrawing).not.toHaveBeenCalled();
    expect(handlers.isSelectingDirectionRef.current).toBe(true);
    expect(handlers.ccStrokeDirectionRef.current).toEqual({ x: 80, y: 30 });
  });

  it('rejects a directed shape before beginning its boundary when direction runtime is absent', async () => {
    const handlers = createHandlers();
    const handlersWithoutDirectionRuntime = {
      ...handlers,
      isSelectingDirectionRef: undefined,
    };

    await expect(commitVesselCollaborationGesture({
      handlers: handlersWithoutDirectionRuntime,
      gesture: {
        kind: 'shape',
        points: [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 50, y: 80 }],
        direction: [{ x: 30, y: 30 }, { x: 60, y: 50 }],
      },
    })).rejects.toThrow('Canonical shape direction runtime is unavailable');
    expect(handlers.startShapeDrawing).not.toHaveBeenCalled();
  });

  it('waits through transient Color Cycle readiness refusals before starting the shape', async () => {
    const handlers = createHandlers();
    handlers.startShapeDrawing
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);

    await commitVesselCollaborationGesture({
      handlers,
      gesture: {
        kind: 'shape',
        points: [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 50, y: 80 }],
      },
    });

    expect(handlers.startShapeDrawing).toHaveBeenCalledTimes(3);
    expect(handlers.continueShapeDrawing).toHaveBeenCalledTimes(2);
    expect(handlers.finalizeShapeDrawing).toHaveBeenCalledTimes(1);
  });

  it('soaks 100 varied shapes without dropping or substituting vertices', async () => {
    const handlers = createHandlers();
    const shapes = Array.from({ length: 100 }, (_, shapeIndex) => Array.from(
      { length: 7 + (shapeIndex % 9) },
      (_, pointIndex) => ({
        x: 20 + shapeIndex * 0.5 + pointIndex * 3,
        y: 30 + (shapeIndex % 11) * 2 + (pointIndex * pointIndex) % 17,
      }),
    ));

    for (const points of shapes) {
      await commitVesselCollaborationGesture({
        handlers,
        gesture: { kind: 'shape', points },
      });
    }

    expect(handlers.startShapeDrawing).toHaveBeenCalledTimes(100);
    expect(handlers.finalizeShapeDrawing).toHaveBeenCalledTimes(100);
    const startCalls = handlers.startShapeDrawing.mock.calls as unknown as Array<[
      { x: number; y: number },
    ]>;
    const moveCalls = handlers.continueShapeDrawing.mock.calls as unknown as Array<[
      { x: number; y: number },
    ]>;
    const committedPoints: Array<Array<{ x: number; y: number }>> = [];
    let moveCursor = 0;
    for (let index = 0; index < shapes.length; index += 1) {
      const moveCount = shapes[index].length - 1;
      committedPoints.push([
        startCalls[index][0],
        ...moveCalls
          .slice(moveCursor, moveCursor + moveCount)
          .map(([point]) => point),
      ]);
      moveCursor += moveCount;
    }
    expect(committedPoints).toEqual(shapes);
  });
});
