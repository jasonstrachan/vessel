import type {
  UiShapeComponent,
  UiShapeComponentKind,
  UiShapeComponentState,
  UiShapeTheme,
} from '@/types';
import {
  drawUiShapeComponent,
  UI_SHAPE_THEME_PALETTES,
} from '@/utils/uiShape';

export interface UiShapeComponentReferenceSpec {
  width: number;
  height: number;
  minimumWidth: number;
  minimumHeight: number;
  label?: string;
  canonicalState: UiShapeComponentState;
}

export interface UiShapeReferenceCell {
  kind: UiShapeComponentKind;
  x: number;
  y: number;
  width: number;
  height: number;
  component: UiShapeComponent;
}

export interface UiShapeReferenceBoard {
  width: number;
  height: number;
  cells: UiShapeReferenceCell[];
}

export const UI_SHAPE_REFERENCE_COMPONENT_KINDS: readonly UiShapeComponentKind[] = [
  'window',
  'title-bar',
  'menu-strip',
  'panel',
  'group-box',
  'button',
  'radio-button',
  'scrollbar-horizontal',
  'scrollbar-vertical',
  'selection-field',
  'separator',
  'resize-corner',
  'icon',
] as const;

const common = ({
  scrollbar,
  caption,
  menu,
  buttonHeight,
}: {
  scrollbar: number;
  caption: number;
  menu: number;
  buttonHeight: number;
}): Record<UiShapeComponentKind, UiShapeComponentReferenceSpec> => ({
  window: {
    width: 192,
    height: 128,
    minimumWidth: 96,
    minimumHeight: 64,
    label: 'ADA',
    canonicalState: { active: true, open: true },
  },
  'title-bar': {
    width: 192,
    height: caption,
    minimumWidth: 72,
    minimumHeight: caption,
    label: 'ADA LOVELACE',
    canonicalState: { active: true },
  },
  'menu-strip': {
    width: 192,
    height: menu,
    minimumWidth: 96,
    minimumHeight: menu,
    label: 'FILE EDIT VIEW',
    canonicalState: {},
  },
  panel: {
    width: 160,
    height: 96,
    minimumWidth: 32,
    minimumHeight: 24,
    canonicalState: {},
  },
  'group-box': {
    width: 160,
    height: 72,
    minimumWidth: 64,
    minimumHeight: 32,
    label: 'SYMBOLS',
    canonicalState: {},
  },
  button: {
    width: 75,
    height: buttonHeight,
    minimumWidth: 40,
    minimumHeight: buttonHeight,
    label: 'OK',
    canonicalState: { active: true, pressed: false },
  },
  'radio-button': {
    width: 12,
    height: 12,
    minimumWidth: 12,
    minimumHeight: 12,
    canonicalState: { checked: true },
  },
  'scrollbar-horizontal': {
    width: 160,
    height: scrollbar,
    minimumWidth: scrollbar * 3,
    minimumHeight: scrollbar,
    canonicalState: { pressed: false, value: 0.36 },
  },
  'scrollbar-vertical': {
    width: scrollbar,
    height: 128,
    minimumWidth: scrollbar,
    minimumHeight: scrollbar * 3,
    canonicalState: { pressed: false, value: 0.36 },
  },
  'selection-field': {
    width: 144,
    height: Math.max(20, buttonHeight),
    minimumWidth: 64,
    minimumHeight: Math.max(20, buttonHeight),
    label: 'SELECTED',
    canonicalState: { active: true },
  },
  separator: {
    width: 160,
    height: 2,
    minimumWidth: 24,
    minimumHeight: 2,
    canonicalState: {},
  },
  'resize-corner': {
    width: scrollbar,
    height: scrollbar,
    minimumWidth: scrollbar,
    minimumHeight: scrollbar,
    canonicalState: {},
  },
  icon: {
    width: 32,
    height: 32,
    minimumWidth: 16,
    minimumHeight: 16,
    canonicalState: {},
  },
});

export const UI_SHAPE_REFERENCE_SPECS: Record<
  UiShapeTheme,
  Record<UiShapeComponentKind, UiShapeComponentReferenceSpec>
> = {
  'macintosh-system-1': {
    ...common({ scrollbar: 16, caption: 18, menu: 20, buttonHeight: 20 }),
    button: {
      width: 70,
      height: 20,
      minimumWidth: 40,
      minimumHeight: 20,
      label: 'OK',
      canonicalState: { active: true, pressed: false },
    },
    'selection-field': {
      width: 112,
      height: 20,
      minimumWidth: 56,
      minimumHeight: 20,
      label: 'SELECTED',
      canonicalState: { active: true },
    },
  },
  'windows-3.1': common({ scrollbar: 17, caption: 18, menu: 19, buttonHeight: 23 }),
  'windows-95': common({ scrollbar: 16, caption: 18, menu: 19, buttonHeight: 23 }),
};

export const getUiShapeComponentReferenceSpec = (
  theme: UiShapeTheme,
  kind: UiShapeComponentKind,
): UiShapeComponentReferenceSpec => UI_SHAPE_REFERENCE_SPECS[theme][kind];

const BOARD_COLUMNS = 3;
const CELL_WIDTH = 224;
const CELL_HEIGHT = 160;
const CELL_GAP = 12;
const BOARD_PADDING = 16;

export const createUiShapeReferenceBoard = (theme: UiShapeTheme): UiShapeReferenceBoard => {
  const rows = Math.ceil(UI_SHAPE_REFERENCE_COMPONENT_KINDS.length / BOARD_COLUMNS);
  const cells = UI_SHAPE_REFERENCE_COMPONENT_KINDS.map((kind, index) => {
    const spec = getUiShapeComponentReferenceSpec(theme, kind);
    const column = index % BOARD_COLUMNS;
    const row = Math.floor(index / BOARD_COLUMNS);
    const cellX = BOARD_PADDING + column * (CELL_WIDTH + CELL_GAP);
    const cellY = BOARD_PADDING + row * (CELL_HEIGHT + CELL_GAP);
    const component: UiShapeComponent = {
      id: `reference-${theme}-${kind}`,
      kind,
      x: Math.floor((CELL_WIDTH - spec.width) / 2),
      y: Math.floor((CELL_HEIGHT - spec.height) / 2),
      width: spec.width,
      height: spec.height,
      ...(spec.label ? { label: spec.label } : {}),
      canonicalState: { ...spec.canonicalState },
    };
    return {
      kind,
      x: cellX,
      y: cellY,
      width: CELL_WIDTH,
      height: CELL_HEIGHT,
      component,
    };
  });
  return {
    width: BOARD_PADDING * 2 + BOARD_COLUMNS * CELL_WIDTH + (BOARD_COLUMNS - 1) * CELL_GAP,
    height: BOARD_PADDING * 2 + rows * CELL_HEIGHT + (rows - 1) * CELL_GAP,
    cells,
  };
};

export const drawUiShapeReferenceBoard = (
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  theme: UiShapeTheme,
): UiShapeReferenceBoard => {
  const board = createUiShapeReferenceBoard(theme);
  context.save();
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, board.width, board.height);
  context.fillStyle = '#202020';
  context.fillRect(0, 0, board.width, board.height);
  const palette = UI_SHAPE_THEME_PALETTES[theme];
  board.cells.forEach((cell) => {
    context.fillStyle = '#303030';
    context.fillRect(cell.x, cell.y, cell.width, cell.height);
    drawUiShapeComponent(
      context,
      cell.component,
      cell.x,
      cell.y,
      palette,
      undefined,
      theme,
    );
  });
  context.restore();
  return board;
};
