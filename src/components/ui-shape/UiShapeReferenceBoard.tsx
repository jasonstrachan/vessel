'use client';

import React from 'react';

import type { UiShapeTheme } from '@/types';
import {
  createUiShapeReferenceBoard,
  drawUiShapeReferenceBoard,
  UI_SHAPE_REFERENCE_COMPONENT_KINDS,
} from '@/utils/uiShapeReference';

const THEMES: readonly { label: string; value: UiShapeTheme }[] = [
  { label: 'System 1', value: 'macintosh-system-1' },
  { label: 'System 7', value: 'macintosh-system-7' },
  { label: 'Windows 3.1', value: 'windows-3.1' },
  { label: 'Windows 95', value: 'windows-95' },
];

export const UiShapeReferenceBoard = () => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [theme, setTheme] = React.useState<UiShapeTheme>('windows-95');
  const board = React.useMemo(() => createUiShapeReferenceBoard(theme), [theme]);

  React.useEffect(() => {
    const requestedTheme = new URLSearchParams(window.location.search).get('theme');
    if (THEMES.some((candidate) => candidate.value === requestedTheme)) {
      setTheme(requestedTheme as UiShapeTheme);
    }
  }, []);

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    canvas.width = board.width;
    canvas.height = board.height;
    drawUiShapeReferenceBoard(context, theme);
  }, [board.height, board.width, theme]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `ui-shape-${theme}-reference.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <main className="min-h-screen bg-[#151515] p-5 font-mono text-[#d9d9d9]">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-3 text-base font-semibold">UI Shape · native reference</h1>
        {THEMES.map((candidate) => (
          <button
            key={candidate.value}
            type="button"
            aria-pressed={theme === candidate.value}
            onClick={() => setTheme(candidate.value)}
            className={`h-8 border px-3 text-xs ${theme === candidate.value
              ? 'border-[#52e5ff] bg-[#173843] text-white'
              : 'border-[#555] bg-[#202020] text-[#aaa]'}`}
          >{candidate.label}</button>
        ))}
        <button
          type="button"
          onClick={download}
          className="ml-auto h-8 border border-[#777] bg-[#202020] px-3 text-xs"
        >Download PNG</button>
      </div>
      <p className="mb-4 text-xs text-[#999]">
        1 canvas pixel = 1 component pixel. No browser scaling.
      </p>
      <div className="overflow-auto border border-[#444] bg-[#202020] p-2">
        <canvas
          ref={canvasRef}
          width={board.width}
          height={board.height}
          data-testid="ui-shape-reference-canvas"
          style={{ width: board.width, height: board.height, imageRendering: 'pixelated' }}
        />
      </div>
      <ol className="mt-3 grid grid-cols-2 gap-x-4 text-[11px] text-[#888] sm:grid-cols-3">
        {UI_SHAPE_REFERENCE_COMPONENT_KINDS.map((kind) => <li key={kind}>{kind}</li>)}
      </ol>
    </main>
  );
};
