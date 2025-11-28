import { BrushRegistry } from '@/brushes/BrushRegistry';
import { DitherBrushPlugin, ParticleBrushPlugin, SpamBrushPlugin } from '@/brushes/plugins';

const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

afterAll(() => {
  consoleLogSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

describe('Builtin brush metadata', () => {
  it('remains stable for default plugins', () => {
    const metadata = [
      new DitherBrushPlugin().metadata,
      new ParticleBrushPlugin().metadata,
      new SpamBrushPlugin().metadata,
    ];

    expect(metadata).toMatchInlineSnapshot(`
[
  {
    "author": "Vessel Team",
    "category": "Artistic",
    "description": "Creates retro dithered drawing effects with various algorithms",
    "id": "dither-brush",
    "name": "Dither Brush",
    "tags": [
      "dither",
      "retro",
      "pixel",
      "artistic",
    ],
    "version": "1.0.0",
  },
  {
    "author": "Vessel Team",
    "category": "Artistic",
    "description": "Scatters particles for spray paint and texture effects",
    "id": "particle-brush",
    "name": "Particle Brush",
    "tags": [
      "particle",
      "spray",
      "texture",
      "scatter",
    ],
    "version": "1.0.0",
  },
  {
    "author": "Vessel Team",
    "category": "Text",
    "description": "Paint with spam email text in fixed-width fonts",
    "id": "spam-brush",
    "name": "Spam Text",
    "tags": [
      "spam",
      "text",
      "typography",
      "artistic",
    ],
    "version": "1.0.0",
  },
]
`);
  });
});

describe('BrushRegistry', () => {
  it('registers and activates all builtin brushes', async () => {
    const registry = new BrushRegistry();
    await registry.loadAllBuiltinBrushes();

    const registeredIds = registry
      .getAll()
      .map((brush) => brush.id)
      .sort();

    expect(registeredIds).toEqual([
      'dither-brush',
      'particle-brush',
      'spam-brush',
    ]);

    const activated = registry.activate('particle-brush');
    expect(activated?.id).toBe('particle-brush');
    expect(registry.isActive('particle-brush')).toBe(true);

    registry.clear();
    expect(registry.getAll()).toHaveLength(0);
  });
});
