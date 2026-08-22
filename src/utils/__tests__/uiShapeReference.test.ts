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
    window: '24b8d0a4d480219ad5cbdbdf53f022f7fd28d1d3bc395b430be02a8ab80da92a',
    'title-bar': '03337a438767d2f3414cea8d79041c8625f5d55f883708d8b644cf5f94282954',
    'menu-strip': 'f17263667a446b6b5f21c7051bc6c6387eeff899afc8e4fb13274f2d74565b8f',
    panel: 'df8f960f32786f3a84604524ca6667b60454645d265fdccdcec4c0e7a3a33599',
    'group-box': '550830b22c909990d2292c334dc67a7669ce6754d285d159175c323dddec2770',
    button: '58914fd6467bc8ef28192377a940bea250a90dcf927b31d9794c7dfd05b6d488',
    'scrollbar-horizontal': '5d3d3ba5d4c13da9faf5287a25670c5ac40f19143845cb01b99f7e6d61a9ba1c',
    'scrollbar-vertical': 'c050c29295827dbbbf085b2fc28990566a48044e55debe60ab4b8780fc789b7f',
    'selection-field': 'b7f6683fca69a97d8d6a0fdcd7637c6375ba605806399bb3d4a468b2fe89d10b',
    separator: '02864edacda05f7c46332d4fa90ab9088dd22418eb839f5a081dc97108f830dc',
    'resize-corner': '5f4ecdb7b71c3e403983fe405cddcdc2f2576b655fdb3e80d94a6f7c32e58bc2',
    board: '2a5dc5dda067dbd530fe9cee281de25d85081b0d4ec5bf5ddb3d1735361ecac0',
  },
  'windows-3.1': {
    window: 'c9ecd958f0586ec52bec69ee57af796945b6cf4f8c506e5b59704eae89cfac39',
    'title-bar': '8984485cb88e0f20b38e6c90b5dde432e78046cc2c5d9d699ab62d438460513f',
    'menu-strip': 'b21370a6ca0927b6d3bdd19cba1598d50379489066127029600c03e5135f08ee',
    panel: 'ea1c559499ca62965640e3fb749ca09f76da5338c559830ed569182d2fd0b010',
    'group-box': '69e15fdcee48ddcbe2004bdc67a67c9c80a0d3db5a79858e4938671b7a3ffd89',
    button: 'ca4aa77555fda23e8f9b347ec7d96420fa965d9c57b8824dd5f59346b141c53c',
    'scrollbar-horizontal': '6bd7cfee8f4d4221a8bdb1e605c70825b61dc9c363b9bc62848aacdb8872ea1c',
    'scrollbar-vertical': 'fa0182695776cd9f559d14097920d837cc7e0f868eaa4f5ac340118c56ebf53e',
    'selection-field': '8c64592028e1aa9f2cafb7c738c0cb790b5c03cd7a469a23aab7d0084c3e70a7',
    separator: 'd32942255ca6da16209eea758460b1aa46cdc51340838fd0c61936302eb294bb',
    'resize-corner': '7c93a03a7b315cc53b0b5362021e351eaf03dbafe73694a284379f5ebb4bfeb6',
    board: '08e73bfd37f6f26b359484d3d52c18eb08da9805e5fde55f4037b36b804ea8ac',
  },
  'windows-95': {
    window: '8dbe0ba341618865170b5f1f3e960791951bfd7e45b4e31a99fc22e7a6813db3',
    'title-bar': 'c8d8baf55d9ddc27dcecb83049e30d4b685aadad4a9dc1a4e5141fef566a2705',
    'menu-strip': '59f96d4781e7a3c267aa8a25fed65fd28ccdbf29d087847c5ba35ee00acb25c9',
    panel: '929325a714bac758fea9ff13a8c1baa57f60d65348efdb9fc4ef56340028ed6f',
    'group-box': 'bd2882c51926e8282c7b5c176765638fd2348c4617b1108670ef0deef6c823ad',
    button: '03af3f380a2c987c1667ce1196c98d78d926a14b1c19175cda3c7c08427c0c71',
    'scrollbar-horizontal': '0368fcc0bae7cdad8a18496df85fbd9ff62532961c1847d958e331fb13f5ee5c',
    'scrollbar-vertical': '36b0ca31ca2e7668aa9d22677ee6d8ea1ed23211851e8ca951565fefe5d9ba80',
    'selection-field': 'f2e587f801141d63f9830f050a419b00e22afa280be73f5487e65c3564fc8820',
    separator: '29ca3d383222da608d5ba4709461f1995779136f6ef1990ad3ea3a0767bf5381',
    'resize-corner': '879edf00fb09ad7ef900d5a7b7f035f078f1a9b0535a5e3632a58cdd74fda7cf',
    board: '61042752c0d537d0159782ad455fee08819a2bc018049dad1aa040c16d8d8c15',
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

  it('matches the exact per-component and complete-board pixel goldens', () => {
    const hashes = renderGoldenHashes();
    if (process.env.UI_SHAPE_PRINT_GOLDENS === '1') {
      console.log(`UI_SHAPE_GOLDENS=${JSON.stringify(hashes)}`);
    }
    expect(hashes).toEqual(GOLDEN_HASHES);
  });
});
