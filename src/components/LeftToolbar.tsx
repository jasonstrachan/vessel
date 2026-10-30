"use client";

import React from 'react';
import { createPortal } from 'react-dom';

import { PixelToolIcon } from '@/components/icons/PixelToolIcon';
import {
  startVesselMultiplayerSession,
  stopVesselMultiplayerSession,
  type VesselMultiplayerStatus,
  useVesselMultiplayerSnapshot,
} from '@/collaboration/vesselMultiplayerSession';
import { openReferenceStudioWindow } from '@/referenceStudio/referenceStudioChannel';
import { useAppStore } from '@/stores/useAppStore';
import { Tool } from '@/types';
import { showAppFeedback } from '@/utils/appFeedback';
import studioExtension from '@/extensions/studioExtension';
import { useToolSwitcher } from '@/utils/toolSwitch';

type ToolbarItemId = Tool | 'grid-toggle' | 'magic-wand' | 'multiplayer' | 'reference-studio';

export const TOOLBAR_TOOLTIP_DELAY_MS = 450;

const toolShortcuts: Partial<Record<ToolbarItemId, { aria: string; display: string }>> = {
  brush: { aria: 'KeyB', display: 'B' },
  eraser: { aria: 'KeyE', display: 'E (tap/hold)' },
  selection: { aria: 'KeyM', display: 'M' },
  'color-picker': { aria: 'KeyP', display: 'Hold P' },
  'magic-wand': { aria: 'KeyW', display: 'W' },
  save: { aria: 'Control+KeyS Meta+KeyS', display: 'Ctrl/Cmd+S' },
  load: { aria: 'Control+KeyO Meta+KeyO', display: 'Ctrl/Cmd+O' },
};

const getMultiplayerLabel = (
  pending: boolean,
  status: VesselMultiplayerStatus,
) => {
  if (pending) return 'Starting multiplayer painting';
  if (status === 'stopping') return 'Stopping AI multiplayer painting';
  if (status === 'active') return 'Stop AI multiplayer painting';
  return 'Start multiplayer painting';
};

const LeftToolbar = () => {
  const StudioToolbarItems = studioExtension.ToolbarItems;
  const {
    tools: toolState,
    ui,
    saveProject,
    toggleGrid,
    toggleModal,
    setSelectionMode,
    setBrushPanelSection,
    setSettingsSection,
  } = useAppStore();
  const switchTool = useToolSwitcher();
  const multiplayer = useVesselMultiplayerSnapshot();
  const [multiplayerPending, setMultiplayerPending] = React.useState(false);
  const [tooltip, setTooltip] = React.useState<{ id: ToolbarItemId; top: number; left: number } | null>(null);
  const toolButtons = React.useRef(new Map<ToolbarItemId, HTMLButtonElement>());
  const tooltipTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const multiplayerActive = multiplayer.status === 'active' || multiplayer.status === 'stopping';
  const multiplayerTransitioning = multiplayerPending || multiplayer.status === 'stopping';

  const clearTooltipTimer = React.useCallback(() => {
    if (tooltipTimerRef.current !== null) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
  }, []);

  const showTooltip = React.useCallback((id: ToolbarItemId) => {
    const button = toolButtons.current.get(id);
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setTooltip({ id, top: Math.min(Math.max(rect.top + rect.height / 2, 16), window.innerHeight - 16), left: rect.right + 8 });
  }, []);

  const scheduleTooltip = React.useCallback((toolId: ToolbarItemId) => {
    clearTooltipTimer();
    setTooltip(null);
    tooltipTimerRef.current = setTimeout(() => {
      showTooltip(toolId);
      tooltipTimerRef.current = null;
    }, TOOLBAR_TOOLTIP_DELAY_MS);
  }, [clearTooltipTimer, showTooltip]);

  const showTooltipImmediately = React.useCallback((toolId: ToolbarItemId) => {
    clearTooltipTimer();
    showTooltip(toolId);
  }, [clearTooltipTimer, showTooltip]);

  const hideTooltip = React.useCallback(() => {
    clearTooltipTimer();
    setTooltip(null);
  }, [clearTooltipTimer]);

  React.useEffect(() => clearTooltipTimer, [clearTooltipTimer]);
  React.useEffect(() => {
    const dismissTooltip = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hideTooltip();
    };
    document.addEventListener('keydown', dismissTooltip);
    window.addEventListener('blur', hideTooltip);
    window.addEventListener('resize', hideTooltip);
    return () => {
      document.removeEventListener('keydown', dismissTooltip);
      window.removeEventListener('blur', hideTooltip);
      window.removeEventListener('resize', hideTooltip);
    };
  }, [hideTooltip]);

  const toolGroups = [
    [
      { id: 'new-document' as Tool, label: 'New Document', abbr: 'Dc' },
      { id: 'selection' as Tool, label: 'Selection', abbr: 'Mq' },
    ],
    [
      { id: 'brush' as Tool, label: 'Brush', abbr: 'Br' },
      { id: 'eraser' as Tool, label: 'Eraser', abbr: 'Er' },
      { id: 'color-picker' as Tool, label: 'Eyedropper', abbr: 'Ey' },
      { id: 'magic-wand' as ToolbarItemId, label: 'Magic Wand', abbr: 'Mw' },
    ],
    [
      { id: 'save' as Tool, label: 'Save File', abbr: 'Sv' },
      { id: 'load' as Tool, label: 'Load File', abbr: 'Ld' },
      { id: 'export' as Tool, label: 'Export', abbr: 'Ex' },
      { id: 'reference-studio' as ToolbarItemId, label: 'Reference Studio', abbr: 'Rf' },
      { id: 'grid-toggle' as ToolbarItemId, label: 'Grid', abbr: 'Gd' },
      { id: 'options' as Tool, label: 'Options', abbr: 'St' },
      {
        id: 'multiplayer' as ToolbarItemId,
        label: getMultiplayerLabel(multiplayerPending, multiplayer.status),
        abbr: 'Mp',
      },
    ],
  ];

  const handleToolClick = async (toolId: ToolbarItemId) => {
    if (toolId === 'multiplayer') {
      if (multiplayerTransitioning) return;
      if (multiplayerActive && multiplayer.sessionId) {
        const stopped = stopVesselMultiplayerSession({
          sessionId: multiplayer.sessionId,
          reason: 'Stopped from the Vessel toolbar',
        });
        showAppFeedback(
          stopped.status === 'stopping' ? 'Stopping multiplayer…' : 'Multiplayer stopped',
        );
        return;
      }

      setMultiplayerPending(true);
      try {
        const sessionId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? `vessel-${crypto.randomUUID()}`
          : `vessel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        await startVesselMultiplayerSession({ sessionId });
        showAppFeedback(`Multiplayer active — AI ${multiplayer.aiState}`);
      } catch (error) {
        showAppFeedback(
          `Multiplayer unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      } finally {
        setMultiplayerPending(false);
      }
    } else if (toolId === 'reference-studio') {
      if (!openReferenceStudioWindow()) {
        showAppFeedback('Reference Studio was blocked — allow popups for Vessel');
      }
    } else if (toolId === 'new-document') {
      toggleModal('document');
    } else if (toolId === 'save') {
      try {
        await saveProject({ forceDialog: true });
      } catch (error) {
        alert(`Save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else if (toolId === 'load') {
      toggleModal('loadProject');
    } else if (toolId === 'export' || toolId === 'export-png') {
      toggleModal('export');
    } else if (toolId === 'grid-toggle') {
      toggleGrid();
    } else if (toolId === 'options') {
      setSettingsSection('display');
      if (!ui.modals.settings) {
        toggleModal('settings');
      }
    } else if (toolId === 'magic-wand') {
      setBrushPanelSection('tool');
      setSelectionMode('magic-wand');
      await switchTool('selection');
    } else {
      setBrushPanelSection('tool');
      await switchTool(toolId);
    }
  };

  return (
    <div
      className="w-[48px] min-h-0 shrink-0 flex flex-col items-center overflow-y-auto pt-2 pb-2 border-r"
      onScroll={() => {
        if (tooltip && document.activeElement === toolButtons.current.get(tooltip.id)) showTooltip(tooltip.id);
        else hideTooltip();
      }}
      style={{
        backgroundColor: 'var(--vessel-panel)',
        borderColor: 'var(--vessel-shadow)'
      }}
      role="toolbar"
      aria-label="Primary tool selection"
    >
      {toolGroups.map((group, groupIndex) => (
        <React.Fragment key={groupIndex}>
          {groupIndex > 1 && (
            <div className="h-px w-8 my-2 flex-shrink-0" style={{ backgroundColor: 'var(--vessel-border)' }} />
          )}
          {group.map((tool, toolIndex) => {
            const isToolSectionActive = ui.brushPanelSection === 'tool';
            const isActive = tool.id === 'grid-toggle'
              ? ui.grid.enabled
              : tool.id === 'multiplayer'
                ? multiplayerActive
                : tool.id === 'magic-wand'
                  ? isToolSectionActive
                    && toolState.currentTool === 'selection'
                    && toolState.selectionMode === 'magic-wand'
                : tool.id === 'selection'
                  ? isToolSectionActive
                    && toolState.currentTool === 'selection'
                    && toolState.selectionMode !== 'magic-wand'
                  : isToolSectionActive && toolState.currentTool === tool.id;
            const shortcut = tool.id === 'grid-toggle' ? undefined : toolShortcuts[tool.id]?.display;
            const tooltipText = shortcut ? `${tool.label} (${shortcut})` : tool.label;
            const tooltipId = `toolbar-tooltip-${tool.id}`;
            const isTooltipVisible = tooltip?.id === tool.id;

            return (
              <React.Fragment key={tool.id}>
                {tool.id === 'export' && StudioToolbarItems && <StudioToolbarItems />}
                <div
                  className="relative mx-auto mb-1 h-9 w-9 flex-shrink-0"
                  onMouseEnter={() => scheduleTooltip(tool.id)}
                  onMouseLeave={hideTooltip}
                >
                  <button
                    ref={(button) => {
                      if (button) toolButtons.current.set(tool.id, button);
                      else toolButtons.current.delete(tool.id);
                    }}
                    onClick={() => {
                      hideTooltip();
                      void handleToolClick(tool.id);
                    }}
                    onFocus={() => showTooltipImmediately(tool.id)}
                    onBlur={hideTooltip}
                    aria-describedby={isTooltipVisible ? tooltipId : undefined}
                    aria-label={tooltipText}
                    aria-pressed={isActive}
                    aria-keyshortcuts={tool.id === 'grid-toggle' ? undefined : toolShortcuts[tool.id]?.aria}
                    data-shortcut={tool.id === 'grid-toggle' ? undefined : toolShortcuts[tool.id]?.display}
                    disabled={tool.id === 'multiplayer' && multiplayerTransitioning}
                    type="button"
                    className="vessel-tool-button disabled:cursor-wait"
                  >
                    <PixelToolIcon tool={tool.id} />
                  </button>
                  {isTooltipVisible && tooltip && createPortal(
                    <div
                      style={{ left: tooltip.left, top: tooltip.top }}
                      className="pointer-events-none fixed z-[80] -translate-y-1/2 whitespace-nowrap border border-[#4A4A4A] bg-[#111] px-2 py-1 text-[11px] font-normal text-[#F2F2F2] shadow-lg"
                      id={tooltipId}
                      role="tooltip"
                    >
                      {tooltipText}
                    </div>,
                    document.body,
                  )}
                </div>
                {groupIndex === 0 && toolIndex === 0 && (
                  <div className="h-px w-8 my-2 flex-shrink-0" style={{ backgroundColor: 'var(--vessel-border)' }} />
                )}
                {tool.id === 'export' && (
                  <div className="h-px w-8 my-2 flex-shrink-0" style={{ backgroundColor: 'var(--vessel-border)' }} />
                )}
              </React.Fragment>
            );
          })}
          {groupIndex === toolGroups.length - 1 && (
            <div className="h-px w-8 my-2 flex-shrink-0" style={{ backgroundColor: 'var(--vessel-border)' }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default LeftToolbar;
