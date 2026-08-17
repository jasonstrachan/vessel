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
      expect(viewer).toContain('data-semantic-fallback');
      expect(viewer).toContain("box.dataset.semanticFallback = 'true'");
      expect(viewer).not.toContain("span.removeAttribute('data-canonical-selected')");
    }
  });

  it('keeps bundled TXT font names and minimum sizes in both semantic mirrors', () => {
    const goblet1 = read('public/goblet/index.html');
    const goblet2 = read('public/goblet2/index.html');

    for (const viewer of [goblet1, goblet2]) {
      expect(viewer).toContain("'mek-sans': \"'MEK Sans', sans-serif\"");
      expect(viewer).toContain("'mek-mono': \"'MEK Mono', monospace\"");
      expect(viewer).toContain("'jetbrains-mono': \"'JetBrains Mono', monospace\"");
      expect(viewer).toContain("'ibm-plex-mono': \"'IBM Plex Mono', monospace\"");
      expect(viewer).toContain("'departure-mono': \"'Departure Mono', monospace\"");
      expect(viewer).toContain("const fontMinimumSizes = { 'mek-sans': 8, 'departure-mono': 11 };");
    }
  });
});
