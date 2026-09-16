import type { BrushSettings } from '@/types';
import { buildCcCycleInkPalettes, buildCcInkPalettes, canUseCcInkSpread, createCcFixedInkPreview } from '../ccInkSpread';
import { ensurePalette } from '@/lib/colorCycle/paletteService';

it('uses identical inks at zero and preserves alpha through fixed preview and committed palettes', () => {
  const stops = [{ position: 0, color: 'rgba(60, 100, 140, 0.5)', opacity: 0.5 }, { position: 1, color: 'rgba(160, 100, 80, 0.5)', opacity: 0.5 }];
  for (const spread of [0, 50, 100]) {
    const pair = buildCcCycleInkPalettes(stops, spread, 'hard');
    if (!spread) expect(pair.primary).toEqual(pair.secondary);
    else expect(pair.primary).not.toEqual(pair.secondary);
    const preview = createCcFixedInkPreview(stops, { ditherEnabled: true, ccFlatCycleDither: true, ditherPaletteSpread: spread, colorCycleGradientSeamProfile: 'hard' } as BrushSettings)!;
    for (const secondary of [false, true]) {
      const rgba = ensurePalette({ stops: secondary ? pair.secondary : pair.primary, seamProfile: 'hard' }).rgba;
      for (const index of [1, 64, 128, 255]) {
        expect(preview(index, secondary)).toEqual(Array.from(rgba.slice((index - 1) * 4, index * 4)));
        expect(preview(index, secondary)[3]).toBe(64);
      }
    }
  }
  expect(buildCcInkPalettes(stops, 0).primary).toEqual(stops);
});

it.each([
  ['manual', 'stroke', { colorCycleStampDitherEnabled: true }, true],
  ['sampled', 'stroke', { colorCycleStampDitherEnabled: true, colorCyclePencilEnabled: true }, false],
  ['manual', 'stroke', { colorCycleStampDitherEnabled: false }, false],
  ['sampled', 'stroke', { colorCycleStampDitherEnabled: true, colorCycleStampDitherBgFill: false }, false],
  ['fg', 'shape', { ditherEnabled: true }, false],
  ['manual', 'shape', { ditherEnabled: true, colorCycleGradientIsRuntimePalette: true }, false],
  ['sampled', 'shape', { ditherEnabled: true, colorCyclePickupEnabled: true }, false],
  ['sampled', 'shape', { ditherEnabled: true }, true],
  ['manual', 'shape', { ditherEnabled: false }, false],
  ['manual', 'shape', { ditherEnabled: true, ccFlatCycleDither: true, ditherGradBgFill: false }, false],
  ['manual', 'shape', { ditherEnabled: true, ccFlatCycleDither: false, ditherGradBgFill: false }, true],
] as const)('reports effective controls for %s %s %j', (source, kind, settings, expected) => {
  expect(canUseCcInkSpread(settings as BrushSettings, source, kind)).toBe(expected);
});

it('parses modern CSS alpha without importing canvas or store orchestration', () => {
  const modern = buildCcInkPalettes([{ position: 0, color: 'rgb(60 100 140 / 25%)', opacity: 0.5 }], 80);
  const comma = buildCcInkPalettes([{ position: 0, color: 'rgba(60, 100, 140, 0.25)', opacity: 0.5 }], 80);
  expect(modern).toEqual(comma);
  expect(modern.primary[0].opacity).toBe(0.5);
  expect(ensurePalette({ stops: modern.primary, seamProfile: 'hard' }).rgba[3]).toBe(32);
});
