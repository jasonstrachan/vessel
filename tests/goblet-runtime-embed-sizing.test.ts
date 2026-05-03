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
});
