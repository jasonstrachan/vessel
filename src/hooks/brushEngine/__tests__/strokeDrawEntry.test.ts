import { runDrawBrushEntry, runDrawStampEntry } from '../strokeDrawEntry';
import type { CustomBrushStrokeData } from '../BrushEngineFacade';

describe('strokeDrawEntry', () => {
  const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;

  it('runDrawBrushEntry begins stroke and forwards shaped args', () => {
    const beginStroke = jest.fn();
    const runStrokeDrawCore = jest.fn();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(12345);
    const customBrushData: CustomBrushStrokeData = {
      imageData: new ImageData(1, 1),
      width: 1,
      height: 1,
    };

    runDrawBrushEntry({
      ctx,
      from: { x: 10, y: 15 },
      to: { x: 13, y: 19 },
      cursor: {
        pressure: 0.65,
        customBrushData,
      },
      beginStroke,
      runStrokeDrawCore,
    });

    expect(beginStroke).toHaveBeenCalledWith(13, 19);
    expect(runStrokeDrawCore).toHaveBeenCalledTimes(1);

    const args = (runStrokeDrawCore as jest.Mock).mock.calls[0][0];
    expect(args.rawPressure).toBe(0.65);
    expect(args.sampleTag).toEqual({ x: 13, y: 19, tag: 'drawBrush' });
    expect(args.enableLargeRegionFallback).toBe(true);
    expect(args.customBrushData).toBe(customBrushData);

    const params = args.makeStrokeParams(0.4);
    expect(params).toEqual(expect.objectContaining({
      from: { x: 10, y: 15 },
      to: { x: 13, y: 19 },
      pressure: 0.4,
      velocity: 5,
      timestamp: 12345,
    }));

    nowSpy.mockRestore();
  });

  it('runDrawStampEntry begins stamp stroke and forwards shaped args', () => {
    const beginStroke = jest.fn();
    const runStrokeDrawCore = jest.fn();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(6789);

    runDrawStampEntry({
      ctx,
      x: 20,
      y: 30,
      pressure: 0.2,
      beginStroke,
      runStrokeDrawCore,
    });

    expect(beginStroke).toHaveBeenCalledWith(20, 30);
    expect(runStrokeDrawCore).toHaveBeenCalledTimes(1);

    const args = (runStrokeDrawCore as jest.Mock).mock.calls[0][0];
    expect(args.from).toEqual({ x: 20, y: 30 });
    expect(args.to).toEqual({ x: 20, y: 30 });
    expect(args.rawPressure).toBe(0.2);
    expect(args.sampleTag).toEqual({ x: 20, y: 30, tag: 'drawStamp' });
    expect(args.enableLargeRegionFallback).toBe(false);

    const params = args.makeStrokeParams(0.6);
    expect(params).toEqual({
      from: { x: 20, y: 30 },
      to: { x: 20, y: 30 },
      pressure: 0.6,
      velocity: 0,
      timestamp: 6789,
    });

    nowSpy.mockRestore();
  });
});
