import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

const read = (relativePath: string) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

describe('Goblet embed sizing runtime', () => {
  it('sizes Goblet 1 against the canvas host before falling back to window metrics', () => {
    const runtime = read('public/goblet/goblet.js');

    expect(runtime).toContain('const computeViewportSize = (canvas, fallbackWidth, fallbackHeight) => {');
    expect(runtime).toContain("width: resolveConstrainedAxisSize(canvas, 'width', fallbackWidth)");
    expect(runtime).toContain("height: resolveConstrainedAxisSize(canvas, 'height', fallbackHeight)");
    expect(runtime).toContain('const differsFromCanvas = Math.abs(size - canvasSize) > 1;');
    expect(runtime).toContain('createCanvasStrategy(metadata, canvas, this.options.scale ?? null)');
  });

  it('decodes minified soft-edge mask metadata in the Goblet 1 runtime', () => {
    const runtime = read('public/goblet/goblet.js');
    const inlineRuntime = read('public/goblet/goblet-inline.js');

    expect(runtime).toContain("sem: 'softEdgeMask'");
    expect(inlineRuntime).toContain('sem:"softEdgeMask"');
  });

  it('sizes Goblet 2 against the canvas host before falling back to window metrics', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('const computeViewportSize = (canvas, fallbackWidth, fallbackHeight) => {');
    expect(runtime).toContain("width: resolveConstrainedAxisSize(canvas, 'width', fallbackWidth)");
    expect(runtime).toContain("height: resolveConstrainedAxisSize(canvas, 'height', fallbackHeight)");
    expect(runtime).toContain('const differsFromCanvas = Math.abs(size - canvasSize) > 1;');
    expect(runtime).toContain('createCanvasStrategy(metadata, canvas, this.options.scale ?? null)');
  });

  it('uses the preview canvas host box when computing standalone viewer scale', () => {
    const viewerHtml = read('public/goblet/index.html');

    expect(viewerHtml).toContain('const getViewportBox = () => {');
    expect(viewerHtml).toContain('const viewportBox = getViewportBox();');
    expect(viewerHtml).toContain('viewportBox: getViewportBox()');
  });

  it('keeps semantic text clipped and flowing inside shaped regions in both viewers', () => {
    const goblet1 = read('public/goblet/index.html');
    const goblet2 = read('public/goblet2/index.html');

    for (const viewer of [goblet1, goblet2]) {
      expect(viewer).toContain("shape.regionKind === 'oval'");
      expect(viewer).toContain("shape.regionKind === 'freehand'");
      expect(viewer).toContain('inset.style.shapeOutside = getFlowInsetPath(shape, side);');
      expect(viewer).toContain("box.style.clipPath = 'ellipse(50% 50% at 50% 50%)';");
      expect(viewer).toContain("box.style.wordBreak = 'normal';");
      expect(viewer).toContain("box.style.overflowWrap = 'break-word';");
      expect(viewer).toContain("box.style.boxSizing = 'border-box';");
      expect(viewer).toContain('Number(shape.padding) || 0');
      expect(viewer).toContain("box.dataset.semanticFallback = 'true'");
      expect(viewer).toContain('#vessel-txt-shapes [data-canonical-selected]');
      expect(viewer).toContain('::highlight(vessel-txt-shape-selection)');
      expect(viewer).not.toContain("span.removeAttribute('data-canonical-selected')");
    }
  });

  it('keeps the pixel-only TXT font contract in both semantic mirrors', () => {
    const goblet1 = read('public/goblet/index.html');
    const goblet2 = read('public/goblet2/index.html');

    for (const viewer of [goblet1, goblet2]) {
      expect(viewer).toContain("'mek-sans': { stack: \"'MEK Sans', sans-serif\", minimumSize: 10, sizeStep: 1 }");
      expect(viewer).toContain("'mek-mono': { stack: \"'MEK Mono', monospace\", minimumSize: 12, sizeStep: 1 }");
      expect(viewer).toContain("'jetbrains-mono': { stack: \"'JetBrains Mono', monospace\", minimumSize: 8, sizeStep: 1 }");
      expect(viewer).toContain("'ibm-plex-mono': { stack: \"'IBM Plex Mono', monospace\", minimumSize: 8, sizeStep: 1 }");
      expect(viewer).toContain("minimumSize: 11,\n            sizeStep: 11,\n            nativeSize: 11");
      expect(viewer).toContain("'tiny5': { stack: \"'Tiny5', monospace\", minimumSize: 8, sizeStep: 8, nativeSize: 8 }");
      expect(viewer).toContain("'m3x6': { stack: \"'m3x6', monospace\", minimumSize: 16, sizeStep: 16, nativeSize: 16 }");
      expect(viewer).toContain("'monogram': { stack: \"'Monogram', monospace\", minimumSize: 16, sizeStep: 16, nativeSize: 16 }");
      expect(viewer).toContain("'silkscreen': { stack: \"'Silkscreen', monospace\", minimumSize: 8, sizeStep: 8, nativeSize: 8 }");
      expect(viewer).toContain("'spleen-6x12': { stack: \"'Spleen 6x12', monospace\", minimumSize: 12, sizeStep: 12, nativeSize: 12 }");
      expect(viewer).toContain("stack: \"'Fusion Pixel 8px Mono', monospace\",\n            minimumSize: 8,\n            sizeStep: 8,\n            nativeSize: 8");
      expect(viewer).toContain("const font = textFonts[shape.fontFamily] || textFonts['mek-mono'];");
      expect(viewer).toContain('const rasterSize = font.nativeSize || fontSize;');
      expect(viewer).toContain('const rasterScale = font.nativeSize ? fontSize / font.nativeSize : 1;');
      expect(viewer).toContain('::selection { color: var(--txt-selection-color);');
    }
  });
});
