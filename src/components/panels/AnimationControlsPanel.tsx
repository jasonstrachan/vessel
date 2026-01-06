'use client';

import React from 'react';
import {
  useAppStore,
  selectEffectiveColorCyclePlaying,
  selectColorCycleSuspendDepth,
} from '@/stores/useAppStore';

const AnimationControlsPanel: React.FC = () => {
  const playColorCycle = useAppStore(state => state.playColorCycle);
  const pauseColorCycle = useAppStore(state => state.pauseColorCycle);
  const forceResumeColorCycle = useAppStore(state => state.forceResumeColorCycle);
  const effectivePlaying = useAppStore(selectEffectiveColorCyclePlaying);
  const suspendDepth = useAppStore(selectColorCycleSuspendDepth);

  const handleTogglePlayback = React.useCallback(() => {
    if (effectivePlaying) {
      pauseColorCycle('toolbar');
      return;
    }
    playColorCycle('toolbar');
    if (suspendDepth > 0) {
      forceResumeColorCycle('toolbar');
    }
  }, [effectivePlaying, pauseColorCycle, playColorCycle, forceResumeColorCycle, suspendDepth]);

  return (
    <div className="bg-[#1A1A1A] border-t border-[#404040]">
      <div className="px-4 py-3 space-y-3">
        <button
          onClick={handleTogglePlayback}
          className="w-full h-11 bg-[#D9D9D9] text-[#31313A] hover:bg-[#C4C4C4] transition-colors text-xs outline-none focus:outline-none flex items-center justify-center"
        >
          <span className="text-[10px]" aria-hidden="true">{effectivePlaying ? '⏸' : '▶'}</span>
          <span className="ml-1 text-[10px]">{effectivePlaying ? 'Pause' : 'Play'}</span>
        </button>
      </div>
    </div>
  );
};

export default React.memo(AnimationControlsPanel);
