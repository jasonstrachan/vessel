'use client';

import { useAppStore } from '@/stores/useAppStore';
import { useState } from 'react';
import Link from 'next/link';

export default function DebugPage() {
  const store = useAppStore();
  const [showRawData, setShowRawData] = useState(false);

  const debugInfo = {
    project: {
      name: store.project.name,
      dimensions: `${store.project.width}x${store.project.height}`,
      layerCount: store.project.layers.length,
      currentFrame: store.project.currentFrame,
      fps: store.project.fps,
    },
    currentState: {
      tool: store.currentTool,
      layer: store.currentLayer,
      isPlaying: store.isPlaying,
    },
    brushSettings: store.brushSettings,
    layers: store.project.layers.map((layer, index) => ({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      frameCount: layer.frames.length,
      isActive: index === store.currentLayer,
    })),
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">TinyBrush Debug Console</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowRawData(!showRawData)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
            >
              {showRawData ? 'Hide Raw Data' : 'Show Raw Data'}
            </button>
            <Link
              href="/"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
            >
              ← Back to App
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Project Info */}
          <div className="bg-slate-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-blue-400">Project Info</h2>
            <div className="space-y-2">
              <div><span className="text-slate-400">Name:</span> {debugInfo.project.name}</div>
              <div><span className="text-slate-400">Dimensions:</span> {debugInfo.project.dimensions}</div>
              <div><span className="text-slate-400">Layers:</span> {debugInfo.project.layerCount}</div>
              <div><span className="text-slate-400">Current Frame:</span> {debugInfo.project.currentFrame + 1}</div>
              <div><span className="text-slate-400">FPS:</span> {debugInfo.project.fps}</div>
            </div>
          </div>

          {/* Current State */}
          <div className="bg-slate-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-green-400">Current State</h2>
            <div className="space-y-2">
              <div><span className="text-slate-400">Tool:</span> {debugInfo.currentState.tool}</div>
              <div><span className="text-slate-400">Active Layer:</span> {debugInfo.currentState.layer + 1}</div>
              <div><span className="text-slate-400">Playing:</span> {debugInfo.currentState.isPlaying ? 'Yes' : 'No'}</div>
            </div>
          </div>

          {/* Brush Settings */}
          <div className="bg-slate-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-purple-400">Brush Settings</h2>
            <div className="space-y-2">
              <div><span className="text-slate-400">Color:</span> {debugInfo.brushSettings.color}</div>
              <div><span className="text-slate-400">Size:</span> {debugInfo.brushSettings.size}px</div>
              <div><span className="text-slate-400">Opacity:</span> {Math.round(debugInfo.brushSettings.opacity * 100)}%</div>
              <div><span className="text-slate-400">Pixel Perfect:</span> {debugInfo.brushSettings.pixelPerfect ? 'Yes' : 'No'}</div>
              <div><span className="text-slate-400">Follow Brush:</span> {debugInfo.brushSettings.followBrush ? 'Yes' : 'No'}</div>
              <div><span className="text-slate-400">Dotted Style:</span> {debugInfo.brushSettings.dottedStyle.enabled ? 'Yes' : 'No'}</div>
            </div>
          </div>

          {/* Layers */}
          <div className="bg-slate-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-yellow-400">Layers</h2>
            <div className="space-y-2">
              {debugInfo.layers.map((layer, index) => (
                <div 
                  key={layer.id} 
                  className={`p-2 rounded ${layer.isActive ? 'bg-blue-600' : 'bg-slate-700'}`}
                >
                  <div className="text-sm">
                    <span className="font-medium">{layer.name}</span>
                    <span className="text-slate-400 ml-2">
                      ({layer.frameCount} frames, {layer.visible ? 'visible' : 'hidden'})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Raw Data */}
        {showRawData && (
          <div className="mt-8 bg-slate-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-red-400">Raw Store Data</h2>
            <pre className="bg-slate-900 p-4 rounded overflow-auto text-xs">
              {JSON.stringify(store, null, 2)}
            </pre>
          </div>
        )}

        {/* System Info */}
        <div className="mt-8 bg-slate-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-cyan-400">System Info</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-slate-400">User Agent:</span> {typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A'}</div>
            <div><span className="text-slate-400">Screen:</span> {typeof window !== 'undefined' ? `${window.screen.width}x${window.screen.height}` : 'N/A'}</div>
            <div><span className="text-slate-400">Viewport:</span> {typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'N/A'}</div>
            <div><span className="text-slate-400">Timestamp:</span> {new Date().toISOString()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}