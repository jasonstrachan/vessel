'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';
import Input from '@/components/ui/Input';
import { useAppStore } from '@/stores/useAppStore';

const GRID_PANEL_EXPANDED_STORAGE_KEY = 'vessel-grid-panel-expanded';
const DEFAULT_GRID_STATE = {
  enabled: false,
  rows: 8,
  columns: 8,
} as const;

const loadInitialExpandedState = (): boolean => {
  if (typeof window === 'undefined') {
    return true;
  }

  try {
    return window.localStorage.getItem(GRID_PANEL_EXPANDED_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
};

const persistExpandedState = (isExpanded: boolean): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(GRID_PANEL_EXPANDED_STORAGE_KEY, isExpanded ? '1' : '0');
  } catch {
    // Ignore storage failures and keep runtime state functional.
  }
};

const GridSettingsPanel: React.FC = () => {
  const grid = useAppStore((state) => state.ui?.grid ?? DEFAULT_GRID_STATE);
  const setGridEnabled = useAppStore((state) => state.setGridEnabled);
  const setGridDimensions = useAppStore((state) => state.setGridDimensions);
  const [isExpanded, setIsExpanded] = React.useState<boolean>(loadInitialExpandedState);

  const handleToggleExpanded = React.useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev;
      persistExpandedState(next);
      return next;
    });
  }, []);

  const handleRowsChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = Number(event.target.value);
      if (!Number.isFinite(next)) {
        return;
      }
      setGridDimensions({ rows: next });
    },
    [setGridDimensions],
  );

  const handleColumnsChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = Number(event.target.value);
      if (!Number.isFinite(next)) {
        return;
      }
      setGridDimensions({ columns: next });
    },
    [setGridDimensions],
  );

  return (
    <section className="bg-[#1A1A1A] border-t border-[#404040] px-2 py-2" aria-labelledby="grid-settings-heading">
      <button
        type="button"
        className="w-full bg-transparent flex items-center justify-between text-left cursor-pointer select-none gap-2 transition-colors py-1"
        onClick={handleToggleExpanded}
        aria-expanded={isExpanded}
      >
        <div className="flex flex-col">
          <span id="grid-settings-heading" className="text-sm font-medium text-[#F1F1F6]">
            Grid
          </span>
          {isExpanded ? (
            <span className="text-[11px] leading-4 text-[#88888A]">
              Persistent canvas overlay aligned to the document.
            </span>
          ) : null}
        </div>
        <ChevronRight
          className={`h-4 w-4 text-[#8F8FA3] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          aria-hidden
        />
      </button>

      {isExpanded ? (
        <div className="mt-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-[#D3D3DC]">Visible</span>
            <label className="flex items-center gap-2 text-xs text-[#D9D9D9]" htmlFor="grid-enabled-panel">
              <input
                id="grid-enabled-panel"
                type="checkbox"
                checked={grid.enabled}
                onChange={(event) => setGridEnabled(event.target.checked)}
                className="h-4 w-4 accent-[#D9D9D9]"
              />
              On
            </label>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <label className="flex flex-col gap-1 text-sm font-medium text-[#D3D3DC]" htmlFor="grid-rows">
              Rows
              <Input
                id="grid-rows"
                type="number"
                min={1}
                max={128}
                step={1}
                variant="compact"
                value={grid.rows}
                onChange={handleRowsChange}
                aria-label="Grid rows"
                title="Grid rows"
                className="text-center"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium text-[#D3D3DC]" htmlFor="grid-columns">
              Columns
              <Input
                id="grid-columns"
                type="number"
                min={1}
                max={128}
                step={1}
                variant="compact"
                value={grid.columns}
                onChange={handleColumnsChange}
                aria-label="Grid columns"
                title="Grid columns"
                className="text-center"
              />
            </label>
          </div>
        </div>
      ) : null}
    </section>
  );
};

export default React.memo(GridSettingsPanel);
