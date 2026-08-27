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

  it('renders data-only Renderer v1 automation in the Goblet 2 viewer', () => {
    const viewer = read('public/goblet2/index.html');
    const runtime = read('public/goblet2/goblet2.js');

    expect(viewer).toContain('const mountAutomation = (metadata) => {');
    expect(viewer).toContain("source.kind === 'sprite'");
    expect(viewer).toContain('const clips = new Map');
    expect(viewer).toContain('context.clip();');
    expect(viewer).toContain("state.kind === 'rect'");
    expect(viewer).toContain("state.kind === 'cursor'");
    expect(viewer).toContain("right.easing === 'minimum-jerk'");
    expect(viewer).toContain('const setAutomationTime = (seconds) => {');
    expect(viewer).toContain('window.vesselGobletSetAutomationTime = setAutomationTime;');
    expect(viewer).toContain('mountAutomation(current);');
    expect(viewer).toContain('expandVesselMetadata(JSON.parse(text))');
    expect(runtime).toContain("au: 'automation'");
    expect(runtime).toContain("clp: 'clips'");
    expect(runtime).toContain("cid: 'clipId'");
    expect(runtime).toContain("trk: 'tracks'");
    expect(runtime).toContain("kf: 'keyframes'");
  });

  it('keeps shared automation metadata keys decodable in both Goblet runtimes', () => {
    const goblet1 = read('public/goblet/goblet.js');
    const goblet2 = read('public/goblet2/goblet2.js');

    for (const runtime of [goblet1, goblet2]) {
      expect(runtime).toContain("au: 'automation'");
      expect(runtime).toContain("clp: 'clips'");
      expect(runtime).toContain("cid: 'clipId'");
      expect(runtime).toContain("obj: 'objects'");
      expect(runtime).toContain("trk: 'tracks'");
      expect(runtime).toContain("val: 'value'");
    }
  });

  it('uses the preview canvas host box when computing standalone viewer scale', () => {
    const viewerHtml = read('public/goblet/index.html');

    expect(viewerHtml).toContain('const getViewportBox = () => {');
    expect(viewerHtml).toContain('const viewportBox = getViewportBox();');
    expect(viewerHtml).toContain('viewportBox: getViewportBox()');
  });

  it('keeps semantic text stepped, columned, and colour-mapped in both viewers', () => {
    const goblet1 = read('public/goblet/index.html');
    const goblet2 = read('public/goblet2/index.html');

    for (const viewer of [goblet1, goblet2]) {
      expect(viewer).toContain("shape.regionKind === 'oval'");
      expect(viewer).toContain("shape.regionKind === 'freehand'");
      expect(viewer).toContain('inset.style.shapeOutside = getFlowInsetPath(shape, side);');
      expect(viewer).toContain('const lineBlockClipPath = getLineBlockClipPath(shape);');
      expect(viewer).toContain('box.style.clipPath = lineBlockClipPath;');
      expect(viewer).toContain('box.style.columnCount = String(columns);');
      expect(viewer).toContain('const columnGap = columns > 1 ? lineHeight / 2 : 0;');
      expect(viewer).toContain('box.style.columnGap = `${columnGap}px`;');
      expect(viewer).toContain("box.style.columnFill = 'auto';");
      expect(viewer).toContain('const colorRanges = Array.isArray(shape.colorRanges)');
      expect(viewer).toContain("const nonCanonicalState = typeof shape.nonCanonicalState === 'string'");
      expect(viewer).toContain('#preview-canvas {');
      expect(viewer).not.toMatch(/\n\s*canvas\s*\{/);
      expect(viewer).toContain("cell.style.setProperty('--txt-selection-bg'");
      expect(viewer).toContain("cell.style.setProperty('--txt-selection-color', String(shape.selectionColor");
      expect(viewer).toContain('shape.selectionTreatments.forEach((range) => {');
      expect(viewer).toContain('cell.dataset.txtShapeCellStart = String(start);');
      expect(viewer).toContain('cell.dataset.txtShapeCellEnd = String(end);');
      expect(viewer).not.toContain('for (const character of content.slice(start, end))');
      expect(viewer).toContain("cell.dataset.canonicalSelected = 'true';");
      expect(viewer).toContain('const treatment = Array.isArray(shape.selectionTreatments)');
      expect(viewer).toContain('cell.dataset.selectionTreatment = String(treatment);');
      expect(viewer).toContain("treatment === 'overwritten'");
      expect(viewer).toContain("box.style.wordBreak = 'normal';");
      expect(viewer).toContain("box.style.overflowWrap = 'break-word';");
      expect(viewer).toContain("box.style.boxSizing = 'border-box';");
      expect(viewer).toContain('Number(shape.padding) || 0');
      expect(viewer).toContain("box.dataset.semanticFallback = 'true'");
      expect(viewer).toContain('#vessel-txt-shapes [data-canonical-selected]');
      expect(viewer).toContain('[data-vessel-txt-cell-selected="true"]');
      expect(viewer).toContain('[data-selection-treatment="crossed-out"]');
      expect(viewer).toContain('[data-selection-treatment="selected-crossed-out"]');
      expect(viewer).toContain('[data-selection-treatment="overwritten"]');
      expect(viewer).toContain('[data-selection-treatment="erased"]');
      expect(viewer).toContain('[data-selection-treatment="invisible"]');
      expect(viewer).toContain('[data-selection-treatment="invisible-crossed-out"]');
      expect(viewer).toContain('[data-selection-treatment="redacted"]');
      expect(viewer).toContain('[data-selection-treatment="redacted-crossed-out"]');
      expect(viewer).toContain("box.style.setProperty('--txt-base-color'");
      expect(viewer).toContain('cell.dataset.nonCanonicalState = nonCanonicalState;');
      expect(viewer).toContain('cell.dataset.inactiveState = nonCanonicalState;');
      expect(viewer).toContain('visibility: hidden');
      expect(viewer).toContain('[data-inactive-state="none"]');
      expect(viewer).toContain('mask-image: repeating-linear-gradient');
      expect(viewer).toContain('box-shadow: 0 var(--txt-selection-fill-gap, 0px)');
      expect(viewer).toContain('const updateSelectionFillGaps = () => {');
      expect(viewer).toContain("box.style.setProperty('--txt-selection-fill-gap'");
      expect(viewer).toContain('if (document.fonts?.ready)');
      expect(viewer).toContain("overlay.style.position = 'absolute';");
      expect(viewer).toContain("overlay.style.overflow = 'hidden';");
      expect(viewer).toContain('overlay.style.left = `${rect.left + window.scrollX}px`;');
      expect(viewer).toContain('overlay.style.top = `${rect.top + window.scrollY}px`;');
      expect(viewer).toContain("window.addEventListener('resize', position);");
      expect(viewer).toContain("window.removeEventListener('resize', position);");
      expect(viewer).not.toContain('getContrastingColor');
      expect(viewer).not.toContain('::highlight(vessel-txt-shape-selection)');
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
