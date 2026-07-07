import { debugLog, isDebugEnabled } from '@/utils/debug';

export type ColorCycleShapeFillBufferSnapshotOptions = {
  layerId: string;
  mode: 'linear' | 'concentric';
  path: 'cpu' | 'gpu' | 'worker';
  ccGradient: boolean;
  ditherEnabled: boolean;
  colors: number;
  bbox: { minX: number; minY: number; width: number; height: number };
  canvasHeight: number;
  width: number;
  paint: Uint8Array;
  speed: Uint8Array;
  flow: Uint8Array;
  phase: Uint8Array;
};

export function logColorCycleShapeFillBufferSnapshot(
  options: ColorCycleShapeFillBufferSnapshotOptions,
): void {
  if (!isDebugEnabled('cc-fill')) {
    return;
  }

  const { bbox, canvasHeight, width, paint, speed, flow, phase } = options;
  const uniquePaint = new Set<number>();
  const uniqueSpeed = new Set<number>();
  const uniqueFlow = new Set<number>();
  const uniquePhase = new Set<number>();
  let nonZeroPaint = 0;
  let nonZeroSpeed = 0;
  let nonZeroFlow = 0;
  let nonZeroPhase = 0;

  for (let y = 0; y < bbox.height; y += 1) {
    const py = bbox.minY + y;
    if (py < 0 || py >= canvasHeight) {
      continue;
    }
    const rowOffset = py * width;
    for (let x = 0; x < bbox.width; x += 1) {
      const px = bbox.minX + x;
      if (px < 0 || px >= width) {
        continue;
      }
      const idx = rowOffset + px;
      const paintByte = paint[idx] ?? 0;
      const speedByte = speed[idx] ?? 0;
      const flowByte = flow[idx] ?? 0;
      const phaseByte = phase[idx] ?? 0;
      if (paintByte !== 0) {
        nonZeroPaint += 1;
        if (uniquePaint.size < 8) uniquePaint.add(paintByte);
      }
      if (speedByte !== 0) {
        nonZeroSpeed += 1;
        if (uniqueSpeed.size < 8) uniqueSpeed.add(speedByte);
      }
      if (flowByte !== 0) {
        nonZeroFlow += 1;
        if (uniqueFlow.size < 8) uniqueFlow.add(flowByte);
      }
      if (phaseByte !== 0) {
        nonZeroPhase += 1;
        if (uniquePhase.size < 8) uniquePhase.add(phaseByte);
      }
    }
  }

  debugLog('cc-fill', '[CC fill] buffer snapshot', {
    layerId: options.layerId,
    mode: options.mode,
    path: options.path,
    ccGradient: options.ccGradient,
    ditherEnabled: options.ditherEnabled,
    colors: options.colors,
    bbox,
    nonZeroPaint,
    nonZeroSpeed,
    nonZeroFlow,
    nonZeroPhase,
    uniquePaint: Array.from(uniquePaint),
    uniqueSpeed: Array.from(uniqueSpeed),
    uniqueFlow: Array.from(uniqueFlow),
    uniquePhase: Array.from(uniquePhase),
  });
}
