"use client";

import { useCallback } from 'react';

import { useAppStore } from '@/stores/useAppStore';
import type { Tool } from '@/types';

import { flushPendingToolWork } from './toolFlushRegistry';

export const useToolSwitcher = () => {
  const setCurrentTool = useAppStore(state => state.setCurrentTool);
  return useCallback(async (tool: Tool) => {
    await flushPendingToolWork();
    setCurrentTool(tool);
  }, [setCurrentTool]);
};

export const flushAndSetCurrentTool = async (tool: Tool): Promise<void> => {
  await flushPendingToolWork();
  useAppStore.getState().setCurrentTool(tool);
};
