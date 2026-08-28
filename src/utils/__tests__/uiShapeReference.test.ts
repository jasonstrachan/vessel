import { createHash } from 'node:crypto';

import type { UiShapeComponent, UiShapeTheme } from '@/types';
import { drawUiShapeComponent, UI_SHAPE_THEME_PALETTES } from '@/utils/uiShape';
import {
  createUiShapeReferenceBoard,
  drawUiShapeReferenceBoard,
  getUiShapeComponentReferenceSpec,
  UI_SHAPE_REFERENCE_COMPONENT_KINDS,
} from '@/utils/uiShapeReference';

(globalThis as typeof globalThis & {
  __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean;
}).__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true;

const THEMES: readonly UiShapeTheme[] = [
  'macintosh-system-1',
  'macintosh-system-7',
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
        ...(spec.iconId ? { iconId: spec.iconId } : {}),
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
    window: '4fc07fd129a034cffbeefeaaf77f823a5b3e05c79c5dbb1dbac2505c00997249',
    'title-bar': '42d050b6c166c6c1b4bed023e623d0ddbf7f0123c19d484d1944bce65f74d987',
    'menu-strip': '3d4ca5bd08617498b765403c048cf3d8203bc643fec4012755faa845e2ba2707',
    panel: '5ff916fa10c7fe0901cc54213c4fe3b4d5b94a619ac5b59402aa785431ee23bf',
    'group-box': 'b50578246dd5a0c74fcded7c69bce79fc13a3696f1e2953a2f197ea38ded3e43',
    button: '341920e17a788e972f222acd7d0ec6a9ba26f32604e512ffa7142a40bbb19195',
    'radio-button': '77c2bfae0df67803a62425b7a237be4f9d9ce2521a4ca4b2a587e106c16fbfa5',
    'scrollbar-horizontal': '0ef58b46c265e8c3037dddbe33d882801567d90980d716b1dd8136611e520229',
    'scrollbar-vertical': '66ddb207b357930cf6d0fd215ec858b85f1847fb052d1160edb564b1338f7876',
    'selection-field': '1f34384f91cfed1ac4ef6f0cea675eca05e7678f444ad3b5e4f78545c35c5a28',
    separator: 'a9592a7403853c651085f6342e2aedfa069d53c567f352076c762a12f024dfc7',
    'resize-corner': '31cebf8493af368b2cc00db9a976a3d9a70ddf7a78f3d2af5fec762bb36d0957',
    icon: 'a2ca7ab3eeb2796b9aad5e4edb1299d2d593710b8ec82a0f505eb040076fba5b',
    board: '1726da2c63536ba1797a82898255b01472b3da75995ee3dfb9a74b16aa012c63',
  },
  'macintosh-system-7': {
    window: '3d5b750f2920dccacbb68a4abcd2e13b4d483f27845c276b30eaf94a2cda347c',
    'title-bar': 'e3961672617a62e4b2d64ca0348e2796a90439f7e8d2c404b24a88d818ca1191',
    'menu-strip': '21920903b8041999e1c9b3aeb05d16550dc577bba6b88bb0295d7a2fda1632bc',
    panel: '86741e37b2666ff33b6aba4638e7565b31db0281a53463cfed98262b260a5b7f',
    'group-box': '1ad55a7147481f95be9c3e3bc16267b127b2f09614203b0395b72e266a9a5e3e',
    button: '8162cfd707c932b9c5ffa3b2f47d96072f5ab04a9ea601ee83b6313c9568bde7',
    'radio-button': 'e5776c993e462c0a6a8f8779400918123e9f33200084cbb4dd005d8e9e45ae83',
    'scrollbar-horizontal': '7e62fd8647f15b63ab48a9a381ea99ea168a7128157cf95a185cc07c33a5dceb',
    'scrollbar-vertical': '4f19196b23188892c55c8cfd8d202d081f5cff3d88cf6bc841b3d0f06ff30142',
    'selection-field': 'd22ecef6f7db2a88bc3b23705499c5eea66a44a167105fb289e9b421d7d368c7',
    separator: '97a10e02aa57e64cb0050abb374eb8b588c479af0f03a6515561a28e2286c935',
    'resize-corner': '278786b70ae2c7d0cf745c4d60af8e2dbc5c0c966364c988bf46118b8d847d45',
    icon: 'd83d3ef7bee3cd9ad4b913be9648b3edda149ac2ea66c83b8b695aaa2330855a',
    board: '81a79e31179ae98d25ed58ff3679488920ad72c07eedf7f38532101b2fd874ba',
  },
  'windows-3.1': {
    window: '526ed2109b08190a60c57a4ea87267b72beee7e8169b3651907e5ae5eaeea082',
    'title-bar': '5e3351e9a87151a58f9fdeaefd65103eb3ea5071ed2e7abc207381e8cefcb07e',
    'menu-strip': '274132c9d116068a375f95d7e781d6dbbf6bd466dfb6707fb7fa8358fa599c61',
    panel: '98a5079af4ff5ac45a6915882a2360c96bbe007c477b3c6bc8ee30ae08797f32',
    'group-box': 'f94d39f93c12c62f0e0c0d6b9fbaeabeb8027a4a4dcbc3d8b21ea50e5c5eb3dc',
    button: 'e63dec1bc1c300080e7207a4f8bec1344424ea77edf0c77b570d498518d870fe',
    'radio-button': '7f51125ff9cedd3b7c3c31b9536c2b4b8ee6295dcbbefd59d7d084ea1e721962',
    'scrollbar-horizontal': '8b7a5bc71f245905c637912b179403793d772181622947b2f49b0c2ae3e56ab3',
    'scrollbar-vertical': '5887be36cf402c04d6524d8124d2be27c5107f464abb969d22c9c177d01a595d',
    'selection-field': '2257ca02b220de1ab52aa7288cff61e735bccbb30454eec9fc5069aba313beca',
    separator: 'e15fbf03bae5740cd8666d0a1ce7cc60c5108a3bc7f505cd1da004a176a3fe00',
    'resize-corner': 'ac6d77c4f9e57198d715190b86799ee179ff8da058684d48a4a20169de6e5eca',
    icon: 'd83d3ef7bee3cd9ad4b913be9648b3edda149ac2ea66c83b8b695aaa2330855a',
    board: '05eb9113a9c7dca2a99225e7890aae713d50c259a35c9e6c2e2e6cb671675b77',
  },
  'windows-95': {
    window: '4f1c2b1a9dcfbbe4fb495ab29e8c5afecfc999a942861b698b14c4ed3bb8a5d7',
    'title-bar': 'f155c584fa918704b941d4ef577fa39c4b8013b9dffd7d5c43e6ce0a5805330c',
    'menu-strip': '274132c9d116068a375f95d7e781d6dbbf6bd466dfb6707fb7fa8358fa599c61',
    panel: '25da5a410543eb2d56597a0fc268dd78f1eed0a757d4ff2565b36fdb45e6472c',
    'group-box': '3e5fa412e114f9f9b0513b3f8cbce8fee738e74203bc0768e69a96667d9e56bb',
    button: 'e1c36a36f372f8ee1bc6a80eb28a5d73302b848d5c44337904b4d5fc7f332d93',
    'radio-button': '595270284e3c1123a993fbf517047d09398fdd24b059aa14ce7d087a6d1c66b9',
    'scrollbar-horizontal': '06e9b9bb4639ae0e5f413c0293d712ee1d84b210cea38e5d0ba4dbae3ab9f1e2',
    'scrollbar-vertical': '0e8cf503105bbb4095d74dcc89675a6efc98ca8b19a5b56ccd5ccd1430ba5d1d',
    'selection-field': '97398bd8eec4a375c481d04fe5e02a71dbf6e975ea7259efd8338a85997ce1aa',
    separator: 'ba8055069831a0d4c9e6a14e0931af9e30ec9763da598b8aaffb1cdd47c8303c',
    'resize-corner': 'c2f87d5533283485168d5c14e030f46cd6d1023fd582585b85c532023b26fd52',
    icon: 'd83d3ef7bee3cd9ad4b913be9648b3edda149ac2ea66c83b8b695aaa2330855a',
    board: '6c046ed46a6f8616c885132cdec692d88e8410bc8cab1fc804936171f7bc17f4',
  },
};

describe('UI Shape native reference board', () => {
  it('encodes theme-specific native control metrics', () => {
    expect(getUiShapeComponentReferenceSpec('macintosh-system-1', 'scrollbar-vertical').width)
      .toBe(16);
    expect(getUiShapeComponentReferenceSpec('macintosh-system-7', 'title-bar').height).toBe(20);
    expect(getUiShapeComponentReferenceSpec('windows-3.1', 'scrollbar-vertical').width)
      .toBe(17);
    expect(getUiShapeComponentReferenceSpec('windows-95', 'title-bar').height).toBe(18);
    expect(getUiShapeComponentReferenceSpec('windows-95', 'button'))
      .toEqual(expect.objectContaining({ width: 75, height: 23 }));
    expect(getUiShapeComponentReferenceSpec('macintosh-system-1', 'icon').iconId)
      .toBe('mac1-happy-mac');
    THEMES.forEach((theme) => {
      expect(getUiShapeComponentReferenceSpec(theme, 'radio-button')).toEqual(
        expect.objectContaining({
          width: 12,
          height: 12,
          minimumWidth: 12,
          minimumHeight: 12,
          canonicalState: { checked: true },
        }),
      );
    });
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

  it('keeps undersized System 1 grow boxes inside their component bounds', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext('2d')!;
    drawUiShapeComponent(
      context,
      {
        id: 'small-grow-box',
        kind: 'resize-corner',
        x: 0,
        y: 0,
        width: 2,
        height: 2,
        canonicalState: {},
      },
      3,
      3,
      UI_SHAPE_THEME_PALETTES['macintosh-system-1'],
      undefined,
      'macintosh-system-1',
    );

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (x >= 3 && x <= 4 && y >= 3 && y <= 4) continue;
        expect(pixels[(y * canvas.width + x) * 4 + 3]).toBe(0);
      }
    }
  });

  it('matches the exact per-component and complete-board pixel goldens', () => {
    const hashes = renderGoldenHashes();
    if (process.env.UI_SHAPE_PRINT_GOLDENS === '1') {
      console.log(`UI_SHAPE_GOLDENS=${JSON.stringify(hashes)}`);
    }
    expect(hashes).toEqual(GOLDEN_HASHES);
  });
});
