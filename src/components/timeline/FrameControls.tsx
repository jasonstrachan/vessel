'use client';

interface FrameControlsProps {
  currentFrame: number;
  maxFrames: number;
  fps: number;
  isPlaying: boolean;
  onPlayToggle: () => void;
  onPreviousFrame: () => void;
  onNextFrame: () => void;
  onFrameChange: (frame: number) => void;
  onAddFrame: () => void;
  onRemoveFrame: () => void;
}

export const FrameControls = ({
  currentFrame,
  maxFrames,
  fps,
  isPlaying,
  onPlayToggle,
  onPreviousFrame,
  onNextFrame,
  onFrameChange,
  onAddFrame,
  onRemoveFrame,
}: FrameControlsProps) => {
  return (
    <div className="h-14 bg-slate-800 border-b border-slate-700/50 flex items-center gap-6 px-6">
      {/* Playback Controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={onPreviousFrame}
          className="p-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg transition-all duration-200 hover:shadow-lg"
          title="Previous Frame"
        >
          <span className="block w-4 h-4">⏮️</span>
        </button>
        
        <button
          onClick={onPlayToggle}
          className={`p-2.5 rounded-lg transition-all duration-200 hover:shadow-lg ${
            isPlaying ? 'bg-orange-600 hover:bg-orange-500' : 'bg-green-600 hover:bg-green-500'
          }`}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          <span className="block w-4 h-4">
            {isPlaying ? '⏸️' : '▶️'}
          </span>
        </button>
        
        <button
          onClick={onNextFrame}
          className="p-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg transition-all duration-200 hover:shadow-lg"
          title="Next Frame"
        >
          <span className="block w-4 h-4">⏭️</span>
        </button>
      </div>

      {/* Frame Info */}
      <div className="flex items-center gap-6 text-sm">
        <div className="flex items-center gap-3">
          <label className="text-slate-300 font-medium">Frame:</label>
          <input
            type="number"
            min="1"
            max={maxFrames}
            value={currentFrame + 1}
            onChange={(e) => {
              const frame = Math.max(0, Math.min(maxFrames - 1, parseInt(e.target.value) - 1));
              if (!isNaN(frame)) onFrameChange(frame);
            }}
            className="w-16 px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-slate-100 text-center font-mono"
          />
          <span className="text-slate-400">/ {maxFrames}</span>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-slate-300 font-medium">FPS:</label>
          <input
            type="number"
            min="1"
            max="60"
            value={fps}
            onChange={(e) => {
              // Will implement FPS change in store
            }}
            className="w-16 px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-slate-100 text-center font-mono"
          />
        </div>
      </div>

      {/* Frame Management */}
      <div className="flex items-center gap-3 ml-auto">
        <button
          onClick={onAddFrame}
          className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-slate-100 rounded-lg text-sm font-medium transition-all duration-200 hover:shadow-lg"
          title="Add Frame"
        >
          + Frame
        </button>
        
        <button
          onClick={onRemoveFrame}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded-lg text-sm font-medium transition-all duration-200 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          title="Remove Current Frame"
          disabled={maxFrames <= 1}
        >
          - Frame
        </button>
      </div>
    </div>
  );
};