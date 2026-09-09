"use client";

import { useCallback } from 'react';

import { useAppStore } from '@/stores/useAppStore';
import type { Tool } from '@/types';

import { flushPendingToolWork } from './toolFlushRegistry';

const toolSelectionListeners = new Set<() => void>();

/** Includes reselecting the active tool, before pending work is flushed. */
export const subscribeToolSelection = (listener: () => void): (() => void) => {
  toolSelectionListeners.add(listener);
  return () => { toolSelectionListeners.delete(listener); };
};

const notifyToolSelection = () => {
  toolSelectionListeners.forEach(listener => listener());
};

export const useToolSwitcher = () => {
  const setCurrentTool = useAppStore(state => state.setCurrentTool);
  return useCallback(async (tool: Tool) => {
    notifyToolSelection();
    await flushPendingToolWork();
    setCurrentTool(tool);
  }, [setCurrentTool]);
};

export const flushAndSetCurrentTool = async (tool: Tool): Promise<void> => {
  notifyToolSelection();
  await flushPendingToolWork();
  useAppStore.getState().setCurrentTool(tool);
};
