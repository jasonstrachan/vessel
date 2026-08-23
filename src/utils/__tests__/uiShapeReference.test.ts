import { createHash } from 'node:crypto';

import type { UiShapeComponent, UiShapeTheme } from '@/types';
import { drawUiShapeComponent, UI_SHAPE_THEME_PALETTES } from '@/utils/uiShape';
import {
  createUiShapeReferenceBoard,
  drawUiShapeReferenceBoard,
  getUiShapeComponentReferenceSpec,
  UI_SHAPE_REFERENCE_COMPONENT_KINDS,
} from '@/utils/uiShapeReference';

const THEMES: readonly UiShapeTheme[] = [
  'macintosh-system-1',
  'windows-3.1',
  'windows-95',
];

const hashPixels = (context: CanvasRenderingContext2D, width: number, height: number): string => (
  createHash('sha256')
    .update(context.getImageData(0, 0, width, height).data)
    .digest('hex')
);

const renderGoldenHashes = (): Record<UiShapeTheme, Record<string, string>> => Object.fromEntries(
  THEMES.map((theme) => {
    const components = Object.fromEntries(UI_SHAPE_REFERENCE_COMPONENT_KINDS.map((kind) => {
      const spec = getUiShapeComponentReferenceSpec(theme, kind);
      const canvas = document.createElement('canvas');
      canvas.width = spec.width;
      canvas.height = spec.height;
      const context = canvas.getContext('2d')!;
      const component: UiShapeComponent = {
        id: `golden-${theme}-${kind}`,
        kind,
        x: 0,
        y: 0,
        width: spec.width,
        height: spec.height,
        ...(spec.label ? { label: spec.label } : {}),
        canonicalState: { ...spec.canonicalState },
      };
      drawUiShapeComponent(
        context,
        component,
        0,
        0,
        UI_SHAPE_THEME_PALETTES[theme],
        undefined,
        theme,
      );
      return [kind, hashPixels(context, canvas.width, canvas.height)];
    }));
    const board = createUiShapeReferenceBoard(theme);
    const canvas = document.createElement('canvas');
    canvas.width = board.width;
    canvas.height = board.height;
    const context = canvas.getContext('2d')!;
    drawUiShapeReferenceBoard(context, theme);
    return [theme, { ...components, board: hashPixels(context, board.width, board.height) }];
  }),
) as unknown as Record<UiShapeTheme, Record<string, string>>;

const GOLDEN_HASHES: Record<UiShapeTheme, Record<string, string>> = {
  'macintosh-system-1': {
    window: 'c350ab0519f938ac5afd3164ed121670e7fe716964d6e58213ad01ceae98b74f',
    'title-bar': '0a8be420012f50acb193b3b897a0594755965b9723994b35439d29a11665251d',
    'menu-strip': 'aa7ac0b5b6b3e715bebd4c6da969d5b0a0612641018d1735ebcac73e0acaf7ad',
    panel: 'df8f960f32786f3a84604524ca6667b60454645d265fdccdcec4c0e7a3a33599',
    'group-box': 'e063fb37b693efacf2ae10cc8b0abf73dcf6b420b97d5286b510ecc818c91eca',
    button: 'd4f646811a9b741b0c16a778b4224bd308a758e4f0b0ac93858d065e19a32a97',
    'scrollbar-horizontal': '142460fc6fdaebf8441f6637fd3d1a7a6b4408687bb266e7c931a53e6031eb80',
    'scrollbar-vertical': '6cc752c65a5bb9e21319172e78e8e95704f017e32935883beb5820f15bccd16b',
    'selection-field': 'b89fef6537bd102d6c3af0fd4005a2ba839edc78b67c1b9428de5ffdb1d074d8',
    separator: '02864edacda05f7c46332d4fa90ab9088dd22418eb839f5a081dc97108f830dc',
    'resize-corner': '5f4ecdb7b71c3e403983fe405cddcdc2f2576b655fdb3e80d94a6f7c32e58bc2',
    board: 'af64117b72211628e440eace962592bd4d10770a1083a884027d27a0c2229861',
  },
  'windows-3.1': {
    window: '306378426928c0388711bd1665fc1a38e16e940bdf09fd4bcbf0b0fd2e36a2ec',
    'title-bar': '644c843efed4cb4358f90c1ee315a80480a3f8fbb3fd4bb64eab74763d93648c',
    'menu-strip': '1a4dd39e5f5615c98acca8dad1c724f97130da69950d75e424c520176a59eac3',
    panel: 'ea1c559499ca62965640e3fb749ca09f76da5338c559830ed569182d2fd0b010',
    'group-box': 'f87808af0e4516f56341b4db8e55075048413d825f1e9b37ca7e377d71d52d70',
    button: '26d7fde655716933a0404af6b4f61a813ffe7b14dfc4970a0d9c74a4d3e5cd6a',
    'scrollbar-horizontal': '97e5828237631dac15e57a5edd4253f4b1b194c1eb92c9a275e3b0d4dde51fa8',
    'scrollbar-vertical': 'e3f38bb5744942e44fb28674ed73e3cb571247fb918288f4be22b47f749fef47',
    'selection-field': '7a3b1cbad3d07a355e12f20c138d9a240ab3693c6c7a997150f08ab146c3c77f',
    separator: 'd32942255ca6da16209eea758460b1aa46cdc51340838fd0c61936302eb294bb',
    'resize-corner': '7c93a03a7b315cc53b0b5362021e351eaf03dbafe73694a284379f5ebb4bfeb6',
    board: '992afd1da124f7ebc37fcc2c9585981aedf7b5e0e6e9522b3c6fa1174fe1afd3',
  },
  'windows-95': {
    window: '49216b7b74a38a40e6c70af72d76ca5ec39605a6a692c1687bb26b29a2a5434a',
    'title-bar': 'cf3dbb1716cceda1f66f11ab90298df59654f614eacc81e7cd50d39c033122ea',
    'menu-strip': '1a4dd39e5f5615c98acca8dad1c724f97130da69950d75e424c520176a59eac3',
    panel: '929325a714bac758fea9ff13a8c1baa57f60d65348efdb9fc4ef56340028ed6f',
    'group-box': '9217ea7bcc0f412a12b0ef20a2b97cf00feaff7ab670165658de1d0daf6206cb',
    button: '49960cdf19052d771fde496163a092b07c32946897454ae774959fae6a76ccd0',
    'scrollbar-horizontal': '2254f024280b934963f4f9aa236e1d7be014f6e191bfc430b15f5d3e36003468',
    'scrollbar-vertical': 'f341a3ef5588974b63a2d795b1f461d84a55b088e5e1ef56f012cf6448af2163',
    'selection-field': 'a3d55ab25d07fc3a70858dfe2cb76efc1a1db987cc5e337daa6344ce00c1b475',
    separator: '29ca3d383222da608d5ba4709461f1995779136f6ef1990ad3ea3a0767bf5381',
    'resize-corner': '879edf00fb09ad7ef900d5a7b7f035f078f1a9b0535a5e3632a58cdd74fda7cf',
    board: 'cdb0fb595e1c5501627d987115bf3b5d1b3e8865645862c06b5bb6c49db31eb2',
  },
};

describe('UI Shape native reference board', () => {
  it('encodes theme-specific native control metrics', () => {
    expect(getUiShapeComponentReferenceSpec('macintosh-system-1', 'scrollbar-vertical').width)
      .toBe(16);
    expect(getUiShapeComponentReferenceSpec('windows-3.1', 'scrollbar-vertical').width)
      .toBe(17);
    expect(getUiShapeComponentReferenceSpec('windows-95', 'title-bar').height).toBe(18);
    expect(getUiShapeComponentReferenceSpec('windows-95', 'button'))
      .toEqual(expect.objectContaining({ width: 75, height: 23 }));
  });

  it('keeps component labels out of every rendered theme', () => {
    THEMES.forEach((theme) => {
      UI_SHAPE_REFERENCE_COMPONENT_KINDS.forEach((kind) => {
        const spec = getUiShapeComponentReferenceSpec(theme, kind);
        const render = (label: string) => {
          const canvas = document.createElement('canvas');
          canvas.width = spec.width;
          canvas.height = spec.height;
          const context = canvas.getContext('2d')!;
          drawUiShapeComponent(
            context,
            {
              id: `label-free-${theme}-${kind}`,
              kind,
              x: 0,
              y: 0,
              width: spec.width,
              height: spec.height,
              label,
              canonicalState: { ...spec.canonicalState },
            },
            0,
            0,
            UI_SHAPE_THEME_PALETTES[theme],
            undefined,
            theme,
          );
          return hashPixels(context, canvas.width, canvas.height);
        };

        expect(render('VISIBLE TEXT')).toBe(render('DIFFERENT WORDS'));
      });
    });
  });

  it('matches the exact per-component and complete-board pixel goldens', () => {
    const hashes = renderGoldenHashes();
    if (process.env.UI_SHAPE_PRINT_GOLDENS === '1') {
      console.log(`UI_SHAPE_GOLDENS=${JSON.stringify(hashes)}`);
    }
    expect(hashes).toEqual(GOLDEN_HASHES);
  });
});
