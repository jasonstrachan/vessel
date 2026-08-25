import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from 'playwright/test';

const rootDir = process.cwd();
const read = (relativePath: string): string => fs.readFileSync(
  path.join(rootDir, relativePath),
  'utf8',
);

const PROJECT_WIDTH = 100;
const PROJECT_HEIGHT = 1_200;
const TXT_SHAPE_STATES = [
  'selected',
  'crossed-out',
  'selected-crossed-out',
  'overwritten',
  'erased',
  'invisible',
  'redacted',
  'redacted-crossed-out',
] as const;

const createStateMatrixShape = (
  state: typeof TXT_SHAPE_STATES[number],
  index: number,
) => ({
  id: `state-matrix-non-canonical-${state}`,
  layerId: 'text-layer',
  x: 5,
  y: 980 + index * 10,
  width: 90,
  height: 10,
  padding: 0,
  columns: 1,
  fontFamily: 'tiny5',
  fontSize: 8,
  lineHeight: 1.2,
  textAlign: 'left',
  color: '#000000',
  selectionColor: '#ffffff',
  selectionBackgroundColor: '#000000',
  content: 'AB',
  selections: [{ start: 0, end: 1 }],
  nonCanonicalState: state,
});

const metadata = {
  project: {
    id: 'txt-shape-position',
    name: 'TXT Shape position',
    width: PROJECT_WIDTH,
    height: PROJECT_HEIGHT,
    backgroundColor: '#00000000',
  },
  viewport: {
    mode: 'fixed',
    designWidth: PROJECT_WIDTH,
    designHeight: PROJECT_HEIGHT,
  },
  settings: {
    viewportPreset: 'fixed-canvas',
  },
  layers: [{
    id: 'text-layer',
    name: 'Text layer',
    type: 'normal',
    visible: true,
  }],
  textShapes: [{
    id: 'text-shape',
    layerId: 'text-layer',
    x: 5,
    y: 6,
    width: 90,
    height: 1_180,
    padding: 2,
    columns: 3,
    fontFamily: 'tiny5',
    fontSize: 8,
    lineHeight: 1.2,
    textAlign: 'left',
    color: '#000000',
    selectionColor: '#ffffff',
    selectionBackgroundColor: '#000000',
    content: 'STATE A: semantic overlay',
    unmappedTextCoverage: 0,
    unmappedWordOrder: [18, 6, 9, 0],
    selections: [
      { start: 0, end: 5 },
      { start: 9, end: 17 },
    ],
    selectionTreatments: [
      { start: 0, end: 5, treatment: 'selected-crossed-out' },
      { start: 9, end: 17, treatment: 'redacted' },
    ],
  }, {
    id: 'canonical-state-matrix',
    layerId: 'text-layer',
    x: 5,
    y: 950,
    width: 90,
    height: 10,
    padding: 0,
    columns: 1,
    fontFamily: 'tiny5',
    fontSize: 8,
    lineHeight: 1.2,
    textAlign: 'left',
    color: '#000000',
    selectionColor: '#ffffff',
    selectionBackgroundColor: '#000000',
    content: 'ABCDEFGH',
    selections: [{ start: 0, end: 8 }],
    nonCanonicalState: 'crossed-out',
    selectionTreatments: TXT_SHAPE_STATES.flatMap((state, index) => (
      state === 'selected'
        ? []
        : [{ start: index, end: index + 1, treatment: state }]
    )),
  }, ...TXT_SHAPE_STATES.map(createStateMatrixShape), {
    id: 'non-canonical-invisible',
    layerId: 'text-layer',
    x: 5,
    y: 1_100,
    width: 90,
    height: 40,
    padding: 0,
    columns: 1,
    fontFamily: 'tiny5',
    fontSize: 8,
    lineHeight: 1.2,
    textAlign: 'left',
    color: '#000000',
    selectionColor: '#ffffff',
    selectionBackgroundColor: '#000000',
    content: 'SHOW HIDE',
    selections: [{ start: 0, end: 4 }],
    nonCanonicalState: 'invisible',
  }, {
    id: 'bottom-left-overflow',
    layerId: 'text-layer',
    x: -20,
    y: 1_180,
    width: 40,
    height: 40,
    padding: 0,
    columns: 1,
    fontFamily: 'tiny5',
    fontSize: 8,
    lineHeight: 1.2,
    textAlign: 'left',
    color: '#000000',
    selectionColor: '#ffffff',
    selectionBackgroundColor: '#000000',
    content: 'CLIPPED',
    selections: [{ start: 0, end: 7 }],
  }],
};

const runtimeStub = `
export const debugLog = () => {};
export const isGobletDiagnosticsEnabled = () => false;
export const setGobletDiagnosticsEnabled = () => {};
export const resizeVesselWebGL = () => null;
export const renderVesselWebGL = async (metadata, canvas) => {
  const width = Math.max(1, Number(metadata.project?.width) || 1);
  const height = Math.max(1, Number(metadata.project?.height) || 1);
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  return {};
};
`;

const viewers = [
  {
    name: 'Goblet 1',
    path: 'public/goblet/index.html',
    url: 'http://goblet-txt-shape-position.test/goblet/index.html',
    runtimeUrl: 'http://goblet-txt-shape-position.test/goblet/goblet.js',
  },
  {
    name: 'Goblet 2',
    path: 'public/goblet2/index.html',
    url: 'http://goblet-txt-shape-position.test/goblet2/index.html',
    runtimeUrl: 'http://goblet-txt-shape-position.test/goblet2/goblet2.js',
  },
] as const;

const buildViewerHtml = (viewerPath: string): string => {
  const viewer = read(viewerPath);
  const marker = 'setStatus(readyMessage);';
  if (!viewer.includes(marker)) {
    throw new Error(`${viewerPath} is missing its ready marker`);
  }
  return viewer.replace(
    marker,
    `${marker}\n      await drawMetadata(${JSON.stringify(metadata)});`,
  );
};

const readCanvasOverlayDelta = async (page: Page) => page.evaluate(() => {
  const canvas = document.getElementById('preview-canvas');
  const overlay = document.getElementById('vessel-txt-shapes');
  if (!(canvas instanceof HTMLCanvasElement) || !(overlay instanceof HTMLElement)) {
    return null;
  }
  const canvasRect = canvas.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  return {
    x: overlayRect.x - canvasRect.x,
    y: overlayRect.y - canvasRect.y,
    width: overlayRect.width - canvasRect.width,
    height: overlayRect.height - canvasRect.height,
  };
});

const readTxtShapeColumnGap = async (page: Page) => page.evaluate(() => {
  const shape = document.querySelector('[data-txt-shape-id="text-shape"]');
  return shape instanceof HTMLElement ? getComputedStyle(shape).columnGap : null;
});

const readSelectionTreatments = async (page: Page) => page.evaluate(() => {
  const cells = Array.from(document.querySelectorAll<HTMLElement>(
    '[data-txt-shape-id="text-shape"] [data-selection-treatment]',
  ));
  const selectedCrossedOut = cells.filter(
    (cell) => cell.dataset.selectionTreatment === 'selected-crossed-out',
  );
  const redacted = cells.filter(
    (cell) => cell.dataset.selectionTreatment === 'redacted',
  );
  return {
    selectedCrossedOutText: selectedCrossedOut.map((cell) => cell.textContent).join(''),
    selectedCrossedOutDecoration: selectedCrossedOut[0]
      ? getComputedStyle(selectedCrossedOut[0]).textDecorationLine
      : null,
    selectedCrossedOutBackground: selectedCrossedOut[0]
      ? getComputedStyle(selectedCrossedOut[0]).backgroundColor
      : null,
    selectedCrossedOutColor: selectedCrossedOut[0]
      ? getComputedStyle(selectedCrossedOut[0]).color
      : null,
    redactedText: redacted.map((cell) => cell.textContent).join(''),
    redactedColor: redacted[0] ? getComputedStyle(redacted[0]).color : null,
    allCanonical: cells.every((cell) => cell.dataset.canonicalSelected === 'true'),
  };
});

const readUnmappedText = async (page: Page) => page.evaluate(() => {
  const shape = document.querySelector<HTMLElement>('[data-txt-shape-id="text-shape"]');
  const hidden = Array.from(shape?.querySelectorAll<HTMLElement>(
    '[data-unmapped-hidden="true"]',
  ) ?? []);
  return {
    completeText: shape?.textContent ?? null,
    hiddenText: hidden.map((span) => span.textContent).join(''),
    hiddenColors: hidden.map((span) => getComputedStyle(span).color),
  };
});

const readNonCanonicalInvisibleText = async (page: Page) => page.evaluate(() => {
  const shape = document.querySelector<HTMLElement>(
    '[data-txt-shape-id="non-canonical-invisible"]',
  );
  const invisible = Array.from(shape?.querySelectorAll<HTMLElement>(
    '[data-non-canonical-state="invisible"]',
  ) ?? []);
  return {
    completeText: shape?.textContent ?? null,
    invisibleText: invisible.map((cell) => cell.textContent).join(''),
    visibility: invisible.map((cell) => getComputedStyle(cell).visibility),
  };
});

const readStateMatrix = async (page: Page) => page.evaluate(() => {
  const states = [
    'selected',
    'crossed-out',
    'selected-crossed-out',
    'overwritten',
    'erased',
    'invisible',
    'redacted',
    'redacted-crossed-out',
  ];
  const readCell = (cell: HTMLElement | null) => {
    if (!cell) return null;
    const style = getComputedStyle(cell);
    return {
      background: style.backgroundColor,
      color: style.color,
      decoration: style.textDecorationLine,
      mask: style.maskImage,
      opacity: style.opacity,
      treatment: cell.dataset.selectionTreatment ?? null,
      visibility: style.visibility,
    };
  };
  const canonicalShape = document.querySelector<HTMLElement>(
    '[data-txt-shape-id="canonical-state-matrix"]',
  );
  const canonical = Object.fromEntries(states.map((state, index) => [
    state,
    readCell(canonicalShape?.querySelector<HTMLElement>(
      `[data-txt-shape-cell-start="${index}"]`,
    ) ?? null),
  ]));
  const nonCanonical = Object.fromEntries(states.map((state) => [
    state,
    readCell(document.querySelector<HTMLElement>(
      `[data-txt-shape-id="state-matrix-non-canonical-${state}"] [data-non-canonical-state]`,
    )),
  ]));
  return { canonical, nonCanonical };
});

const readCanonicalInvisibleInactiveState = async (page: Page) => page.evaluate(() => {
  const cell = document.querySelector<HTMLElement>(
    '[data-txt-shape-id="canonical-state-matrix"] [data-txt-shape-cell-start="5"]',
  );
  if (!cell) return null;
  delete cell.dataset.canonicalSelected;
  const style = getComputedStyle(cell);
  return {
    background: style.backgroundColor,
    color: style.color,
    decoration: style.textDecorationLine,
    inactiveState: cell.dataset.inactiveState ?? null,
    visibility: style.visibility,
  };
});

const expectedStateMatrix = {
  selected: {
    background: 'rgb(0, 0, 0)',
    color: 'rgb(255, 255, 255)',
    decoration: 'none',
    mask: 'none',
    opacity: '1',
    treatment: null,
    visibility: 'visible',
  },
  'crossed-out': {
    background: 'rgba(0, 0, 0, 0)',
    color: 'rgb(0, 0, 0)',
    decoration: 'line-through',
    mask: 'none',
    opacity: '1',
    treatment: 'crossed-out',
    visibility: 'visible',
  },
  'selected-crossed-out': {
    background: 'rgb(0, 0, 0)',
    color: 'rgb(255, 255, 255)',
    decoration: 'line-through',
    mask: 'none',
    opacity: '1',
    treatment: 'selected-crossed-out',
    visibility: 'visible',
  },
  overwritten: {
    background: 'rgba(0, 0, 0, 0)',
    color: 'rgb(0, 0, 0)',
    decoration: 'none',
    mask: 'none',
    opacity: '1',
    treatment: 'overwritten',
    visibility: 'visible',
  },
  erased: {
    background: 'rgba(0, 0, 0, 0)',
    color: 'rgb(0, 0, 0)',
    decoration: 'none',
    mask: expect.stringContaining('repeating-linear-gradient'),
    opacity: '0.38',
    treatment: 'erased',
    visibility: 'visible',
  },
  invisible: {
    background: 'rgba(0, 0, 0, 0)',
    color: 'rgba(0, 0, 0, 0)',
    decoration: 'none',
    mask: 'none',
    opacity: '1',
    treatment: 'invisible',
    visibility: 'hidden',
  },
  redacted: {
    background: 'rgb(0, 0, 0)',
    color: 'rgba(0, 0, 0, 0)',
    decoration: 'none',
    mask: 'none',
    opacity: '1',
    treatment: 'redacted',
    visibility: 'visible',
  },
  'redacted-crossed-out': {
    background: 'rgb(0, 0, 0)',
    color: 'rgba(0, 0, 0, 0)',
    decoration: 'line-through',
    mask: 'none',
    opacity: '1',
    treatment: 'redacted-crossed-out',
    visibility: 'visible',
  },
};

const readBottomLeftClip = async (page: Page) => page.evaluate(() => {
  const canvas = document.getElementById('preview-canvas');
  const overlay = document.getElementById('vessel-txt-shapes');
  const shape = document.querySelector('[data-txt-shape-id="bottom-left-overflow"]');
  if (!(canvas instanceof HTMLCanvasElement)
    || !(overlay instanceof HTMLElement)
    || !(shape instanceof HTMLElement)) {
    return null;
  }
  const canvasRect = canvas.getBoundingClientRect();
  const shapeRect = shape.getBoundingClientRect();
  const hitsShape = (x: number, y: number): boolean => document.elementsFromPoint(x, y)
    .some((element) => element.closest?.('[data-txt-shape-id="bottom-left-overflow"]'));
  return {
    overflow: getComputedStyle(overlay).overflow,
    crossesLeft: shapeRect.left < canvasRect.left,
    crossesBottom: shapeRect.bottom > canvasRect.bottom,
    hitsInsideCanvas: hitsShape(canvasRect.left + 5, canvasRect.bottom - 5),
    hitsOutsideCanvas: hitsShape(canvasRect.left - 5, canvasRect.bottom + 5),
  };
});

test.describe('Goblet TXT Shape overlay positioning and layout', () => {
  for (const viewer of viewers) {
    test(`${viewer.name} matches Vessel columns after recenter and scroll`, async ({ page }) => {
      await page.route(viewer.runtimeUrl, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/javascript',
          body: runtimeStub,
        });
      });
      await page.route(viewer.url, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: buildViewerHtml(viewer.path),
        });
      });

      await page.setViewportSize({ width: 1_280, height: 1_400 });
      await page.goto(viewer.url, { waitUntil: 'load' });
      await page.waitForSelector('#vessel-txt-shapes');
      await expect.poll(() => readTxtShapeColumnGap(page)).toBe('5px');
      await expect.poll(() => readSelectionTreatments(page)).toEqual({
        selectedCrossedOutText: 'STATE',
        selectedCrossedOutDecoration: 'line-through',
        selectedCrossedOutBackground: 'rgb(0, 0, 0)',
        selectedCrossedOutColor: 'rgb(255, 255, 255)',
        redactedText: 'semantic',
        redactedColor: 'rgba(0, 0, 0, 0)',
        allCanonical: true,
      });
      await expect.poll(() => readUnmappedText(page)).toEqual({
        completeText: 'STATE A: semantic overlay',
        hiddenText: 'A:overlay',
        hiddenColors: ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'],
      });
      await expect.poll(() => readNonCanonicalInvisibleText(page)).toEqual({
        completeText: 'SHOW HIDE',
        invisibleText: ' HIDE',
        visibility: ['hidden', 'hidden', 'hidden', 'hidden', 'hidden'],
      });
      await expect.poll(() => readStateMatrix(page)).toEqual({
        canonical: expectedStateMatrix,
        nonCanonical: expectedStateMatrix,
      });
      await expect.poll(() => readCanonicalInvisibleInactiveState(page)).toEqual({
        background: 'rgba(0, 0, 0, 0)',
        color: 'rgb(0, 0, 0)',
        decoration: 'line-through',
        inactiveState: 'crossed-out',
        visibility: 'visible',
      });
      await expect.poll(() => readCanvasOverlayDelta(page)).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
      await expect.poll(() => readBottomLeftClip(page)).toEqual({
        overflow: 'hidden',
        crossesLeft: true,
        crossesBottom: true,
        hitsInsideCanvas: true,
        hitsOutsideCanvas: false,
      });

      await page.setViewportSize({ width: 1_280, height: 1_000 });
      await expect.poll(() => readCanvasOverlayDelta(page)).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });

      await page.evaluate(() => window.scrollTo(0, 150));
      await expect.poll(() => readCanvasOverlayDelta(page)).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
    });
  }
});
