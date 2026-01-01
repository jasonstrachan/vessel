import type { StateCreator } from 'zustand';

type AppState = import('../useAppStore').AppState;

export interface SliceTemplate {}

export const createSliceTemplate: StateCreator<AppState, [], [], SliceTemplate> = () => ({});
