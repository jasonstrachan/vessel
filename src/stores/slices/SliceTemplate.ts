import type { StateCreator } from 'zustand';

type AppState = import('../useAppStore').AppState;

export type SliceTemplate = Record<string, never>;

export const createSliceTemplate: StateCreator<AppState, [], [], SliceTemplate> = () => ({});
