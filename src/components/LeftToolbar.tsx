"use client";

import React from 'react';
import {
  startVesselMultiplayerSession,
  stopVesselMultiplayerSession,
  type VesselMultiplayerStatus,
  useVesselMultiplayerSnapshot,
} from '@/collaboration/vesselMultiplayerSession';
import { isInterlaceGroup } from '@/lib/interlace/interlaceSettings';
import { useAppStore } from '@/stores/useAppStore';
import { Tool } from '@/types';
import { showAppFeedback } from '@/utils/appFeedback';
import { useToolSwitcher } from '@/utils/toolSwitch';

type ToolbarItemId = Tool | 'grid-toggle' | 'magic-wand' | 'filters' | 'interlace' | 'multiplayer';

const toolShortcuts: Partial<Record<ToolbarItemId, { aria: string; display: string }>> = {
  brush: { aria: 'KeyB', display: 'B' },
  custom: { aria: 'KeyC', display: 'C' },
  eraser: { aria: 'KeyE', display: 'E (tap/hold)' },
  selection: { aria: 'KeyM', display: 'M' },
  'color-picker': { aria: 'KeyP', display: 'Hold P' },
  fill: { aria: 'KeyF', display: 'F' },
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
  // Force refresh - toolbar black background fix
  const {
    tools: toolState,
    ui,
    saveProject,
    toggleGrid,
    toggleModal,
    setSelectionMode,
    setBrushPanelSection,
    setSettingsSection,
    layers,
    layerGroups,
    activeLayerId,
    selectedLayerIds,
    createInterlaceGroupFromSelection,
  } = useAppStore();
  const switchTool = useToolSwitcher();
  const multiplayer = useVesselMultiplayerSnapshot();
  const [multiplayerPending, setMultiplayerPending] = React.useState(false);
  const multiplayerActive = multiplayer.status === 'active' || multiplayer.status === 'stopping';
  const multiplayerTransitioning = multiplayerPending || multiplayer.status === 'stopping';

  const baseButtonStyle: React.CSSProperties = {
    fontFamily: 'IBM Plex Mono, "Courier New", monospace',
    fontSize: '0.95rem',
    fontWeight: 600,
    letterSpacing: '0.02em',
    border: '1px solid transparent',
    transition: 'background-color 0.15s ease, color 0.15s ease',
  };

  const toolGroups = [
    [
      { id: 'new-document' as Tool, label: 'New Document', abbr: 'Dc' },
      { id: 'selection' as Tool, label: 'Selection', abbr: 'Mq' },
    ],
    [
      { id: 'brush' as Tool, label: 'Brush', abbr: 'Br' },
      { id: 'custom' as Tool, label: 'Custom Brush', abbr: 'Cb' },
      { id: 'eraser' as Tool, label: 'Eraser', abbr: 'Er' },
      { id: 'eyedropper' as Tool, label: 'Eyedropper', abbr: 'Ey' },
      { id: 'color-picker' as Tool, label: 'Color Picker', abbr: 'Cp' },
      { id: 'fill' as Tool, label: 'Fill', abbr: 'Fi' },
      { id: 'magic-wand' as ToolbarItemId, label: 'Magic Wand', abbr: 'Mw' },
      { id: 'color-adjust' as Tool, label: 'Hue/Sat', abbr: 'Hs' },
      { id: 'filters' as ToolbarItemId, label: 'Filters', abbr: 'Fl' },
      { id: 'interlace' as ToolbarItemId, label: 'Interlace', abbr: 'In' },
    ],
    [
      { id: 'save' as Tool, label: 'Save File', abbr: 'Sv' },
      { id: 'load' as Tool, label: 'Load File', abbr: 'Ld' },
      { id: 'export' as Tool, label: 'Export', abbr: 'Ex' },
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
        showAppFeedback('Multiplayer active — AI can join');
      } catch (error) {
        showAppFeedback(
          `Multiplayer unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      } finally {
        setMultiplayerPending(false);
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
    } else if (toolId === 'filters') {
      setBrushPanelSection('filters');
    } else if (toolId === 'interlace') {
      const activeLayer = layers.find((layer) => layer.id === activeLayerId);
      const selectedLayers = layers.filter((layer) => selectedLayerIds.includes(layer.id));
      const existingInterlaceGroup = layerGroups.find((group) => (
        isInterlaceGroup(group)
        && (activeLayer?.groupId === group.id || selectedLayers.some((layer) => layer.groupId === group.id))
      ));
      if (!existingInterlaceGroup) {
        const eligibleIds = selectedLayers
          .filter((layer) => layer.layerType !== 'sequential')
          .map((layer) => layer.id);
        if (eligibleIds.length < 2 || !createInterlaceGroupFromSelection(eligibleIds)) {
          showAppFeedback('Select at least two regular or Color Cycle layers');
          return;
        }
      }
      setBrushPanelSection('interlace');
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
      className="w-[48px] flex flex-col pt-4 pb-0 border-r"
      style={{
        backgroundColor: '#1A1A1A',
        borderColor: '#242424'
      }}
      role="toolbar"
      aria-label="Primary tool selection"
    >
      {toolGroups.map((group, groupIndex) => (
        <React.Fragment key={groupIndex}>
          {groupIndex > 1 && (
            <div className="h-[2px] w-full my-2 flex-shrink-0" style={{ backgroundColor: '#D9D9D9' }} />
          )}
          {group.map((tool, toolIndex) => {
            const isFilterSectionActive = ui.brushPanelSection === 'filters';
            const isInterlaceSectionActive = ui.brushPanelSection === 'interlace';
            const isActive = tool.id === 'grid-toggle'
              ? ui.grid.enabled
              : tool.id === 'multiplayer'
                ? multiplayerActive
              : tool.id === 'filters'
                ? isFilterSectionActive
                : tool.id === 'interlace'
                  ? isInterlaceSectionActive
                : tool.id === 'magic-wand'
                  ? !isFilterSectionActive && !isInterlaceSectionActive
                    && toolState.currentTool === 'selection'
                    && toolState.selectionMode === 'magic-wand'
                : tool.id === 'selection'
                  ? !isFilterSectionActive && !isInterlaceSectionActive
                    && toolState.currentTool === 'selection'
                    && toolState.selectionMode !== 'magic-wand'
                  : !isFilterSectionActive && !isInterlaceSectionActive && toolState.currentTool === tool.id;
            const shortcut = tool.id === 'grid-toggle' ? undefined : toolShortcuts[tool.id]?.display;

            return (
              <React.Fragment key={tool.id}>
                <button
                  onClick={() => handleToolClick(tool.id)}
                  title={shortcut ? `${tool.label} (${shortcut})` : tool.label}
                  aria-label={shortcut ? `${tool.label} (${shortcut})` : tool.label}
                  aria-pressed={isActive}
                  aria-keyshortcuts={tool.id === 'grid-toggle' ? undefined : toolShortcuts[tool.id]?.aria}
                  data-shortcut={tool.id === 'grid-toggle' ? undefined : toolShortcuts[tool.id]?.display}
                  disabled={tool.id === 'multiplayer' && multiplayerTransitioning}
                  type="button"
                  className="w-[44px] h-10 min-h-[36px] mx-auto flex items-center justify-center bg-transparent border-0 appearance-none outline-none mb-1 disabled:cursor-wait disabled:opacity-60"
                  style={baseButtonStyle}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      padding: isActive ? '1px 3px' : 0,
                      color: isActive ? '#1A1A1A' : '#FFFFFF',
                      backgroundColor: isActive
                        ? tool.id === 'multiplayer' ? '#ff4fd8' : '#FFFFFF'
                        : 'transparent',
                      boxShadow: isActive
                        ? `0 0 0 1px ${tool.id === 'multiplayer' ? '#ff4fd8' : '#FFFFFF'}`
                        : 'none',
                      lineHeight: 1.2,
                    }}
                  >
                    {tool.abbr}
                  </span>
                </button>
                {groupIndex === 0 && toolIndex === 0 && (
                  <div className="h-[2px] w-full my-2 flex-shrink-0" style={{ backgroundColor: '#D9D9D9' }} />
                )}
                {tool.id === 'export' && (
                  <div className="h-[2px] w-full my-2 flex-shrink-0" style={{ backgroundColor: '#D9D9D9' }} />
                )}
              </React.Fragment>
            );
          })}
          {groupIndex === toolGroups.length - 1 && (
            <div className="h-[2px] w-full my-2 flex-shrink-0" style={{ backgroundColor: '#D9D9D9' }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default LeftToolbar;
