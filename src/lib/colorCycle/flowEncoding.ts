import {
  GOBLET_FLOW_MODE_FORWARD,
  GOBLET_FLOW_MODE_LEGACY,
  GOBLET_FLOW_MODE_PINGPONG,
  GOBLET_FLOW_MODE_REVERSE,
} from '@/lib/colorCycle/gobletPlaybackMath';

export type FlowMode = 'forward' | 'reverse' | 'pingpong';

export const FLOW_SLOT_BITS = 8;
export const FLOW_SLOT_MASK = (1 << FLOW_SLOT_BITS) - 1;

export const FLOW_MODE_LEGACY = GOBLET_FLOW_MODE_LEGACY;
export const FLOW_MODE_FORWARD = GOBLET_FLOW_MODE_FORWARD;
export const FLOW_MODE_REVERSE = GOBLET_FLOW_MODE_REVERSE;
export const FLOW_MODE_PINGPONG = GOBLET_FLOW_MODE_PINGPONG;

export const encodeFlowSlot = (slot: number, mode?: FlowMode): number => {
  void mode;
  return Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(slot || 0)));
};

export const decodeFlowSlot = (gid: number): { slot: number; flowBits: number } => {
  const raw = Math.max(0, Math.min(255, gid | 0));
  return {
    slot: raw,
    flowBits: 0,
  };
};
