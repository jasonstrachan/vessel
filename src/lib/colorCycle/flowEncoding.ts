export type FlowMode = 'forward' | 'reverse' | 'pingpong';

export const FLOW_SLOT_BITS = 6;
export const FLOW_SLOT_MASK = (1 << FLOW_SLOT_BITS) - 1;

export const FLOW_MODE_LEGACY = 0;
export const FLOW_MODE_FORWARD = 1;
export const FLOW_MODE_REVERSE = 2;
export const FLOW_MODE_PINGPONG = 3;

export const encodeFlowSlot = (slot: number, mode?: FlowMode): number => {
  const slotSafe = Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(slot || 0)));
  const flowBits =
    mode === 'reverse'
      ? FLOW_MODE_REVERSE
      : mode === 'pingpong'
        ? FLOW_MODE_PINGPONG
        : FLOW_MODE_FORWARD;
  return (flowBits << FLOW_SLOT_BITS) | slotSafe;
};

export const decodeFlowSlot = (gid: number): { slot: number; flowBits: number } => {
  const raw = Math.max(0, Math.min(255, gid | 0));
  return {
    slot: raw & FLOW_SLOT_MASK,
    flowBits: raw >> FLOW_SLOT_BITS,
  };
};
