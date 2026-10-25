import { resolveRecolorPalettePosition } from '@/lib/colorCycle/gobletPlaybackMath';
import { CPUColorCycleRenderer } from '@/lib/colorCycle/rendering/CPUColorCycleRenderer';
import type { ColorCycleRecolorSettings } from '@/types';

const settings = (flowDirection: ColorCycleRecolorSettings['animation']['flowDirection']): ColorCycleRecolorSettings => ({
  quantizationMode: 'rgb332', ditherMode: 'off', cycleColors: 16, currentLOD: 'full',
  mappingMode: 'continuous', gradient: [{ position: 0, color: 'rgb(100%, 0%, 0%)', opacity: 0.5 }, { position: 1, color: 'rgba(0, 0, 255, 1)', opacity: 1 }],
  animation: { speed: 1, fps: 30, ticksPerFrame: 1, isPlaying: true, currentTick: 4, flowDirection },
});

describe('shared Recolor palette position', () => {
  it.each([
    ['forward', 0, 4, 0.25], ['reverse', 0, 4, 0.75],
    ['pingpong', 0, 20, 0.75], ['bounce', 0, 20, 0.75],
    ['forward', 255, 0, 0], ['pingpong', 255, 0, 0.999999],
    ['bounce', 255, 8, 0.5], ['reverse', 0, -4, 0.25],
  ] as const)('%s code %s tick %s has literal position %s', (flow, code, tick, expected) => {
    expect(resolveRecolorPalettePosition(code, settings(flow), tick)).toBe(expected);
  });

  it('uses mapped bands and fractional ticks without interpreting code zero as transparent', () => {
    const value = settings('forward'); value.mappingMode = 'banded';
    value.indexPhaseMap = Uint8Array.from({ length: 256 }, (_, i) => 255 - i);
    expect(resolveRecolorPalettePosition(0, value, 0.5)).toBe(0.96875);
    expect(resolveRecolorPalettePosition(255, value, 0.5)).toBe(0.03125);
  });

  it('retains CPU CSS percentage/rgba colours, opacity and packed material at independently known phases', () => {
    const renderer = new CPUColorCycleRenderer();
    const lut = renderer.buildGradientLUT(settings('forward'), 4);
    const unpack = (packed: number) => [packed & 255, (packed >>> 8) & 255, (packed >>> 16) & 255, packed >>> 24];
    expect(unpack(lut[0])).toEqual([191, 0, 64, 160]);
    expect(unpack(lut[255])).toEqual([191, 0, 64, 160]);
  });
});
