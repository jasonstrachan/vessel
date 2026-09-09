import { bindColorCycleCommittedGradientDefToSlot } from '@/lib/colorCycle/document';
import { enableColorCycleNonDitherPlaybackSpeed, refreshColorCycleShapeFillWriteSpeed } from '../colorCycleStrokeTimingRuntime';
import { createLayerStrokeState } from '../colorCycleLayerStrokeBuffers';
import { IndexBuffer } from '@/lib/IndexBuffer';
import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import { BrushShape } from '@/types';

import { createColorCycleStampPaintMask } from '../colorCycleStrokePaintMask';
import { clearStrokeDefIdsForStamp } from '../strokeDefClear';
import { createColorCycleStrokeMaskHealer } from '../colorCycleStrokeMaskHeal';
import { createCcBristleWriter } from '../ccBristles';
import { applyStampDitherStamp, createStampDitherRuntime, finalizeStampDither, recomposeStampDitherOverlay } from '../strokeStampDither';
import type { StampDitherStrokeData, StampDitherShape } from '../strokeStampDither/state';

const width = 48, height = 32;
const acceptsPixel = (x: number, y: number) => x < 13 || (x >= 23 && y >= 12);
const mask = { acceptsPixel };
const shapes: StampDitherShape[] = ['square', 'round', 'triangle', 'diamond', 'diamond5', 'diamond7', 'diamond9', 'checkered'];

const fixture = () => {
  const buffer = new IndexBuffer(width, height);
  buffer.setPalette(Array.from({ length: 256 }, () => '#123456'));
  const paint = buffer.getDirectData();
  const gid = new Uint8Array(width * height).fill(3);
  const def = new Uint16Array(width * height).fill(315);
  const speed = new Uint8Array(width * height).fill(91);
  const flow = new Uint8Array(width * height).fill(2);
  const phase = new Uint8Array(width * height).fill(137);
  paint.fill(46);
  return { buffer, paint, gid, def, speed, flow, phase };
};

it.each(shapes)('clips partial %s stamps before native writes and bristle/definition changes', (shape) => {
  const { buffer, paint, gid, def, phase } = fixture();
  const native = {
    square: buffer.paintSquareWithIndex.bind(buffer),
    round: buffer.paintCircleWithIndex.bind(buffer),
    triangle: buffer.paintTriangleWithIndex.bind(buffer),
    diamond: buffer.paintDiamondWithIndex.bind(buffer),
    diamond5: buffer.paintDiamond5PixelatedWithIndex.bind(buffer),
    diamond7: buffer.paintDiamond7PixelatedWithIndex.bind(buffer),
    diamond9: buffer.paintDiamond9PixelatedWithIndex.bind(buffer),
    checkered: buffer.paintCheckeredPixelatedWithIndex.bind(buffer),
  }[shape];
  const pencil = { tile: new Uint8Array([1, 0, 0, 1]), size: 2, accepts: (x: number, y: number) => (x + y) % 2 === 0 };
  for (const size of [1, 9, 24, 37, 12]) {
    const stamp = createColorCycleStampPaintMask(mask, 18.4, 15.7, size, pencil);
    const divisors: Partial<Record<StampDitherShape, number>> = { diamond5: 5, diamond7: 7, diamond9: 9, checkered: 4 };
    const divisor = divisors[shape];
    native(18.4, 15.7, divisor ? Math.max(1, Math.round(size / divisor)) : size,
      100, stamp.tile, stamp.size, false, undefined, 3, stamp.originX, stamp.originY);
    clearStrokeDefIdsForStamp({ buffers: { paint, gid, def }, width, height, x: 18.4, y: 15.7,
      brushSize: size, flowSlot: 3, shape, isPaintPixel: stamp.accepts,
      onPaintPixel: createCcBristleWriter(phase, { x: 18.4, y: 15.7 }, null, 2) });
  }
  for (let i = 0; i < paint.length; i += 1) {
    if (acceptsPixel(i % width, Math.floor(i / width))) continue;
    expect([paint[i], def[i], phase[i]]).toEqual([46, 315, 137]);
  }
  expect(paint.some((value) => value === 100)).toBe(true);
});

it.each(shapes.flatMap((shape) => [true, false].flatMap((bgFill) => ['sierra-lite', 'pattern'].map((algorithm) => ({ shape, bgFill, algorithm })))))
('preserves rejected data through $shape $algorithm dither, bgFill=$bgFill, recomposition and finalization', ({ shape, bgFill, algorithm }) => {
  const { paint, gid, def, speed, flow, phase } = fixture();
  const state: StampDitherStrokeData = { paint, gradientIdBuffer: gid, gradientDefIdBuffer: def,
    speedBuffer: speed, stampDitherStrokeEpoch: 1, stampDitherStampSeq: 0 };
  const animator = {
    beginDirectFill: () => ({ data: paint, gradientId: gid, speedData: speed, flowData: flow, phaseData: phase, width, height }),
    endDirectFill: jest.fn(), markDirtyBounds: jest.fn(), hasWebGL: () => false,
  } as unknown as ColorCycleAnimator;
  const config = { algorithm: algorithm as 'sierra-lite' | 'pattern', pixelSize: 2, patternStyle: 'dots' as const,
    bgFill, pressureLinked: false, seed: 7, diversity: 0 };
  const runtime = createStampDitherRuntime();
  for (const x of [8, 16, 24, 32, 24, 16]) {
    applyStampDitherStamp({ animator, state, config, runtime, stampShape: shape, x, y: 16,
      pressure: 0.7, pressureSize: 25, primaryIndex: 110, flowSlot: 3, cycleSpeed: 0.2,
      width, height, isAnimating: false, acceptsPixel });
  }
  const check = () => {
    for (let i = 0; i < paint.length; i += 1) {
      if (acceptsPixel(i % width, Math.floor(i / width))) continue;
      expect([paint[i], gid[i], def[i], speed[i], flow[i], phase[i]]).toEqual([46, 3, 315, 91, 2, 137]);
      expect(state.stampDitherTag?.[i] ?? 0).toBe(0);
    }
  };
  check();
  recomposeStampDitherOverlay({ animator, state, config, runtime, flowSlot: 3, cycleSpeed: 0.2, tileScale: 3 });
  check();
  finalizeStampDither({ animator, state, config, runtime, flowSlot: 3, cycleSpeed: 0.2, width, height, ditherStrength: 1 });
  check();
  expect(paint.some((value) => value !== 46)).toBe(true);
});

it('excludes rejected pixels from erase-mask healing even when stamp caps cross them', () => {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const heal = jest.fn();
  const healer = createColorCycleStrokeMaskHealer({ internalCanvas: canvas, layerId: 'layer',
    healColorCycleEraseMask: heal, resolveStampTargetSize: () => 24, acceptsPixel });
  healer.markPaintedStamp({ x: 18, y: 16, width: 24, height: 24, shape: BrushShape.SQUARE, pressure: 1, rotation: 0 });
  healer.healPaintedEraseMask();
  expect(heal).toHaveBeenCalledTimes(1);
  const coverage = heal.mock.calls[0][1];
  for (let y = 0; y < coverage.height; y += 1) for (let x = 0; x < coverage.width; x += 1) {
    if (!acceptsPixel(x + coverage.bounds.x, y + coverage.bounds.y)) expect(coverage.data[y * coverage.width + x]).toBe(0);
  }
});

it('does not backfill speed in rejected stationary pixels at stroke end', () => {
  const paint = new Uint8Array(8).fill(30), spd = new Uint8Array(8);
  const strokeData = createLayerStrokeState({ bufferSize: 8, strokeCycleSpeed: 0.2, strokeSpeedByte: 120 });
  strokeData.buffers.paint = paint;
  strokeData.buffers.spd = spd;
  strokeData.paintMask = { acceptsPixel: (x: number) => x < 2 };
  enableColorCycleNonDitherPlaybackSpeed({ strokeData, speedByte: 120, width: 4 });
  expect(Array.from(spd)).toEqual([120, 120, 0, 0, 120, 120, 0, 0]);
});

it('preserves rejected unbound and empty pixels during final gradient binding, then releases the mask for shape authoring', () => {
  const state = createLayerStrokeState({ bufferSize: 4, strokeCycleSpeed: 0.2, strokeSpeedByte: 120 });
  state.buffers.paint.set([20, 20, 0, 20]);
  state.buffers.gid.set([3, 3, 3, 9]);
  state.buffers.def.set([0, 0, 12, 0]);
  state.paintMask = { acceptsPixel: (x, y) => x === 0 && y === 0 };
  bindColorCycleCommittedGradientDefToSlot({ buffers: state.buffers, canvasWidth: 2, canvasHeight: 2,
    defId: 44, slot: 3, flowSlotMask: 63, previewSlot: 9, acceptsPixel: state.paintMask.acceptsPixel });
  expect(Array.from(state.buffers.def)).toEqual([44, 0, 12, 0]);
  expect(Array.from(state.buffers.gid)).toEqual([3, 3, 3, 9]);
  refreshColorCycleShapeFillWriteSpeed({ strokeData: state, strokeCounter: 2, resolvedSpeed: 0.3 });
  expect(state.paintMask).toBeNull();
});
