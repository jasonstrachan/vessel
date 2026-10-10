import { renderHook } from '@testing-library/react';

import { useDrawingHandlersEngineRuntimes } from '../useDrawingHandlersEngineRuntimes';
import { useBrushEngine } from '@/hooks/BrushEngineProvider';

jest.mock('@/hooks/BrushEngineProvider', () => ({ useBrushEngine: jest.fn() }));
jest.mock('@/hooks/useUserBrushEngine', () => ({ useUserBrushEngine: () => ({}) }));

it('connects stamp-source finalization to the buffered brush engine', () => {
  const finalizeStroke = jest.fn();
  jest.mocked(useBrushEngine).mockReturnValue({ finalizeStroke } as unknown as ReturnType<typeof useBrushEngine>);
  const { result } = renderHook(() => useDrawingHandlersEngineRuntimes());
  const ctx = document.createElement('canvas').getContext('2d')!;
  result.current.brushStampRuntime.finalizeStroke(ctx);
  expect(finalizeStroke).toHaveBeenCalledWith(ctx);
});
