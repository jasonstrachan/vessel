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
    window: 'ff59205124b16966571e8314ad884bae733b4392192e610a5b53e70b231d48c2',
    'title-bar': '50b4bf5033d0027cd4f27d1ce9955a1bc4d4cab8592b2318284ffc6cc3381ae7',
    'menu-strip': '2088e09b1b224c1b3fc80069c4fd69041327cf2e0579b5876c832018f7ad2cac',
    panel: 'a8a8d4452cadd28011cc49056a52020c905a5b23217c0efdd439c7bcd05ae8a6',
    'group-box': '5e83f67894286fc8cc40cd5db4511f45b306848509ddd394bce7420b20c5d0be',
    button: '8c46727bcd5f91c5a8ef3c06669fce3d13139924cb0b34ec5f4295eed09d7854',
    'radio-button': '344be6ad6b69e90a0b264845587254ed14b25e2a18bf5cabc4211588b60f4906',
    'scrollbar-horizontal': '9fd31edbddb8547c39566c86ffcd8a6c8244a7396ef75e82e0056dbaa493a2ea',
    'scrollbar-vertical': '1ccbc48c606599dc07101044a0579f2ef66076a6b44037199d0010ee6583681a',
    'selection-field': '3d8e17cf566de2c9953940d60457f1a5c472179b94d302b686ef6ac0f2aec91e',
    separator: '02864edacda05f7c46332d4fa90ab9088dd22418eb839f5a081dc97108f830dc',
    'resize-corner': '643e514d8d0b07835de273122d10a3d312fbe9d7d66b9914800cbc60713c9011',
    icon: 'a2ca7ab3eeb2796b9aad5e4edb1299d2d593710b8ec82a0f505eb040076fba5b',
    board: 'cbb06d5c204152a933ccada52a4eadf744af3174619f0b518dbae3f2b3bbe5dc',
  },
  'macintosh-system-7': {
    window: 'ae0868e7373c9d6fa7b19c32cf704319428561aee4a66de62accd04ccc84ffca',
    'title-bar': '980ff420563d55fe1b414137c10ef15044ee0d4c28364a5a641ea5b7bd8b9686',
    'menu-strip': 'df71a1a965ae02e6d9e201c39d9b96b4ce94f3ad5f6cb5bd360d388e1c45823f',
    panel: '857c8c124b72dc09a9048d262cb5baffca264a105be1794371100189e4ce684e',
    'group-box': '90f26b00ca6b28573b3a0c9e7634be9bf6723de43280cca2dc1925f2991b5fda',
    button: '47b0b94921cbb3719aa0f1695b93fe8eb0508b0b2c9bb24c8ec72a9badccf87b',
    'radio-button': '82ece4fdb2136b5c22238967081e6a4bc002b6cbb30c925e164c8824d4011bfa',
    'scrollbar-horizontal': 'c51742cd17c8ca49ad22843cd4bbec837d807606dd0eeb5b2a8b07485c8cf0c3',
    'scrollbar-vertical': 'ea25debbe973f43d3d4a1cf22970d435ac7e1c6a7ac49d18062ad3c8577311dc',
    'selection-field': '7deb8eb85954d759fc86098a6f07ed605f93afad8a4f47d11350bb9fddc5bc0b',
    separator: 'a7f99e564140614e3e2d04222af8d231846f2c59243aab39f34dfbf842ea8093',
    'resize-corner': 'af5ef10938522ee42886607b473836b26e0f9aabdc3c734d3bdb1d190b40b3c5',
    icon: 'd83d3ef7bee3cd9ad4b913be9648b3edda149ac2ea66c83b8b695aaa2330855a',
    board: '18e5d46540594ac8603fe6cdf4977502af3ff676aa3b0b6017218807dd97683e',
  },
  'windows-3.1': {
    window: '7cb8b1f3deeedbcaa2442669e125f253c36ad0de2abe0db5641b7d3468270cc2',
    'title-bar': 'f30a2e5404854b5fa468a357b4c751b8afbb663b6ee35db09623f3d9d38bb9a3',
    'menu-strip': '3fba505b27c29fb14d2b04bc85fd30580ec7782d858f172c246aadfebd257b40',
    panel: 'd79ffc4fb7908c26b949ae77d881371d69b84726b842bc6b33d8632eb5b2ec9a',
    'group-box': '585e31a8427bd9eb0412ae3c4a5c5a4ce3ed706c215499daaf601e79c81b53d3',
    button: '8adbee4086f159841223c051cd71d66e7eb8443dcbced7c12bfb0bc13170beec',
    'radio-button': 'ca2f225ae62fd6627c610e0455e9dceedadb39c649422bd322618d79fb125589',
    'scrollbar-horizontal': '55f36c5749c9794ea46e0e54ce2f5162b794e5885888a50c59b725d09a00d8e3',
    'scrollbar-vertical': '2eccc00e0e59905ceaf799801dcf60e6a32c1510ef5abc3258d16c61ce94fda5',
    'selection-field': '94e4ec91f2cf3463e5cd9fb432d0bf9dd90836aa25ce4437781941a4074efd88',
    separator: 'd32942255ca6da16209eea758460b1aa46cdc51340838fd0c61936302eb294bb',
    'resize-corner': '6a55a39d199c5cb5b27d8944b371c5f929ffe900a8b34cbeb7f688766f8f9872',
    icon: 'd83d3ef7bee3cd9ad4b913be9648b3edda149ac2ea66c83b8b695aaa2330855a',
    board: '49ca80ddd26f78cf8646106f5340240d46308059ca50d59bf1b624583983e0b4',
  },
  'windows-95': {
    window: '67c7bdf15c434f0e436648f861b237d2dc5dea55545c0932496242c8c10c2d98',
    'title-bar': '738ca2285bf9cbc48a181aff3c36b4a8bd556c90df483cd18be2df4e366470c6',
    'menu-strip': '3fba505b27c29fb14d2b04bc85fd30580ec7782d858f172c246aadfebd257b40',
    panel: '1f3da2077a98042984d8b5865369ec2dcea1bed3c00a8461eb3bbf32f30dca2b',
    'group-box': 'fd7c5134939c29ea60e3d63e6d068339a36a3bffaed45c1a35e5820465ae0b9a',
    button: '46f228c1a8df8e33f12571a783c360384677046dad92cec5370205b2be6c00cc',
    'radio-button': '00dd97d0e0889383bcf1b76eeb0833bc287abb1d20dd46ba1882a3317a020c28',
    'scrollbar-horizontal': '2613400aceb66bc924676bb8c3e1bd27e4cca349aab13d8b1afac2386054f667',
    'scrollbar-vertical': '67230213bd21d7f5bd0b9b745ddbad3f1b4634ce46eee27271b7a8bfa2b3fbc2',
    'selection-field': 'aaf436b6a80215a52a311927f4a11a7a3388a05a637abddb8bd65e1be50e2941',
    separator: '29ca3d383222da608d5ba4709461f1995779136f6ef1990ad3ea3a0767bf5381',
    'resize-corner': '9c06f87d8ac6abc909016d496bbf543da210afad124db5af2bc5b084a5698d4a',
    icon: 'd83d3ef7bee3cd9ad4b913be9648b3edda149ac2ea66c83b8b695aaa2330855a',
    board: 'a4aa4eba3cd19883a80984d117eb6404b1c8cfda77a40e153cce6c166bce120a',
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
