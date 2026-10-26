import fs from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

import type { AlignInput, BasisInput, Placement } from '@/utils/alignment/alignFitCore';
import { computePlacement } from '@/utils/alignment/alignFitCore';

describe('computePlacement', () => {
  it('positions auto contain content within the leftover frame space', () => {
    const placement = computePlacement({
      surface: { width: 80, height: 60 },
      painted: { width: 20, height: 10 },
      frame: { x: 0, y: 0, width: 80, height: 60 },
      design: { width: 80, height: 60 },
      doc: { width: 80, height: 60 },
      align: {
        fit: 'contain',
        positioning: 'auto',
        offsetPercent: { x: 25, y: 50 },
      },
    });

    expect(placement.dest).toEqual({
      x: 15,
      y: 25,
      width: 20,
      height: 10,
    });
  });

  it('keeps auto fill content at the frame origin', () => {
    const placement = computePlacement({
      surface: { width: 80, height: 60 },
      painted: { width: 20, height: 10 },
      frame: { x: 4, y: 6, width: 80, height: 60 },
      doc: { width: 80, height: 60 },
      align: {
        fit: 'fill',
        positioning: 'auto',
        offsetPercent: { x: 50, y: 50 },
      },
    });

    expect(placement.dest).toEqual({
      x: 4,
      y: 6,
      width: 80,
      height: 60,
    });
  });
});


type NudgedPlacement = Placement & { coverOffset?: { x: number; y: number } };
const basis = (fit: AlignInput['fit'], x = 7, y = -5): BasisInput => ({
  surface: { width: 64, height: 64 }, painted: { width: 8, height: 4 },
  frame: { x: 0, y: 0, width: 64, height: 64 }, design: { width: 64, height: 64 },
  doc: { width: 64, height: 64 },
  align: { fit, positioning: 'anchor', horizontal: 'center', vertical: 'center', offsetPx: { x, y } } as AlignInput,
});
interface RuntimeAlignment {
  normalizeAlign: (raw: unknown, auto?: { x: number; y: number }) => AlignInput;
  computePlacement: (input: BasisInput) => NudgedPlacement;
  drawLayerWithPlacement: (context: CanvasRenderingContext2D, source: HTMLCanvasElement, placement: NudgedPlacement,
    options: { isFixed: boolean; dpr: number; paintedRect: { x: number; y: number; width: number; height: number }; fit: string }) => unknown;
}
const runtimeAlignment = (runtime: 'goblet' | 'goblet2'): RuntimeAlignment => {
  const source = fs.readFileSync(path.join(process.cwd(), 'public', runtime, `${runtime}.js`), 'utf8');
  const helpers = source.slice(source.indexOf('const fitClamp01 ='), source.indexOf('const fitComputeLayoutTransform ='));
  const draw = source.slice(source.indexOf('const drawLayerWithPlacement ='), source.indexOf('const logSummary ='));
  const num = fs.readFileSync(path.join(process.cwd(), 'public', runtime, 'num.js'), 'utf8').replace(/^export /gm, '');
  const clamp = source.match(/function clamp01\(value\) \{[\s\S]*?\n\}/)?.[0];
  if (!clamp) throw new Error('Actual runtime clamp helper absent');
  return runInNewContext(`${num}\n${clamp}\n${helpers}
${draw}
({normalizeAlign,computePlacement,drawLayerWithPlacement})`, { document }) as RuntimeAlignment;
};

describe('scaled anchor-relative artwork nudges', () => {
  it('places all nine None anchors with independent positive and negative nudges in both players', () => {
    const implementations = [computePlacement, runtimeAlignment('goblet').computePlacement, runtimeAlignment('goblet2').computePlacement];
    const horizontal = ['left', 'center', 'right'] as const;
    const vertical = ['top', 'center', 'bottom'] as const;
    for (const offset of [{ x: 3, y: -2 }, { x: -3, y: 2 }]) {
      for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
        const input = basis('none', offset.x, offset.y);
        input.align.horizontal = horizontal[column]; input.align.vertical = vertical[row];
        const expected = { dest: { x: [0, 28, 56][column] + offset.x,
          y: [0, 30, 60][row] + offset.y, width: 8, height: 4 } };
        for (const placement of implementations) expect(placement(input)).toEqual(expected);
      }
    }
  });

  it('rounds fractional Tile artwork movement before converting it to negative pattern phase', () => {
    expect(computePlacement(basis('tile', 0.5, -0.5))).toEqual({ dest: { x: 0, y: 0, width: 64, height: 64 },
      tile: { size: { width: 8, height: 4 }, phase: { x: -1, y: 0 } } });
  });

  it('moves None, design-normalized Contain and Fill with each actual artwork scale', () => {
    expect(computePlacement(basis('none')).dest).toEqual({ x: 35, y: 25, width: 8, height: 4 });
    const contain = basis('contain'); contain.frame.width = contain.frame.height = 128;
    expect(computePlacement(contain).dest).toEqual({ x: 70, y: 50, width: 16, height: 8 });
    expect(computePlacement(basis('fill', 0.5, -0.25)).dest).toEqual({ x: 4, y: -4, width: 64, height: 64 });
  });

  it('keeps Cover coverage fixed and computes its independent uniform artwork translation', () => {
    const input = basis('cover', 1, -0.5); input.frame.width = input.frame.height = 256;
    expect(computePlacement(input)).toEqual({ dest: { x: 0, y: 0, width: 256, height: 256 }, coverOffset: { x: 64, y: -32 } });
  });

  it('keeps Tile coverage fixed and shifts phase opposite to positive artwork movement', () => {
    expect(computePlacement(basis('tile'))).toEqual({ dest: { x: 0, y: 0, width: 64, height: 64 },
      tile: { size: { width: 8, height: 4 }, phase: { x: -7, y: 5 } } });
  });

  it('keeps zero and Auto placements exactly compatible', () => {
    for (const fit of ['none', 'contain', 'cover', 'fill', 'tile'] as const) {
      const missing = basis(fit); delete (missing.align as AlignInput & { offsetPx?: unknown }).offsetPx;
      expect(computePlacement(basis(fit, 0, 0))).toEqual(computePlacement(missing));
      const auto = basis(fit); auto.align = { ...auto.align, positioning: 'auto', offsetPercent: { x: 25, y: 50 } };
      const autoMissing = { ...auto, align: { ...auto.align } }; delete (autoMissing.align as AlignInput & { offsetPx?: unknown }).offsetPx;
      expect(computePlacement(auto)).toEqual(computePlacement(autoMissing));
    }
  });

  it.each(['goblet', 'goblet2'] as const)('%s actual local normalizer, placement and Cover drawing preserve the clip', runtime => {
    const actual = runtimeAlignment(runtime);
    const raw = { fit: 'cover', positioning: 'anchor', horizontal: 'center', vertical: 'center', offsetPx: { x: 1, y: -0.5 } };
    expect(actual.normalizeAlign(raw)).toMatchObject({ offsetPx: raw.offsetPx });
    const input = basis('cover', 1, -0.5); input.frame.width = input.frame.height = 256;
    input.align = actual.normalizeAlign(raw);
    const placement = actual.computePlacement(input);
    expect(placement).toEqual({ dest: { x: 0, y: 0, width: 256, height: 256 }, coverOffset: { x: 64, y: -32 } });
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
    const draw = jest.spyOn(context, 'drawImage'), rect = jest.spyOn(context, 'rect');
    // Canvas pattern creation is an I/O boundary; the actual runtime's phase/translation remains unmocked.
    const pattern = jest.spyOn(context, 'createPattern').mockReturnValue({} as CanvasPattern);
    try {
      actual.drawLayerWithPlacement(context, canvas, placement, { isFixed: false, dpr: 1,
        paintedRect: { x: 10, y: 6, width: 8, height: 4 }, fit: 'cover' });
      expect(rect).toHaveBeenCalledWith(0, 0, 256, 256);
      expect(draw).toHaveBeenCalledWith(canvas, 10, 6, 8, 4, -64, -32, 512, 256);
      const expected = {
        none: { dest: { x: 35, y: 25, width: 8, height: 4 } },
        contain: { dest: { x: 35, y: 25, width: 8, height: 4 } },
        fill: { dest: { x: 56, y: -80, width: 64, height: 64 } },
        tile: { dest: { x: 0, y: 0, width: 64, height: 64 }, tile: { size: { width: 8, height: 4 }, phase: { x: -7, y: 5 } } },
      };
      for (const fit of ['none', 'contain', 'fill', 'tile'] as const) {
        const test = basis(fit); test.align = actual.normalizeAlign(test.align);
        expect(actual.computePlacement(test)).toEqual(expected[fit]);
      }
      for (const { x, y, phase, movement } of [
        { x: 0.5, y: -0.5, phase: { x: -1, y: 0 }, movement: [1, 0] },
        { x: -0.5, y: 0.5, phase: { x: 0, y: -1 }, movement: [0, 1] },
        { x: 0.25, y: -0.25, phase: { x: 0, y: 0 }, movement: [0, 0] },
        { x: -0.25, y: 0.25, phase: { x: 0, y: 0 }, movement: [0, 0] },
      ]) {
        const fractionalTile = actual.computePlacement(basis('tile', x, y));
        expect(fractionalTile.dest).toEqual({ x: 0, y: 0, width: 64, height: 64 });
        expect(fractionalTile.tile?.phase).toEqual(phase);
        const translate = jest.spyOn(context, 'translate');
        try {
          actual.drawLayerWithPlacement(context, canvas, fractionalTile, { isFixed: false, dpr: 1,
            paintedRect: { x: 10, y: 6, width: 8, height: 4 }, fit: 'tile' });
          // Canvas +0 and -0 produce the same translation; normalize only those signs in this assertion.
          expect(translate.mock.calls.at(-1)?.map(value => value || 0)).toEqual(movement);
        } finally { translate.mockRestore(); }
      }
      const zeroCover = basis('cover', 0, 0);
      expect(actual.computePlacement(zeroCover)).toEqual({ dest: { x: 0, y: 0, width: 64, height: 64 } });
      const auto = basis('contain');
      auto.align = actual.normalizeAlign({ ...auto.align, positioning: 'auto' }, { x: 25, y: 50 });
      expect(auto.align).not.toHaveProperty('offsetPx');
      expect(actual.computePlacement(auto)).toEqual({ dest: { x: 14, y: 30, width: 8, height: 4 } });
    } finally { draw.mockRestore(); rect.mockRestore(); pattern.mockRestore(); }
  });
});
