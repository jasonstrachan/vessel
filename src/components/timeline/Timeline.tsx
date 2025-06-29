'use client';

import { useAppStore } from '@/stores/useAppStore';
import { LayerPanel } from './LayerPanel';
import { FrameControls } from './FrameControls';

export const Timeline = () => {
  const { 
    project, 
    currentLayer, 
    isPlaying, 
    togglePlay,
    setCurrentFrame,
    addFrame,
    removeFrame,
  } = useAppStore();

  const maxFrames = Math.max(...project.layers.map(layer => layer.frames.length), 1);

  const goToPreviousFrame = () => {
    const newFrame = project.currentFrame > 0 ? project.currentFrame - 1 : maxFrames - 1;
    setCurrentFrame(newFrame);
  };

  const goToNextFrame = () => {
    const newFrame = (project.currentFrame + 1) % maxFrames;
    setCurrentFrame(newFrame);
  };

  return (
    <div className="h-48 bg-[#2a2a2a] border-t border-[#404040] flex">
      {/* Layer Panel */}
      <LayerPanel />
      
      {/* Frame Controls */}
      <div className="flex-1 flex flex-col">
        <FrameControls
          currentFrame={project.currentFrame}
          maxFrames={maxFrames}
          fps={project.fps}
          isPlaying={isPlaying}
          onPlayToggle={togglePlay}
          onPreviousFrame={goToPreviousFrame}
          onNextFrame={goToNextFrame}
          onFrameChange={setCurrentFrame}
          onAddFrame={addFrame}
          onRemoveFrame={() => removeFrame(project.currentFrame)}
        />
        
        {/* Timeline */}
        <div className="flex-1 overflow-x-auto bg-[#1a1a1a]">
          <div className="h-full min-w-full">
            {/* Frame Numbers */}
            <div className="h-8 bg-[#2a2a2a] border-b border-[#404040] flex items-center">
              {Array.from({ length: Math.max(maxFrames, 10) }, (_, i) => (
                <div
                  key={i}
                  className={`w-12 h-full flex items-center justify-center text-xs border-r border-[#404040] font-medium
                    ${i === project.currentFrame ? 'bg-[#60a5fa] text-white' : 'text-[#888888]'}
                  `}
                >
                  {i + 1}
                </div>
              ))}
            </div>

            {/* Layer Frames */}
            <div className="space-y-px p-1">
              {project.layers.map((layer, layerIndex) => (
                <div key={layer.id} className="flex items-center h-6">
                  {Array.from({ length: Math.max(maxFrames, 10) }, (_, frameIndex) => {
                    const hasFrame = frameIndex < layer.frames.length && layer.frames[frameIndex];
                    const isCurrentFrame = frameIndex === project.currentFrame;
                    const isCurrentLayer = layerIndex === currentLayer;
                    
                    return (
                      <button
                        key={frameIndex}
                        onClick={() => setCurrentFrame(frameIndex)}
                        className={`w-12 h-5 border border-[#404040] flex items-center justify-center transition-all duration-150
                          ${hasFrame ? 'bg-[#3a3a3a]' : 'bg-[#2a2a2a]'}
                          ${isCurrentFrame && isCurrentLayer ? 'border-[#60a5fa]' : ''}
                          hover:bg-[#404040]
                        `}
                      >
                        {hasFrame && (
                          <div className="w-1.5 h-1.5 bg-white rounded-full" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};