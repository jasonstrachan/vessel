import type { UiShape } from '@/types';
import { drawUiShapeComponent, normalizeUiShapes } from '@/utils/uiShape';
import {
  DEFAULT_UI_SHAPE_ICON_ID,
  drawUiShapeIcon,
  getUiShapeIcon,
  resolveUiShapeIconForSamples,
  UI_SHAPE_ICONS,
} from '@/utils/uiShapeIcons';

const palette = {
  face: '#ff00ff',
  highlight: '#00ffff',
  light: '#ffff00',
  shadow: '#00ff00',
  darkShadow: '#ff0000',
  text: '#0000ff',
  active: '#8844cc',
  activeText: '#44cc88',
  selection: '#cc8844',
  selectionText: '#4488cc',
};

const renderIcon = (iconId: string, componentPalette = palette): Uint8ClampedArray => {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext('2d')!;
  drawUiShapeComponent(context, {
    id: 'icon-component',
    kind: 'icon',
    iconId,
    x: 0,
    y: 0,
    width: 32,
    height: 32,
    canonicalState: {},
  }, 0, 0, componentPalette);
  return context.getImageData(0, 0, 32, 32).data;
};

describe('UI Shape icon catalogue', () => {
  it('combines the curated CC0, System 1, and complete Windows 98 catalogues', () => {
    expect(UI_SHAPE_ICONS).toHaveLength(2_021);
    expect(getUiShapeIcon('mac1-happy-mac')).toEqual(expect.objectContaining({
      label: 'System 1 · Happy Mac',
      width: 32,
      height: 32,
      encoding: 'rle',
    }));
    expect(getUiShapeIcon('win98-ms_dos-1')).toEqual(expect.objectContaining({
      label: 'Win98 · MS DOS 1',
      width: 32,
      height: 32,
      encoding: 'rle',
    }));
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext('2d')!;
    drawUiShapeIcon(context, DEFAULT_UI_SHAPE_ICON_ID, 0, 0, 16, 16);
    expect([...context.getImageData(0, 0, 16, 16).data]
      .some((channel) => channel !== 0)).toBe(true);
  });

  it('contains complete, palette-safe run data for every System 1 icon', () => {
    const macintoshIcons = UI_SHAPE_ICONS.filter((icon) => icon.id.startsWith('mac1-'));
    expect(macintoshIcons).toHaveLength(10);
    macintoshIcons.forEach((icon) => {
      const encoded = Uint8Array.from(
        atob(icon.pixels),
        (character) => character.charCodeAt(0),
      );
      expect(encoded.length % 2).toBe(0);
      let pixels = 0;
      let isPaletteSafe = true;
      for (let index = 0; index < encoded.length; index += 2) {
        pixels += encoded[index]!;
        isPaletteSafe = isPaletteSafe && encoded[index + 1]! < icon.palette.length;
      }
      expect(isPaletteSafe).toBe(true);
      expect(pixels).toBe(icon.width * icon.height);
    });
  });

  it('contains complete, palette-safe run data for every Windows 98 icon', () => {
    const win98Icons = UI_SHAPE_ICONS.filter((icon) => icon.id.startsWith('win98-'));
    expect(win98Icons).toHaveLength(1_757);
    win98Icons.forEach((icon) => {
      const encoded = Uint8Array.from(
        atob(icon.pixels),
        (character) => character.charCodeAt(0),
      );
      expect(encoded.length % 2).toBe(0);
      let pixels = 0;
      let isPaletteSafe = true;
      for (let index = 0; index < encoded.length; index += 2) {
        pixels += encoded[index]!;
        isPaletteSafe = isPaletteSafe && encoded[index + 1]! < icon.palette.length;
      }
      expect(isPaletteSafe).toBe(true);
      expect(pixels).toBe(icon.width * icon.height);
    });
  });

  it('maps distinct sample colours to distinct authored icons by colour and tone', () => {
    const darkBlue = resolveUiShapeIconForSamples(Array(9).fill('#102060'));
    const brightYellow = resolveUiShapeIconForSamples(Array(9).fill('#ffe840'));

    expect(darkBlue).not.toBe(brightYellow);
    expect(getUiShapeIcon(darkBlue).signature.lightness)
      .toBeLessThan(getUiShapeIcon(brightYellow).signature.lightness);
  });

  it('never recolours an icon through the UI Shape palette', () => {
    const alternatePalette = Object.fromEntries(
      Object.keys(palette).map((key) => [key, '#123456']),
    ) as typeof palette;

    expect(renderIcon('folder-yellow16', palette))
      .toEqual(renderIcon('folder-yellow16', alternatePalette));
    expect(renderIcon('mac1-happy-mac', palette))
      .toEqual(renderIcon('mac1-happy-mac', alternatePalette));
    expect(renderIcon('win98-ms_dos-1', palette))
      .toEqual(renderIcon('win98-ms_dos-1', alternatePalette));
  });

  it('normalizes persistent icon ids without changing valid selections', () => {
    const shape: UiShape = {
      id: 'icon-shape',
      layerId: 'layer-1',
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      gridSize: 8,
      theme: 'windows-95',
      drawMode: 'place',
      regionKind: 'rectangle',
      componentKinds: ['icon'],
      colorSource: 'sample',
      palette,
      components: [{
        id: 'icon-component',
        kind: 'icon',
        iconId: 'folder-yellow16',
        x: 0,
        y: 0,
        width: 32,
        height: 32,
        canonicalState: {},
      }],
      createdAt: 1,
      updatedAt: 1,
    };

    const [normalized] = normalizeUiShapes([shape], 32, 32, [{
      id: 'layer-1',
      layerType: 'normal',
      order: 0,
    }]);
    expect(normalized?.componentKinds).toEqual(['icon']);
    expect(normalized?.components[0]?.iconId).toBe('folder-yellow16');
  });
});
