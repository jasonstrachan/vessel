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
    <div className="h-64 bg-slate-900 border-t border-slate-700/50 flex flex-col shadow-xl">
      {/* Controls */}
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

      {/* Layers and Timeline */}
      <div className="flex-1 flex overflow-hidden">
        {/* Layer Panel */}
        <LayerPanel />
        
        {/* Frame Timeline */}
        <div className="flex-1 overflow-x-auto bg-slate-950">
          <div className="h-full min-w-full">
            {/* Frame Numbers */}
            <div className="h-10 bg-slate-800 border-b border-slate-700/50 flex items-center">
              {Array.from({ length: Math.max(maxFrames, 10) }, (_, i) => (
                <div
                  key={i}
                  className={`w-14 h-full flex items-center justify-center text-xs border-r border-slate-700/50 font-medium
                    ${i === project.currentFrame ? 'bg-slate-600 text-slate-100' : 'text-slate-400 hover:bg-slate-700/50'}
                  `}
                >
                  {i + 1}
                </div>
              ))}
            </div>

            {/* Layer Frames */}
            <div className="space-y-1 p-2">
              {project.layers.map((layer, layerIndex) => (
                <div key={layer.id} className="flex items-center h-8">
                  {Array.from({ length: Math.max(maxFrames, 10) }, (_, frameIndex) => {
                    const hasFrame = frameIndex < layer.frames.length && layer.frames[frameIndex];
                    const isCurrentFrame = frameIndex === project.currentFrame;
                    const isCurrentLayer = layerIndex === currentLayer;
                    
                    return (
                      <button
                        key={frameIndex}
                        onClick={() => setCurrentFrame(frameIndex)}
                        className={`w-14 h-7 border border-slate-600 flex items-center justify-center rounded transition-all duration-150 mx-px
                          ${hasFrame ? 'bg-slate-600 border-slate-500' : 'bg-slate-800 border-slate-700'}
                          ${isCurrentFrame && isCurrentLayer ? 'ring-2 ring-slate-400 ring-offset-1 ring-offset-slate-950' : ''}
                          hover:bg-slate-500 hover:border-slate-400
                        `}
                      >
                        {hasFrame && (
                          <div className="w-2.5 h-2.5 bg-slate-100 rounded-full shadow-sm" />
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