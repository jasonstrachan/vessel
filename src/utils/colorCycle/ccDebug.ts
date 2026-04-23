export {
  CC_DEBUG,
  CC_DEBUG_STATE_EVENT,
  ccAssert,
  ccDebugOn,
  ccDebugTimingOn,
  ccDebugVerboseOn,
  ccGroup,
  ccGroupEnd,
  ccLog,
  ccWarn,
  dumpLayerFlags,
} from '@/debug/ccDebug';

type SampleSource = ArrayLike<number> | undefined;

export const ccSample = (arr: SampleSource, n = 8): number[] | null => {
  if (!arr) {
    return null;
  }

  try {
    return Array.prototype.slice.call(arr, 0, n);
  } catch {
    return null;
  }
};
