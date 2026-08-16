'use client';

import React from 'react';

import { useAppStore } from '@/stores/useAppStore';
import type { TxtShape } from '@/types';
import {
  getContrastingTxtColor,
  getTxtShapeFontStack,
  normalizeTxtShapeSelections,
  splitTxtShapeSegments,
  TXT_SHAPE_DEFAULT_CONTENT,
  TXT_SHAPE_MIN_SIZE,
} from '@/utils/txtShape';

interface TxtShapeOverlayProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

type Gesture = {
  kind: 'create' | 'move' | 'resize';
  pointerId: number;
  start: { x: number; y: number };
  shapeId?: string;
  original?: TxtShape;
};

type ShapePreview = {
  shapeId: string;
  patch: Partial<TxtShape>;
};

const getSelectionOffsets = (root: HTMLElement): { start: number; end: number } | null => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.anchorNode || !selection.focusNode) {
    return null;
  }
  if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
    return null;
  }
  const offsetTo = (node: Node, offset: number) => {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    return range.toString().length;
  };
  const anchor = offsetTo(selection.anchorNode, selection.anchorOffset);
  const focus = offsetTo(selection.focusNode, selection.focusOffset);
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
};

const getTextPoint = (root: HTMLElement, offset: number): { node: Node; offset: number } | null => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) {
      return { node, offset: remaining };
    }
    remaining -= length;
    node = walker.nextNode();
  }
  return null;
};

const readSampleColor = (
  canvas: HTMLCanvasElement | null,
  x: number,
  y: number,
): string | null => {
  const ctx = canvas?.getContext('2d', { willReadFrequently: true });
  if (!canvas || !ctx || canvas.width < 1 || canvas.height < 1) return null;
  try {
    const pixel = ctx.getImageData(
      Math.max(0, Math.min(canvas.width - 1, Math.floor(x))),
      Math.max(0, Math.min(canvas.height - 1, Math.floor(y))),
      1,
      1,
    ).data;
    return `#${[pixel[0], pixel[1], pixel[2]]
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')}`;
  } catch {
    return null;
  }
};

const getWorldPoint = (
  event: React.PointerEvent<HTMLElement>,
  projectWidth: number,
  projectHeight: number,
) => {
  const root = event.currentTarget.closest<HTMLElement>('[data-testid="txt-shape-overlay"]')
    ?? event.currentTarget;
  const rect = root.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(projectWidth, ((event.clientX - rect.left) / rect.width) * projectWidth)),
    y: Math.max(0, Math.min(projectHeight, ((event.clientY - rect.top) / rect.height) * projectHeight)),
  };
};

const patchShape = (shapes: readonly TxtShape[], id: string, patch: Partial<TxtShape>): TxtShape[] =>
  shapes.map((shape) => shape.id === id ? { ...shape, ...patch, updatedAt: Date.now() } : shape);

const areSelectionsEqual = (
  left: readonly TxtShape['selections'][number][],
  right: readonly TxtShape['selections'][number][],
): boolean => left.length === right.length && left.every(
  (range, index) => range.start === right[index]?.start && range.end === right[index]?.end,
);

interface EditableTxtShapeTextProps {
  shape: TxtShape;
  style: React.CSSProperties;
  onContentChange: (content: string) => void;
  onSelectionChange: (range: { start: number; end: number }) => void;
}

const EditableTxtShapeText = ({
  shape,
  style,
  onContentChange,
  onSelectionChange,
}: EditableTxtShapeTextProps) => {
  const editorRef = React.useRef<HTMLDivElement>(null);
  const selectionStart = shape.selections[0]?.start;
  const selectionEnd = shape.selections[0]?.end;

  const restoreSelection = React.useCallback(() => {
    const editor = editorRef.current;
    if (!editor || selectionStart === undefined || selectionEnd === undefined || !editor.firstChild) return;
    const start = Math.min(selectionStart, editor.textContent?.length ?? 0);
    const end = Math.min(selectionEnd, editor.textContent?.length ?? 0);
    const startPoint = getTextPoint(editor, start);
    const endPoint = getTextPoint(editor, end);
    if (!startPoint || !endPoint) return;
    editor.focus({ preventScroll: true });
    const range = document.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [selectionEnd, selectionStart]);

  React.useLayoutEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.textContent !== shape.content) {
      editor.textContent = shape.content;
      restoreSelection();
    }
  }, [restoreSelection, shape.content]);

  React.useLayoutEffect(() => {
    restoreSelection();
  }, [restoreSelection, shape.id]);

  return (
    <div
      ref={editorRef}
      className="txt-shape-text h-full w-full overflow-hidden whitespace-pre-wrap break-all outline-none"
      style={style}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      aria-label="TXT Shape text"
      onInput={(event) => onContentChange(
        (event.currentTarget.textContent ?? '').slice(0, 20_000),
      )}
      onPointerUp={(event) => {
        event.stopPropagation();
        const range = getSelectionOffsets(event.currentTarget);
        if (range && range.start !== range.end) {
          onSelectionChange(range);
        }
      }}
    />
  );
};

export const TxtShapeOverlay = ({ canvasRef, zoom, offsetX, offsetY }: TxtShapeOverlayProps) => {
  const project = useAppStore((state) => state.project);
  const updateProject = useAppStore((state) => state.updateProject);
  const currentPresetId = useAppStore((state) => state.currentBrushPreset?.id ?? null);
  const settings = useAppStore((state) => state.tools.brushSettings);
  const palette = useAppStore((state) => state.palette);
  const setBrushSettings = useAppStore((state) => state.setBrushSettings);
  const setGlobalBrushSize = useAppStore((state) => state.setGlobalBrushSize);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [gesture, setGesture] = React.useState<Gesture | null>(null);
  const [preview, setPreview] = React.useState<ShapePreview | null>(null);
  const isActive = currentPresetId === 'txt-shape';
  const shapes = React.useMemo(() => project?.txtShapes ?? [], [project?.txtShapes]);
  const selectedShape = shapes.find((shape) => shape.id === selectedId) ?? null;

  const commitShapes = React.useCallback((nextShapes: TxtShape[]) => {
    updateProject({ txtShapes: nextShapes, updatedAt: new Date() });
  }, [updateProject]);

  React.useEffect(() => {
    if (!selectedShape || !isActive) return;
    const content = settings.txtContent ?? selectedShape.content;
    const patch: Partial<TxtShape> = {
      content,
      fontFamily: settings.txtFontFamily ?? selectedShape.fontFamily,
      fontSize: settings.size,
      textAlign: settings.txtTextAlign ?? selectedShape.textAlign,
      colorSource: settings.txtColorSource ?? selectedShape.colorSource,
      color: settings.txtColor ?? selectedShape.color,
      selectionColor: settings.txtSelectionColor ?? selectedShape.selectionColor,
      selectionBackgroundColor:
        settings.txtSelectionBackgroundColor ?? selectedShape.selectionBackgroundColor,
      selections: normalizeTxtShapeSelections(selectedShape.selections, content.length),
    };
    const didChange = Object.entries(patch).some(([key, value]) => {
      if (key === 'selections') {
        return !areSelectionsEqual(
          selectedShape.selections,
          value as TxtShape['selections'],
        );
      }
      return selectedShape[key as keyof TxtShape] !== value;
    });
    if (didChange) {
      commitShapes(patchShape(shapes, selectedShape.id, patch));
    }
  }, [
    commitShapes,
    isActive,
    selectedShape,
    settings.size,
    settings.txtColor,
    settings.txtColorSource,
    settings.txtContent,
    settings.txtFontFamily,
    settings.txtSelectionBackgroundColor,
    settings.txtSelectionColor,
    settings.txtTextAlign,
    shapes,
  ]);

  if (!project) return null;

  const selectShape = (shape: TxtShape) => {
    setSelectedId(shape.id);
    setGlobalBrushSize(shape.fontSize);
    setBrushSettings({
      txtContent: shape.content,
      txtFontFamily: shape.fontFamily,
      txtTextAlign: shape.textAlign,
      txtColorSource: shape.colorSource,
      txtColor: shape.color,
      txtSelectionColor: shape.selectionColor,
      txtSelectionBackgroundColor: shape.selectionBackgroundColor,
    });
  };

  const beginGesture = (
    event: React.PointerEvent<HTMLDivElement>,
    nextGesture: Omit<Gesture, 'pointerId'>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({ ...nextGesture, pointerId: event.pointerId });
    setPreview(null);
  };

  const handleBackgroundPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isActive || event.target !== event.currentTarget) return;
    const point = getWorldPoint(event, project.width, project.height);
    setSelectedId(null);
    beginGesture(event, { kind: 'create', start: point });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const point = getWorldPoint(event, project.width, project.height);
    if (gesture.kind === 'create') {
      if (Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) < 4) {
        setPreview(null);
        return;
      }
      const x = Math.min(gesture.start.x, point.x);
      const y = Math.min(gesture.start.y, point.y);
      setPreview({
        shapeId: '__draft__',
        patch: {
          x,
          y,
          width: Math.max(TXT_SHAPE_MIN_SIZE, Math.abs(point.x - gesture.start.x)),
          height: Math.max(TXT_SHAPE_MIN_SIZE, Math.abs(point.y - gesture.start.y)),
        },
      });
      return;
    }
    if (!gesture.shapeId || !gesture.original) return;
    if (gesture.kind === 'move') {
      setPreview({
        shapeId: gesture.shapeId,
        patch: {
          x: Math.max(0, Math.min(project.width - gesture.original.width, gesture.original.x + point.x - gesture.start.x)),
          y: Math.max(0, Math.min(project.height - gesture.original.height, gesture.original.y + point.y - gesture.start.y)),
        },
      });
    } else {
      setPreview({
        shapeId: gesture.shapeId,
        patch: {
          width: Math.max(TXT_SHAPE_MIN_SIZE, Math.min(project.width - gesture.original.x, gesture.original.width + point.x - gesture.start.x)),
          height: Math.max(TXT_SHAPE_MIN_SIZE, Math.min(project.height - gesture.original.y, gesture.original.height + point.y - gesture.start.y)),
        },
      });
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (gesture.kind === 'create' && preview?.shapeId === '__draft__') {
      const content = settings.txtContent?.length ? settings.txtContent : TXT_SHAPE_DEFAULT_CONTENT;
      const source = settings.txtColorSource ?? 'palette';
      const sample = source === 'sample'
        ? readSampleColor(
            canvasRef.current,
            finiteNumber(preview.patch.x) + finiteNumber(preview.patch.width) / 2,
            finiteNumber(preview.patch.y) + finiteNumber(preview.patch.height) / 2,
          )
        : null;
      const color = source === 'manual'
        ? settings.txtColor ?? palette.foregroundColor
        : sample ?? palette.foregroundColor;
      const selectionBackgroundColor = source === 'manual'
        ? settings.txtSelectionBackgroundColor ?? palette.backgroundColor
        : sample ?? (source === 'palette' ? palette.backgroundColor : palette.foregroundColor);
      const selectionColor = source === 'manual'
        ? settings.txtSelectionColor ?? getContrastingTxtColor(selectionBackgroundColor)
        : source === 'palette'
          ? palette.foregroundColor
          : getContrastingTxtColor(selectionBackgroundColor);
      const now = Date.now();
      const shape: TxtShape = {
        id: `txt-shape-${now}-${Math.random().toString(36).slice(2, 8)}`,
        x: finiteNumber(preview.patch.x),
        y: finiteNumber(preview.patch.y),
        width: finiteNumber(preview.patch.width, 160),
        height: finiteNumber(preview.patch.height, 80),
        content,
        fontFamily: settings.txtFontFamily ?? 'monospace',
        fontSize: settings.size,
        lineHeight: 1.2,
        textAlign: settings.txtTextAlign ?? 'left',
        colorSource: source,
        color,
        selectionColor,
        selectionBackgroundColor,
        selections: content.length ? [{ start: 0, end: content.length }] : [],
        createdAt: now,
        updatedAt: now,
      };
      commitShapes([...shapes, shape]);
      selectShape(shape);
    } else if (preview && preview.shapeId !== '__draft__') {
      commitShapes(patchShape(shapes, preview.shapeId, preview.patch));
    }
    setGesture(null);
    setPreview(null);
  };

  const draft = preview?.shapeId === '__draft__' ? preview.patch : null;

  return (
    <div
      className="absolute z-[800]"
      style={{
        left: offsetX,
        top: offsetY,
        width: project.width,
        height: project.height,
        transform: `scale(${zoom || 1})`,
        transformOrigin: 'top left',
        pointerEvents: isActive ? 'auto' : 'none',
      }}
      data-testid="txt-shape-overlay"
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        setGesture(null);
        setPreview(null);
      }}
    >
      {shapes.map((storedShape) => {
        const shape = preview?.shapeId === storedShape.id
          ? { ...storedShape, ...preview.patch }
          : storedShape;
        const isSelected = isActive && selectedId === shape.id;
        const textStyle: React.CSSProperties = {
          color: shape.color,
          fontFamily: getTxtShapeFontStack(shape.fontFamily),
          fontSize: shape.fontSize,
          lineHeight: shape.lineHeight,
          textAlign: shape.textAlign,
          userSelect: 'text',
          cursor: isActive ? 'text' : 'default',
          '--txt-selection-color': shape.selectionColor,
          '--txt-selection-bg': shape.selectionBackgroundColor,
        } as React.CSSProperties;
        return (
          <div
            key={shape.id}
            className="absolute"
            style={{
              left: shape.x,
              top: shape.y,
              width: shape.width,
              height: shape.height,
              outline: isSelected ? `${1 / Math.max(zoom, 0.01)}px solid #52e5ff` : 'none',
              pointerEvents: isActive ? 'auto' : 'none',
            }}
            data-txt-shape-id={shape.id}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (!isSelected) selectShape(storedShape);
            }}
          >
            {isSelected ? (
              <EditableTxtShapeText
                shape={shape}
                style={textStyle}
                onContentChange={(content) => {
                  commitShapes(patchShape(shapes, shape.id, {
                    content,
                    selections: normalizeTxtShapeSelections(shape.selections, content.length),
                  }));
                  setBrushSettings({ txtContent: content });
                }}
                onSelectionChange={(range) => {
                  commitShapes(patchShape(shapes, shape.id, {
                    selections: normalizeTxtShapeSelections([range], shape.content.length),
                  }));
                }}
              />
            ) : (
              <div
                className="txt-shape-text h-full w-full overflow-hidden whitespace-pre-wrap break-all outline-none"
                style={textStyle}
                role="textbox"
                aria-label="TXT Shape text"
                aria-readonly="true"
              >
                {splitTxtShapeSegments(shape).map((segment, index) => (
                  <span
                    key={`${index}-${segment.selected ? 'selected' : 'plain'}`}
                    style={segment.selected ? {
                      color: shape.selectionColor,
                      backgroundColor: shape.selectionBackgroundColor,
                    } : undefined}
                  >
                    {segment.text}
                  </span>
                ))}
              </div>
            )}
            {isSelected ? (
              <>
                <div
                  className="absolute -top-5 left-0 h-5 w-full cursor-move bg-[#52e5ff]/25"
                  aria-label="Move TXT Shape"
                  onPointerDown={(event) => beginGesture(event, {
                    kind: 'move',
                    start: getWorldPoint(event, project.width, project.height),
                    shapeId: shape.id,
                    original: storedShape,
                  })}
                />
                <button
                  type="button"
                  className="absolute -right-5 -top-5 flex h-5 w-5 items-center justify-center border border-[#52e5ff] bg-black text-[12px] text-white"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    commitShapes(shapes.filter((candidate) => candidate.id !== shape.id));
                    setSelectedId(null);
                  }}
                  aria-label="Delete TXT Shape"
                >
                  ×
                </button>
                <div
                  className="absolute -bottom-2 -right-2 h-4 w-4 cursor-se-resize border border-[#52e5ff] bg-black"
                  aria-label="Resize TXT Shape"
                  onPointerDown={(event) => beginGesture(event, {
                    kind: 'resize',
                    start: getWorldPoint(event, project.width, project.height),
                    shapeId: shape.id,
                    original: storedShape,
                  })}
                />
              </>
            ) : null}
          </div>
        );
      })}
      {draft ? (
        <div
          className="pointer-events-none absolute border border-dashed border-[#52e5ff] bg-[#52e5ff]/10"
          style={{
            left: draft.x,
            top: draft.y,
            width: draft.width,
            height: draft.height,
          }}
          data-testid="txt-shape-draft"
        />
      ) : null}
    </div>
  );
};

const finiteNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
